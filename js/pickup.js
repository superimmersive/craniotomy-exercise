var SITE = { x: 0.055, y: 0.34, z: 0.02 };
var PULSE = { r: 0.2, g: 0.75, b: 1 };
var PULSE_HZ = 0.9;
var PULSE_BLEND = 0.7;
var SNAP_PX = 56;
var SNAP_SHARPNESS = 14;

function ndcFromEvent(event, el) {
  var rect = el.getBoundingClientRect();
  var w = Math.max(rect.width, 1);
  var h = Math.max(rect.height, 1);
  return {
    x: ((event.clientX - rect.left) / w) * 2 - 1,
    y: -((event.clientY - rect.top) / h) * 2 + 1
  };
}

function eventOver(event, el) {
  var rect = el.getBoundingClientRect();
  return event.clientX >= rect.left && event.clientX <= rect.right &&
    event.clientY >= rect.top && event.clientY <= rect.bottom;
}

export function bindScalpelPickup(ctx, sequence) {
  var viewer = ctx.viewer;
  var scene = ctx.scene;
  var THREE = ctx.THREE;
  var tools = ctx.tools;
  var scalpel = tools && tools.byId && tools.byId.scalpel;
  if (!viewer || !scene || !scalpel) return { dispose: function () {} };

  var raycaster = new THREE.Raycaster();
  var proxyCam = new THREE.PerspectiveCamera();
  var ndc = new THREE.Vector2();
  var plane = new THREE.Plane();
  var planeHit = new THREE.Vector3();
  var viewDir = new THREE.Vector3();
  var tipWorld = new THREE.Vector3();
  var projected = new THREE.Vector3();
  var boxCenter = new THREE.Vector3();
  var boxSize = new THREE.Vector3();
  var worldBox = new THREE.Box3();
  var localTipDir = new THREE.Vector3(-1, 0, 0);
  var heldQuat = new THREE.Quaternion();
  var site = new THREE.Vector3(SITE.x, SITE.y, SITE.z);
  var pulseColor = new THREE.Color(PULSE.r, PULSE.g, PULSE.b);
  var markerPos = new THREE.Vector3();
  var markerScreen = new THREE.Vector3();
  var held = false;
  var lastFollow = performance.now();
  var holdId = null;
  var lastPointer = null;
  var ticking = 0;

  function queueRender() {
    if (typeof ctx.queueRender === "function") ctx.queueRender();
    else if (scene && typeof scene.queueRender === "function") scene.queueRender();
  }

  function mvCamera() {
    return scene.camera || null;
  }

  function syncCamera() {
    var cam = mvCamera();
    if (!cam || !cam.matrixWorld || !cam.projectionMatrix) return null;
    proxyCam.matrixWorld.copy(cam.matrixWorld);
    proxyCam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    proxyCam.projectionMatrix.copy(cam.projectionMatrix);
    proxyCam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    proxyCam.position.setFromMatrixPosition(cam.matrixWorld);
    viewDir.set(0, 0, -1).transformDirection(cam.matrixWorld).normalize();
    return proxyCam;
  }

  function setRay(event) {
    var cam = syncCamera();
    if (!cam) return false;
    var p = ndcFromEvent(event, viewer);
    ndc.set(p.x, p.y);
    raycaster.setFromCamera(ndc, cam);
    return true;
  }

  function hits(objects) {
    if (!objects || !objects.length) return [];
    return raycaster.intersectObjects(objects, true);
  }

  function incisionStep() {
    var step = sequence.currentStep;
    return step && step.id === "incision" ? step : null;
  }

  function scalpelLive() {
    return !!incisionStep() && !sequence.isComplete;
  }

  function incisionBriefing() {
    return !!incisionStep() && sequence.isBriefing;
  }

  function setCursor(over) {
    viewer.style.cursor = held ? "grabbing" : over ? "grab" : "";
  }

  function setPulse(amount) {
    scalpel.root.traverse(function (child) {
      if (!child.isMesh || child.userData.pickProxy) return;
      var mats = Array.isArray(child.material) ? child.material : [child.material];
      for (var i = 0; i < mats.length; i++) {
        var mat = mats[i];
        if (!mat || !mat.emissive) continue;
        if (!mat.userData.restEmissive) {
          mat.userData.restEmissive = mat.emissive.clone();
        }
        mat.emissive.copy(mat.userData.restEmissive).lerp(pulseColor, amount);
      }
    });
  }

  function putBack() {
    if (holdId != null) {
      try { viewer.releasePointerCapture(holdId); } catch (err) {}
    }
    holdId = null;
    viewer.cameraControls = true;
    if (!held) {
      setPulse(incisionBriefing() ? pulseAmount() : 0);
      queueRender();
      return;
    }
    held = false;
    scalpel.root.position.copy(scalpel.restPosition);
    scalpel.root.quaternion.copy(scalpel.restQuaternion);
    setCursor(false);
    setPulse(incisionBriefing() ? pulseAmount() : 0);
    queueRender();
  }

  function heldOrientation() {
    if (viewDir.lengthSq() < 0.0001) viewDir.set(0, 0, -1);
    heldQuat.setFromUnitVectors(localTipDir, viewDir);
    scalpel.root.quaternion.copy(heldQuat);
  }

  function snapToMarker(target, dt, event) {
    var step = incisionStep();
    if (!step || sequence.isBriefing || step.isComplete || !event) return;
    var cam = proxyCam;
    var marker = scene.getObjectByName && scene.getObjectByName("incision-marker");
    if (!cam || !marker || !marker.visible) return;
    marker.getWorldPosition(markerPos);
    markerScreen.copy(markerPos).project(cam);
    if (markerScreen.z < -1 || markerScreen.z > 1) return;
    var rect = viewer.getBoundingClientRect();
    var mx = (markerScreen.x * 0.5 + 0.5) * rect.width + rect.left;
    var my = (-markerScreen.y * 0.5 + 0.5) * rect.height + rect.top;
    var dx = event.clientX - mx;
    var dy = event.clientY - my;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > SNAP_PX) return;
    var falloff = 1 - dist / SNAP_PX;
    var blend = 1 - Math.exp(-SNAP_SHARPNESS * falloff * falloff * dt);
    target.lerp(markerPos, blend);
  }

  function follow(event, dt) {
    if (!held || !setRay(event)) return;
    if (!(dt > 0)) dt = 1 / 60;
    plane.setFromNormalAndCoplanarPoint(viewDir, site);
    if (!raycaster.ray.intersectPlane(plane, planeHit)) return;
    snapToMarker(planeHit, dt, event);
    heldOrientation();
    scalpel.root.updateMatrixWorld(true);
    var tip = scalpel.root.getObjectByName("tip");
    if (tip && typeof tip.getWorldPosition === "function") {
      tip.getWorldPosition(tipWorld);
    } else {
      tipWorld.setFromMatrixPosition(scalpel.root.matrixWorld);
    }
    scalpel.root.position.x += planeHit.x - tipWorld.x;
    scalpel.root.position.y += planeHit.y - tipWorld.y;
    scalpel.root.position.z += planeHit.z - tipWorld.z;
    queueRender();
  }

  function screenHit(event) {
    var cam = syncCamera();
    if (!cam) return false;
    scalpel.root.updateMatrixWorld(true);
    worldBox.setFromObject(scalpel.root);
    if (worldBox.isEmpty()) return false;
    worldBox.getCenter(boxCenter);
    worldBox.getSize(boxSize);
    projected.copy(boxCenter).project(cam);
    if (projected.z < -1 || projected.z > 1) return false;
    var rect = viewer.getBoundingClientRect();
    var sx = (projected.x * 0.5 + 0.5) * rect.width + rect.left;
    var sy = (-projected.y * 0.5 + 0.5) * rect.height + rect.top;
    var span = Math.max(boxSize.x, boxSize.y, boxSize.z, 0.08);
    var radiusPx = Math.max(48, (span / Math.max(scene.camera && scene.camera.position
      ? scene.camera.position.distanceTo(boxCenter) : 1, 0.2)) * rect.height * 0.6);
    var dx = event.clientX - sx;
    var dy = event.clientY - sy;
    return (dx * dx + dy * dy) <= radiusPx * radiusPx;
  }

  function hitScalpel(event) {
    if (!setRay(event)) return screenHit(event);
    var objects = [scalpel.pick, scalpel.root].filter(Boolean);
    if (hits(objects).length) return true;
    return screenHit(event);
  }

  function pick(event) {
    if (held) return;
    if (incisionStep() && sequence.isBriefing) {
      sequence.continueCurrentStep();
    }
    held = true;
    holdId = event && event.pointerId != null ? event.pointerId : null;
    setPulse(0);
    setCursor(true);
    viewer.cameraControls = false;
    if (holdId != null) {
      try { viewer.setPointerCapture(holdId); } catch (err) {}
    }
    if (event) follow(event);
    else {
      heldOrientation();
      queueRender();
    }
  }

  function pulseAmount() {
    var t = performance.now() * 0.001 * PULSE_HZ * Math.PI * 2;
    return (0.5 + 0.5 * Math.sin(t)) * PULSE_BLEND;
  }

  function onPointerDown(event) {
    if (event.button !== 0 || event.shiftKey) return false;
    lastPointer = event;
    if (held) return true;
    if (!scalpelLive() || !eventOver(event, viewer)) return false;
    if (!hitScalpel(event)) return false;
    pick(event);
    return true;
  }

  function onPointerMove(event) {
    lastPointer = event;
    if (held) {
      if (holdId == null || event.pointerId === holdId) {
        var now = performance.now();
        follow(event, Math.min(0.05, (now - lastFollow) / 1000));
        lastFollow = now;
      }
      return;
    }
    if (!scalpelLive() || !eventOver(event, viewer)) {
      setCursor(false);
      return;
    }
    setCursor(hitScalpel(event));
  }

  function onPointerUp(event) {
    if (!held) return;
    if (holdId != null && event.pointerId !== holdId) return;
    putBack();
  }

  function onKeyDown(event) {
    if (event.key === "Escape" || event.key === "Esc") {
      putBack();
    }
  }

  function onSequenceChange() {
    if (!incisionStep() || sequence.isComplete) {
      putBack();
      setPulse(0);
      return;
    }
    if (!scalpelLive() && held) putBack();
    if (!held) setPulse(incisionBriefing() ? pulseAmount() : 0);
    queueRender();
  }

  function tick() {
    ticking = requestAnimationFrame(tick);
    var now = performance.now();
    var dt = Math.min(0.05, (now - lastFollow) / 1000);
    if (held && lastPointer) {
      follow(lastPointer, dt);
      lastFollow = now;
    } else if (!held && incisionBriefing()) {
      setPulse(pulseAmount());
      queueRender();
    }
  }

  function onCameraChange() {
    if (held && lastPointer) follow(lastPointer);
  }

  if (typeof ctx.setPointerGuard === "function") {
    ctx.setPointerGuard(onPointerDown);
  } else {
    viewer.addEventListener("pointerdown", function (event) {
      if (onPointerDown(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
  }

  viewer.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", onPointerUp, true);
  viewer.addEventListener("lostpointercapture", onPointerUp);
  window.addEventListener("keydown", onKeyDown);
  viewer.addEventListener("camera-change", onCameraChange);
  sequence.onChange(onSequenceChange);
  sequence.onProcedureComplete(onSequenceChange);
  onSequenceChange();
  ticking = requestAnimationFrame(tick);

  return {
    get held() {
      return held;
    },
    getTipWorld: function (out) {
      var target = out || new THREE.Vector3();
      scalpel.root.updateMatrixWorld(true);
      var tipNode = scalpel.root.getObjectByName("tip");
      if (tipNode && typeof tipNode.getWorldPosition === "function") {
        tipNode.getWorldPosition(target);
      } else {
        target.setFromMatrixPosition(scalpel.root.matrixWorld);
      }
      return target;
    },
    putBack: putBack,
    dispose: function () {
      cancelAnimationFrame(ticking);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
      viewer.removeEventListener("lostpointercapture", onPointerUp);
      viewer.removeEventListener("pointermove", onPointerMove);
      viewer.removeEventListener("camera-change", onCameraChange);
      putBack();
      setPulse(0);
      setCursor(false);
    }
  };
}
