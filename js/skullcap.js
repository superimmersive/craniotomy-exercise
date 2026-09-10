import {
  eventOver,
  createView,
  syncView,
  setRayFromEvent,
  projectWorld
} from "./input.js";

var SEAT_RADIUS = 0.08;
var SEAT_PX = 80;
var GRAVITY = -4.2;
var RESTITUTION = 0.28;
var AIR_DAMP = 1.6;
var XY_PULL = 10;
var SETTLE_SPEED = 0.05;
var PULSE = { r: 0, g: 0.62, b: 1 };
var PULSE_HZ = 0.9;
var PULSE_BLEND = 1;
var PULSE_INTENSITY = 2.4;

export function bindSkullCap(ctx, sequence) {
  var THREE = ctx.THREE;
  var scene = ctx.scene;
  var viewer = ctx.viewer;
  var step = sequence.getStep("skullCap");
  var tools = ctx.tools;
  var bowl = tools && tools.byId && tools.byId.bowl;
  var cap = scene.getObjectByName("SkullCap");
  if (!viewer || !scene || !cap) {
    return { dispose: function () {} };
  }

  var view = createView(THREE);
  var plane = new THREE.Plane();
  var planeHit = new THREE.Vector3();
  var capPos = new THREE.Vector3();
  var placePos = new THREE.Vector3();
  var seatPos = new THREE.Vector3();
  var vel = new THREE.Vector3();
  var pulseColor = new THREE.Color(PULSE.r, PULSE.g, PULSE.b);
  var box = new THREE.Box3();
  var boxCenter = new THREE.Vector3();
  var worldBox = new THREE.Box3();
  var projected = new THREE.Vector3();

  var homeParent = cap.parent;
  var restPosition = cap.position.clone();
  var restQuaternion = cap.quaternion.clone();
  var restScale = cap.scale.clone();

  if (bowl && bowl.root) {
    bowl.root.updateMatrixWorld(true);
    box.setFromObject(bowl.root);
    if (!box.isEmpty()) {
      box.getCenter(placePos);
      placePos.y = box.max.y + 0.012;
      seatPos.copy(placePos);
      seatPos.y = box.min.y + Math.max(0.02, (box.max.y - box.min.y) * 0.38);
    } else {
      placePos.copy(bowl.restPosition);
      placePos.y += 0.04;
      seatPos.copy(placePos);
      seatPos.y -= 0.045;
    }
  } else {
    placePos.set(0.377, 0.04, 0);
    seatPos.set(0.377, 0.012, 0);
  }

  var marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.012, 16, 12),
    new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.7,
      depthWrite: false
    })
  );
  marker.name = "skullcap-placement";
  marker.position.copy(placePos);
  scene.add(marker);

  var held = false;
  var seated = false;
  var dropping = false;
  var dropUntil = 0;
  var lifted = false;
  var holdId = null;
  var lastPointer = null;
  var lastFollow = performance.now();
  var ticking = 0;
  var pulseReady = false;

  function isolateCapMaterials() {
    if (pulseReady) return;
    pulseReady = true;
    cap.traverse(function (child) {
      if (!child.isMesh || !child.material) return;
      var src = Array.isArray(child.material) ? child.material : [child.material];
      var cloned = [];
      var i;
      for (i = 0; i < src.length; i++) {
        var mat = src[i] ? src[i].clone() : src[i];
        if (mat) {
          if (mat.emissive) mat.userData.restEmissive = mat.emissive.clone();
          if (mat.color) mat.userData.restColor = mat.color.clone();
          mat.userData.restEmissiveIntensity = mat.emissiveIntensity || 0;
        }
        cloned.push(mat);
      }
      child.material = Array.isArray(child.material) ? cloned : cloned[0];
    });
  }

  function queueRender() {
    if (typeof ctx.queueRender === "function") ctx.queueRender();
  }

  function live() {
    return step && sequence.currentStep === step && !sequence.isComplete && !seated && !dropping;
  }

  function briefing() {
    return live() && sequence.isBriefing;
  }

  function setPulse(amount) {
    isolateCapMaterials();
    cap.traverse(function (child) {
      if (!child.isMesh || !child.material) return;
      var mats = Array.isArray(child.material) ? child.material : [child.material];
      for (var i = 0; i < mats.length; i++) {
        var mat = mats[i];
        if (!mat || !mat.emissive) continue;
        if (!mat.userData.restEmissive) mat.userData.restEmissive = mat.emissive.clone();
        if (!mat.userData.restColor && mat.color) mat.userData.restColor = mat.color.clone();
        if (mat.userData.restEmissiveIntensity == null) {
          mat.userData.restEmissiveIntensity = mat.emissiveIntensity || 0;
        }
        mat.emissive.copy(pulseColor).multiplyScalar(amount);
        mat.emissiveIntensity = mat.userData.restEmissiveIntensity + amount * PULSE_INTENSITY;
        if (mat.color && mat.userData.restColor) {
          mat.color.copy(mat.userData.restColor).lerp(pulseColor, amount * 0.55);
        }
      }
    });
  }

  function pulseAmount() {
    var t = performance.now() * 0.001 * PULSE_HZ * Math.PI * 2;
    return (0.5 + 0.5 * Math.sin(t)) * PULSE_BLEND;
  }

  function showMarker() {
    marker.visible = live() && !seated && !dropping;
  }

  function restoreHome() {
    if (homeParent && cap.parent !== homeParent) homeParent.add(cap);
    cap.position.copy(restPosition);
    cap.quaternion.copy(restQuaternion);
    cap.scale.copy(restScale);
    lifted = false;
    seated = false;
    dropping = false;
    vel.set(0, 0, 0);
    held = false;
    setPulse(0);
    showMarker();
    queueRender();
  }

  function setWorldPos(world) {
    if (cap.parent !== scene) scene.attach(cap);
    cap.parent.updateMatrixWorld(true);
    cap.position.copy(world);
    if (cap.parent.worldToLocal) cap.parent.worldToLocal(cap.position);
  }

  function seatInBowl() {
    dropping = false;
    vel.set(0, 0, 0);
    if (holdId != null) {
      try { viewer.releasePointerCapture(holdId); } catch (err) {}
      holdId = null;
    }
    setWorldPos(seatPos);
    seated = true;
    lifted = true;
    held = false;
    viewer.cameraControls = true;
    viewer.style.cursor = "";
    setPulse(0);
    showMarker();
    if (step) step.setProgress(1);
    sequence.ping();
    queueRender();
  }

  function startDrop() {
    if (dropping || seated) return;
    dropping = true;
    held = false;
    if (holdId != null) {
      try { viewer.releasePointerCapture(holdId); } catch (err) {}
      holdId = null;
    }
    viewer.cameraControls = true;
    viewer.style.cursor = "";
    setPulse(0);
    if (cap.parent !== scene) scene.attach(cap);
    cap.updateMatrixWorld(true);
    cap.getWorldPosition(capPos);
    vel.set(
      (seatPos.x - capPos.x) * 0.4,
      -0.12,
      (seatPos.z - capPos.z) * 0.4
    );
    lastFollow = performance.now();
    dropUntil = lastFollow + 1400;
    showMarker();
    if (step) step.setProgress(0.99);
    sequence.ping();
    queueRender();
  }

  function tickDrop(now) {
    var dt = Math.min(0.04, (now - lastFollow) / 1000);
    if (!(dt > 0)) dt = 1 / 60;
    lastFollow = now;
    cap.updateMatrixWorld(true);
    cap.getWorldPosition(capPos);
    vel.x += (seatPos.x - capPos.x) * XY_PULL * dt - vel.x * AIR_DAMP * dt;
    vel.z += (seatPos.z - capPos.z) * XY_PULL * dt - vel.z * AIR_DAMP * dt;
    vel.y += GRAVITY * dt;
    capPos.addScaledVector(vel, dt);
    if (capPos.y <= seatPos.y) {
      capPos.y = seatPos.y;
      if (vel.y < 0) vel.y = -vel.y * RESTITUTION;
      vel.x *= 0.5;
      vel.z *= 0.5;
      if (Math.abs(vel.y) < SETTLE_SPEED && vel.length() < SETTLE_SPEED * 3) {
        seatInBowl();
        completeIfSeated();
        return;
      }
    }
    if (now >= dropUntil) {
      seatInBowl();
      completeIfSeated();
      return;
    }
    setWorldPos(capPos);
    queueRender();
  }

  function reportCarry() {
    cap.getWorldPosition(capPos);
    var dist = capPos.distanceTo(placePos);
    var amount = 1 - dist / 0.28;
    if (amount < 0) amount = 0;
    if (amount > 0.98) amount = 0.98;
    if (seated) amount = 1;
    if (step) step.setProgress(amount);
    sequence.ping();
  }

  function nearSeat(event, allowScreen) {
    cap.getWorldPosition(capPos);
    if (capPos.distanceTo(placePos) <= SEAT_RADIUS) return true;
    if (!allowScreen || !event || !syncView(view, scene)) return false;
    var screen = projectWorld(view, viewer, placePos.x, placePos.y, placePos.z);
    if (!screen) return false;
    return Math.hypot(event.clientX - screen.x, event.clientY - screen.y) <= SEAT_PX;
  }

  function completeIfSeated() {
    if (!seated) return;
    if (step && !step.isComplete) step.completeStep();
  }

  function follow(event) {
    if (!held) return;
    if (!syncView(view, scene) || !setRayFromEvent(view, viewer, event)) return;
    cap.updateMatrixWorld(true);
    cap.getWorldPosition(capPos);
    plane.setFromNormalAndCoplanarPoint(view.viewDir, capPos);
    if (!view.raycaster.ray.intersectPlane(plane, planeHit)) return;
    if (cap.parent !== scene) scene.attach(cap);
    lifted = true;
    cap.parent.updateMatrixWorld(true);
    cap.position.copy(planeHit);
    if (cap.parent && cap.parent.worldToLocal) cap.parent.worldToLocal(cap.position);
    if (nearSeat(event, false)) {
      startDrop();
      return;
    }
    reportCarry();
    queueRender();
  }

  function hitCap(event) {
    if (!syncView(view, scene) || !setRayFromEvent(view, viewer, event)) return false;
    if (view.raycaster.intersectObject(cap, true).length) return true;
    cap.updateMatrixWorld(true);
    worldBox.setFromObject(cap);
    if (worldBox.isEmpty()) return false;
    worldBox.getCenter(boxCenter);
    projected.copy(boxCenter).project(view.proxyCam);
    if (projected.z < -1 || projected.z > 1) return false;
    var rect = viewer.getBoundingClientRect();
    var sx = (projected.x * 0.5 + 0.5) * rect.width + rect.left;
    var sy = (-projected.y * 0.5 + 0.5) * rect.height + rect.top;
    return Math.hypot(event.clientX - sx, event.clientY - sy) <= 64;
  }

  function pick(event) {
    if (held || seated || dropping) return;
    if (sequence.isBriefing) sequence.continueCurrentStep();
    held = true;
    holdId = event && event.pointerId != null ? event.pointerId : null;
    setPulse(0);
    viewer.style.cursor = "grabbing";
    viewer.cameraControls = false;
    if (holdId != null) {
      try { viewer.setPointerCapture(holdId); } catch (err) {}
    }
    if (cap.parent !== scene) scene.attach(cap);
    lifted = true;
    if (event) follow(event);
  }

  function release(event) {
    if (!held) return;
    if (holdId != null) {
      try { viewer.releasePointerCapture(holdId); } catch (err) {}
    }
    holdId = null;
    held = false;
    viewer.cameraControls = true;
    viewer.style.cursor = "";
    if (!seated && !dropping && nearSeat(event, true)) {
      startDrop();
      return;
    }
    reportCarry();
    queueRender();
  }

  function onPointerDown(event) {
    if (event.button !== 0 || event.shiftKey) return false;
    lastPointer = event;
    if (held) return true;
    if (!live() || !eventOver(event, viewer)) return false;
    if (!hitCap(event)) return false;
    pick(event);
    return true;
  }

  function onPointerMove(event) {
    lastPointer = event;
    if (held) {
      if (holdId == null || event.pointerId === holdId) follow(event);
      return;
    }
    if (!live() || !eventOver(event, viewer)) {
      if (live()) viewer.style.cursor = "";
      return;
    }
    viewer.style.cursor = hitCap(event) ? "grab" : "";
  }

  function onPointerUp(event) {
    if (!held) return;
    if (holdId != null && event.pointerId !== holdId) return;
    release(event);
  }

  function onKeyDown(event) {
    if (event.key === "Escape" || event.key === "Esc") release(event);
  }

  function onChange() {
    if (sequence.isComplete) {
      showMarker();
      return;
    }
    if (!live()) {
      if (held) release(lastPointer);
      setPulse(0);
      viewer.style.cursor = "";
    }
    showMarker();
    queueRender();
  }

  function tick() {
    ticking = requestAnimationFrame(tick);
    if (held && lastPointer) {
      follow(lastPointer);
      lastFollow = performance.now();
    } else if (dropping) {
      tickDrop(performance.now());
    } else if (!held && briefing()) {
      setPulse(pulseAmount());
      queueRender();
    }
  }

  if (step) {
    var originalReset = step.resetStep;
    var originalComplete = step.completeStep;
    step.resetStep = function () {
      originalReset.call(step);
      restoreHome();
    };
    step.completeStep = function () {
      seatInBowl();
      originalComplete.call(step);
    };
    step.setEngagedCheck(function () {
      return held || dropping;
    });
  }

  if (typeof ctx.setPointerGuard === "function") ctx.setPointerGuard(onPointerDown);
  viewer.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", onPointerUp, true);
  viewer.addEventListener("lostpointercapture", onPointerUp);
  window.addEventListener("keydown", onKeyDown);
  sequence.onChange(onChange);
  sequence.onProcedureComplete(function () {
    marker.visible = false;
    setPulse(0);
  });
  showMarker();
  ticking = requestAnimationFrame(tick);

  return {
    dispose: function () {
      cancelAnimationFrame(ticking);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
      viewer.removeEventListener("lostpointercapture", onPointerUp);
      viewer.removeEventListener("pointermove", onPointerMove);
      if (marker.parent) marker.parent.remove(marker);
      restoreHome();
    }
  };
}
