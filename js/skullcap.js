import {
  eventOver,
  createView,
  syncView,
  setRayFromEvent,
  projectWorld
} from "./input.js";

var SEAT_RADIUS = 0.08;
var SEAT_PX = 80;
var PULSE = { r: 0.2, g: 0.75, b: 1 };
var PULSE_HZ = 0.9;
var PULSE_BLEND = 0.7;

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
    } else {
      placePos.copy(bowl.restPosition);
      placePos.y += 0.04;
    }
  } else {
    placePos.set(0.377, 0.04, 0);
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
  var lifted = false;
  var holdId = null;
  var lastPointer = null;
  var lastFollow = performance.now();
  var ticking = 0;

  function queueRender() {
    if (typeof ctx.queueRender === "function") ctx.queueRender();
  }

  function live() {
    return step && sequence.currentStep === step && !sequence.isComplete && !seated;
  }

  function briefing() {
    return live() && sequence.isBriefing;
  }

  function setPulse(amount) {
    cap.traverse(function (child) {
      if (!child.isMesh || !child.material) return;
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

  function showMarker() {
    marker.visible = live() && !seated;
  }

  function restoreHome() {
    if (homeParent && cap.parent !== homeParent) homeParent.add(cap);
    cap.position.copy(restPosition);
    cap.quaternion.copy(restQuaternion);
    cap.scale.copy(restScale);
    lifted = false;
    seated = false;
    held = false;
    setPulse(0);
    showMarker();
    queueRender();
  }

  function snapToBowl() {
    if (holdId != null) {
      try { viewer.releasePointerCapture(holdId); } catch (err) {}
      holdId = null;
    }
    if (cap.parent !== scene) scene.attach(cap);
    cap.parent.updateMatrixWorld(true);
    cap.position.copy(placePos);
    if (cap.parent.worldToLocal) cap.parent.worldToLocal(cap.position);
    seated = true;
    lifted = true;
    held = false;
    viewer.cameraControls = true;
    setPulse(0);
    showMarker();
    if (step) step.setProgress(1);
    sequence.ping();
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
      snapToBowl();
      completeIfSeated();
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
    if (held || seated) return;
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
    if (!seated && nearSeat(event, true)) {
      snapToBowl();
      completeIfSeated();
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
      if (live()) {
        viewer.style.cursor = "";
        viewer.cameraControls = true;
      }
      return;
    }
    var over = hitCap(event);
    viewer.style.cursor = over ? "grab" : "";
    viewer.cameraControls = !over;
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
      snapToBowl();
      originalComplete.call(step);
    };
    step.setEngagedCheck(function () {
      return held;
    });
  }

  if (typeof ctx.setPointerGuard === "function") ctx.setPointerGuard(onPointerDown);
  viewer.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", onPointerUp, true);
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
      viewer.removeEventListener("pointermove", onPointerMove);
      if (marker.parent) marker.parent.remove(marker);
      restoreHome();
    }
  };
}
