import {
  eventOver,
  createView,
  syncView,
  setRayFromEvent
} from "./input.js";

var PULSE = { r: 0.2, g: 0.75, b: 1 };
var PULSE_HZ = 0.9;
var PULSE_BLEND = 0.7;
var SNAP_PX = 56;
var SNAP_SHARPNESS = 14;
var SITE = { x: 0.055, y: 0.34, z: 0.02 };

export function bindToolHold(ctx, sequence, spec) {
  var viewer = ctx.viewer;
  var scene = ctx.scene;
  var THREE = ctx.THREE;
  var tools = ctx.tools;
  var tool = tools && tools.byId && tools.byId[spec.toolId];
  if (!viewer || !scene || !tool) {
    return {
      held: false,
      putBack: function () {},
      getTipWorld: function (out) { return out; },
      moveTipTo: function () {},
      setQuaternion: function () {},
      get lastPointer() { return null; },
      dispose: function () {}
    };
  }

  var view = createView(THREE);
  var plane = new THREE.Plane();
  var planeHit = new THREE.Vector3();
  var tipWorld = new THREE.Vector3();
  var boxCenter = new THREE.Vector3();
  var boxSize = new THREE.Vector3();
  var worldBox = new THREE.Box3();
  var projected = new THREE.Vector3();
  var markerPos = new THREE.Vector3();
  var markerScreen = new THREE.Vector3();
  var pulseColor = new THREE.Color(PULSE.r, PULSE.g, PULSE.b);
  var site = new THREE.Vector3(
    spec.site && spec.site.x != null ? spec.site.x : SITE.x,
    spec.site && spec.site.y != null ? spec.site.y : SITE.y,
    spec.site && spec.site.z != null ? spec.site.z : SITE.z
  );
  var localTipDir = new THREE.Vector3(
    spec.localTipDir ? spec.localTipDir[0] : 0,
    spec.localTipDir ? spec.localTipDir[1] : -1,
    spec.localTipDir ? spec.localTipDir[2] : 0
  );
  var heldQuat = new THREE.Quaternion();
  var held = false;
  var lastFollow = performance.now();
  var holdId = null;
  var lastPointer = null;
  var ticking = 0;
  var lastDt = 1 / 60;

  var api = {
    get held() { return held; },
    get event() { return lastPointer; },
    get dt() { return lastDt; },
    planeHit: planeHit,
    viewDir: view.viewDir,
    proxyCam: view.proxyCam,
    raycaster: view.raycaster,
    moveTipTo: moveTipTo,
    setQuaternion: setQuaternion,
    getTipWorld: getTipWorld,
    putBack: putBack,
    alignTo: alignTo
  };

  function queueRender() {
    if (typeof ctx.queueRender === "function") ctx.queueRender();
  }

  function live() {
    var step = sequence.currentStep;
    return !!(step && step.id === spec.stepId && !sequence.isComplete);
  }

  function briefing() {
    return live() && sequence.isBriefing;
  }

  function setCursor(over) {
    viewer.style.cursor = held ? "grabbing" : over ? "grab" : "";
  }

  function setPulse(amount) {
    tool.root.traverse(function (child) {
      if (!child.isMesh || child.userData.pickProxy) return;
      var mats = Array.isArray(child.material) ? child.material : [child.material];
      for (var i = 0; i < mats.length; i++) {
        var mat = mats[i];
        if (!mat || !mat.emissive) continue;
        if (!mat.userData.restEmissive) mat.userData.restEmissive = mat.emissive.clone();
        mat.emissive.copy(mat.userData.restEmissive).lerp(pulseColor, amount);
      }
    });
  }

  function pulseAmount() {
    var t = performance.now() * 0.001 * PULSE_HZ * Math.PI * 2;
    return (0.5 + 0.5 * Math.sin(t)) * PULSE_BLEND;
  }

  function getTipWorld(out) {
    var target = out || new THREE.Vector3();
    tool.root.updateMatrixWorld(true);
    var tipNode = spec.tipName ? tool.root.getObjectByName(spec.tipName) : null;
    if (tipNode && typeof tipNode.getWorldPosition === "function") {
      tipNode.getWorldPosition(target);
    } else {
      target.setFromMatrixPosition(tool.root.matrixWorld);
    }
    return target;
  }

  function moveTipTo(world) {
    tool.root.updateMatrixWorld(true);
    getTipWorld(tipWorld);
    tool.root.position.x += world.x - tipWorld.x;
    tool.root.position.y += world.y - tipWorld.y;
    tool.root.position.z += world.z - tipWorld.z;
  }

  function setQuaternion(q) {
    tool.root.quaternion.copy(q);
  }

  function alignTo(dir) {
    if (!dir || dir.lengthSq() < 1e-8) return;
    heldQuat.setFromUnitVectors(localTipDir, dir);
    tool.root.quaternion.copy(heldQuat);
  }

  function putBack() {
    if (holdId != null) {
      try { viewer.releasePointerCapture(holdId); } catch (err) {}
    }
    holdId = null;
    viewer.cameraControls = true;
    if (!held) {
      setPulse(briefing() ? pulseAmount() : 0);
      queueRender();
      return;
    }
    held = false;
    tool.root.position.copy(tool.restPosition);
    tool.root.quaternion.copy(tool.restQuaternion);
    setCursor(false);
    setPulse(briefing() ? pulseAmount() : 0);
    if (typeof spec.onRelease === "function") spec.onRelease(api);
    queueRender();
  }

  function snapToMarker(target, dt, event) {
    var name = spec.snapMarkerName;
    if (!name || sequence.isBriefing || !event) return;
    var cam = view.proxyCam;
    var marker = scene.getObjectByName && scene.getObjectByName(name);
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
    var radius = spec.snapPx || SNAP_PX;
    if (dist > radius) return;
    var falloff = 1 - dist / radius;
    var blend = 1 - Math.exp(-SNAP_SHARPNESS * falloff * falloff * dt);
    target.lerp(markerPos, blend);
  }

  function defaultFollow(event, dt) {
    if (view.viewDir.lengthSq() < 1e-8) view.viewDir.set(0, 0, -1);
    alignTo(view.viewDir);
    snapToMarker(planeHit, dt, event);
    moveTipTo(planeHit);
  }

  function follow(event, dt) {
    if (!held) return;
    if (!syncView(view, scene) || !setRayFromEvent(view, viewer, event)) return;
    if (!(dt > 0)) dt = 1 / 60;
    lastDt = dt;
    plane.setFromNormalAndCoplanarPoint(view.viewDir, site);
    if (!view.raycaster.ray.intersectPlane(plane, planeHit)) return;
    var owned = typeof spec.whileHeld === "function" && spec.whileHeld(api) === true;
    if (!owned) defaultFollow(event, dt);
    queueRender();
  }

  function screenHit(event) {
    if (!syncView(view, scene)) return false;
    tool.root.updateMatrixWorld(true);
    worldBox.setFromObject(tool.root);
    if (worldBox.isEmpty()) return false;
    worldBox.getCenter(boxCenter);
    worldBox.getSize(boxSize);
    projected.copy(boxCenter).project(view.proxyCam);
    if (projected.z < -1 || projected.z > 1) return false;
    var rect = viewer.getBoundingClientRect();
    var sx = (projected.x * 0.5 + 0.5) * rect.width + rect.left;
    var sy = (-projected.y * 0.5 + 0.5) * rect.height + rect.top;
    var span = Math.max(boxSize.x, boxSize.y, boxSize.z, 0.08);
    var dist = scene.camera && scene.camera.position
      ? scene.camera.position.distanceTo(boxCenter)
      : 1;
    var radiusPx = Math.max(48, (span / Math.max(dist, 0.2)) * rect.height * 0.6);
    var dx = event.clientX - sx;
    var dy = event.clientY - sy;
    return (dx * dx + dy * dy) <= radiusPx * radiusPx;
  }

  function extraHit(event) {
    if (typeof spec.hitExtra !== "function") return false;
    var extras = spec.hitExtra() || [];
    var i;
    if (syncView(view, scene) && setRayFromEvent(view, viewer, event)) {
      for (i = 0; i < extras.length; i++) {
        if (extras[i] && view.raycaster.intersectObject(extras[i], true).length) return true;
      }
    }
    for (i = 0; i < extras.length; i++) {
      if (!extras[i]) continue;
      extras[i].updateMatrixWorld(true);
      projected.setFromMatrixPosition(extras[i].matrixWorld).project(view.proxyCam);
      var rect = viewer.getBoundingClientRect();
      var sx = (projected.x * 0.5 + 0.5) * rect.width + rect.left;
      var sy = (-projected.y * 0.5 + 0.5) * rect.height + rect.top;
      if (Math.hypot(event.clientX - sx, event.clientY - sy) <= 56) return true;
    }
    return false;
  }

  function hitTool(event) {
    if (syncView(view, scene) && setRayFromEvent(view, viewer, event)) {
      var objects = [tool.pick, tool.root].filter(Boolean);
      if (view.raycaster.intersectObjects(objects, true).length) return true;
    }
    if (extraHit(event)) return true;
    return screenHit(event);
  }

  function pick(event) {
    if (held) return;
    if (live() && sequence.isBriefing) sequence.continueCurrentStep();
    held = true;
    holdId = event && event.pointerId != null ? event.pointerId : null;
    setPulse(0);
    setCursor(true);
    viewer.cameraControls = false;
    if (holdId != null) {
      try { viewer.setPointerCapture(holdId); } catch (err) {}
    }
    if (typeof spec.onPick === "function") spec.onPick(api);
    if (event) follow(event);
    else {
      alignTo(view.viewDir);
      queueRender();
    }
  }

  function onPointerDown(event) {
    if (event.button !== 0 || event.shiftKey) return false;
    lastPointer = event;
    if (held) return true;
    if (!live() || !eventOver(event, viewer)) return false;
    if (!hitTool(event)) return false;
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
    if (!live() || !eventOver(event, viewer)) {
      if (live()) {
        setCursor(false);
        viewer.cameraControls = true;
      }
      return;
    }
    var over = hitTool(event);
    setCursor(over);
    viewer.cameraControls = !over;
  }

  function onPointerUp(event) {
    if (!held) return;
    if (holdId != null && event.pointerId !== holdId) return;
    putBack();
  }

  function onKeyDown(event) {
    if (event.key === "Escape" || event.key === "Esc") putBack();
  }

  function onSequenceChange() {
    if (!live()) {
      putBack();
      setPulse(0);
      return;
    }
    if (!held) setPulse(briefing() ? pulseAmount() : 0);
    queueRender();
  }

  function tick() {
    ticking = requestAnimationFrame(tick);
    var now = performance.now();
    var dt = Math.min(0.05, (now - lastFollow) / 1000);
    if (held && lastPointer) {
      follow(lastPointer, dt);
      lastFollow = now;
    } else if (!held && briefing()) {
      setPulse(pulseAmount());
      queueRender();
    }
  }

  function onCameraChange() {
    if (held && lastPointer) follow(lastPointer);
  }

  if (typeof ctx.setPointerGuard === "function") ctx.setPointerGuard(onPointerDown);
  viewer.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", onPointerUp, true);
  window.addEventListener("keydown", onKeyDown);
  viewer.addEventListener("camera-change", onCameraChange);
  sequence.onChange(onSequenceChange);
  sequence.onProcedureComplete(onSequenceChange);
  if (typeof spec.bindStep === "function") spec.bindStep(api);
  onSequenceChange();
  ticking = requestAnimationFrame(tick);

  return {
    get held() { return held; },
    get lastPointer() { return lastPointer; },
    getTipWorld: getTipWorld,
    moveTipTo: moveTipTo,
    setQuaternion: setQuaternion,
    putBack: putBack,
    api: api,
    dispose: function () {
      cancelAnimationFrame(ticking);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
      viewer.removeEventListener("pointermove", onPointerMove);
      viewer.removeEventListener("camera-change", onCameraChange);
      putBack();
      setPulse(0);
      setCursor(false);
    }
  };
}
