import { buildPath, nearestOnScreen } from "./spline.js";

var RADIUS_PX = 80;
var LOOK_AHEAD = 0.06;
var LOOK_BEHIND = 0.06;
var MAX_SPEED = 0.2;
var SHARPNESS = 10;
var COMPLETE_AT = 0.95;
var HOLD_OPEN = 0.999;
var LIFT_CLIP_NAMES = ["anim_LiftSkinFlap", "Action.003", "Action.004"];

function pickViewerClipName(viewer) {
  var names = viewer.availableAnimations || [];
  var i;
  for (i = 0; i < LIFT_CLIP_NAMES.length; i++) {
    if (names.indexOf(LIFT_CLIP_NAMES[i]) >= 0) return LIFT_CLIP_NAMES[i];
  }
  return names[0] || "";
}

function ndcFromEvent(event, el) {
  var rect = el.getBoundingClientRect();
  var w = Math.max(rect.width, 1);
  var h = Math.max(rect.height, 1);
  return {
    x: ((event.clientX - rect.left) / w) * 2 - 1,
    y: -((event.clientY - rect.top) / h) * 2 + 1
  };
}

export function bindSkinFlap(ctx, sequence, curveJson) {
  var THREE = ctx.THREE;
  var scene = ctx.scene;
  var viewer = ctx.viewer;
  var path = buildPath(curveJson, { mirrorX: true });
  var step = sequence.getStep("skinFlap");
  var raycaster = new THREE.Raycaster();
  var proxyCam = new THREE.PerspectiveCamera();
  var ndc = new THREE.Vector2();
  var projected = new THREE.Vector3();
  var scratch = new THREE.Vector3();
  var cursorX = 0;
  var cursorY = 0;

  var group = new THREE.Group();
  group.name = "skin-flap-guides";
  scene.add(group);

  var ghostPts = [];
  var i;
  for (i = 0; i <= 32; i++) {
    var gp = path.position(i / 32);
    ghostPts.push(new THREE.Vector3(gp.x, gp.y, gp.z));
  }
  var ghost = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(ghostPts),
    new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.45 })
  );
  ghost.frustumCulled = false;
  group.add(ghost);

  var bead = new THREE.Mesh(
    new THREE.SphereGeometry(0.008, 20, 16),
    new THREE.MeshBasicMaterial({ color: 0xfbbf24 })
  );
  bead.name = "skin-flap-bead";
  group.add(bead);

  var pick = new THREE.Mesh(
    new THREE.SphereGeometry(0.02, 16, 12),
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false
    })
  );
  pick.name = "pick-skin-flap";
  bead.add(pick);

  var lift = null;

  var progress = 0;
  var target = 0;
  var held = false;
  var holdId = null;
  var lastTime = performance.now();
  var ticking = 0;
  var latched = false;

  function queueRender() {
    if (typeof ctx.queueRender === "function") ctx.queueRender();
  }

  function syncCamera() {
    var cam = scene.camera;
    if (!cam || !cam.matrixWorld || !cam.projectionMatrix) return null;
    proxyCam.matrixWorld.copy(cam.matrixWorld);
    proxyCam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    proxyCam.projectionMatrix.copy(cam.projectionMatrix);
    proxyCam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    return proxyCam;
  }

  function projectPoint(p) {
    var cam = syncCamera();
    if (!cam) return null;
    scratch.set(p.x, p.y, p.z).project(cam);
    if (scratch.z < -1 || scratch.z > 1) return null;
    var rect = viewer.getBoundingClientRect();
    return {
      x: (scratch.x * 0.5 + 0.5) * rect.width + rect.left,
      y: (-scratch.y * 0.5 + 0.5) * rect.height + rect.top
    };
  }

  function setRay(event) {
    var cam = syncCamera();
    if (!cam) return false;
    var p = ndcFromEvent(event, viewer);
    ndc.set(p.x, p.y);
    raycaster.setFromCamera(ndc, cam);
    return true;
  }

  function live() {
    return step && sequence.currentStep === step && !step.isComplete &&
      (sequence.isWorking || sequence.isBriefing);
  }

  function placeBead() {
    var p = path.position(progress);
    bead.position.set(p.x, p.y, p.z);
    bead.visible = live() && !latched;
    ghost.visible = live() && !latched;
  }

  function poseAmount() {
    if (latched || (step && step.isComplete)) return 1;
    return progress;
  }

  function armLift() {
    if (lift) return lift;
    var name = pickViewerClipName(viewer) || "Action.003";
    if (viewer.animationName !== name) viewer.animationName = name;
    var loopOnce = THREE.LoopOnce || 2200;
    if (scene && typeof scene.playAnimation === "function") {
      scene.playAnimation(name, 0, loopOnce, 1);
      if (typeof scene.pauseAnimation === "function") scene.pauseAnimation();
    } else if (typeof viewer.play === "function") {
      viewer.play({ repetitions: 1 });
    }
    if (typeof viewer.pause === "function") viewer.pause();
    lift = {
      name: name,
      duration: viewer.duration > 0 ? viewer.duration : 3.75
    };
    return lift;
  }

  function applyPose(amount) {
    var player = armLift();
    if (!player) return;
    if (typeof viewer.pause === "function") viewer.pause();
    var duration = viewer.duration > 0 ? viewer.duration : player.duration;
    var t = amount * duration;
    if (amount >= HOLD_OPEN) t = duration * HOLD_OPEN;
    if (t < 0) t = 0;
    viewer.currentTime = t;
    if (scene) scene.animationTime = t;
    queueRender();
  }

  function applyProgress(value) {
    if (latched && value < 1) value = 1;
    progress = value < 0 ? 0 : value > 1 ? 1 : value;
    target = progress;
    if (step) step.setProgress(progress);
    sequence.ping();
    applyPose(poseAmount());
    placeBead();
    queueRender();
  }

  function complete() {
    latched = true;
    applyProgress(1);
    held = false;
    viewer.cameraControls = true;
    if (step && !step.isComplete) step.completeStep();
    placeBead();
  }

  function reset() {
    latched = false;
    held = false;
    applyProgress(0);
  }

  if (step) {
    var originalReset = step.resetStep;
    var originalComplete = step.completeStep;
    step.resetStep = function () {
      originalReset.call(step);
      reset();
    };
    step.completeStep = function () {
      latched = true;
      applyProgress(1);
      originalComplete.call(step);
      placeBead();
    };
  }

  function hitBead(event) {
    if (!setRay(event)) return false;
    if (raycaster.intersectObject(bead, true).length) return true;
    bead.updateMatrixWorld(true);
    projected.copy(bead.position).project(proxyCam);
    var rect = viewer.getBoundingClientRect();
    var sx = (projected.x * 0.5 + 0.5) * rect.width + rect.left;
    var sy = (-projected.y * 0.5 + 0.5) * rect.height + rect.top;
    var dx = event.clientX - sx;
    var dy = event.clientY - sy;
    return dx * dx + dy * dy <= 40 * 40;
  }

  function onPointerDown(event) {
    if (event.button !== 0 || event.shiftKey) return false;
    if (!live() || latched) return false;
    if (!hitBead(event)) return false;
    if (sequence.isBriefing) sequence.continueCurrentStep();
    held = true;
    holdId = event.pointerId;
    cursorX = event.clientX;
    cursorY = event.clientY;
    viewer.cameraControls = false;
    try { viewer.setPointerCapture(holdId); } catch (err) {}
    viewer.style.cursor = "grabbing";
    return true;
  }

  function onPointerMove(event) {
    if (held && (holdId == null || event.pointerId === holdId)) {
      cursorX = event.clientX;
      cursorY = event.clientY;
      viewer.style.cursor = "grabbing";
      return;
    }
    if (!live() || latched) return;
    if (hitBead(event)) {
      viewer.style.cursor = "grab";
      viewer.cameraControls = false;
    }
  }

  function onPointerUp(event) {
    if (!held) return;
    if (holdId != null && event.pointerId !== holdId) return;
    held = false;
    holdId = null;
    viewer.cameraControls = true;
    viewer.style.cursor = "";
    try { viewer.releasePointerCapture(event.pointerId); } catch (err) {}
  }

  function track(now) {
    var dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    if (!held || !live()) return;
    var length = path.length;
    if (length <= 0) return;
    var hit = nearestOnScreen(
      path,
      cursorX,
      cursorY,
      target - LOOK_BEHIND / length,
      target + LOOK_AHEAD / length,
      projectPoint
    );
    if (hit.distance <= RADIUS_PX) {
      target = hit.t < 0 ? 0 : hit.t > 1 ? 1 : hit.t;
    }
    var blend = 1 - Math.exp(-SHARPNESS * dt);
    var desired = progress + (target - progress) * blend;
    var maxStep = MAX_SPEED * dt / length;
    var delta = desired - progress;
    if (delta > maxStep) delta = maxStep;
    if (delta < -maxStep) delta = -maxStep;
    if (Math.abs(delta) > 1e-6) applyProgress(progress + delta);
    if (progress >= COMPLETE_AT) complete();
  }

  function tick(now) {
    ticking = requestAnimationFrame(tick);
    track(now);
    placeBead();
    if (latched || (step && step.isComplete)) applyPose(1);
  }

  function onChange() {
    placeBead();
    applyPose(poseAmount());
    queueRender();
  }

  if (typeof ctx.setPointerGuard === "function") ctx.setPointerGuard(onPointerDown);
  viewer.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", onPointerUp, true);
  sequence.onChange(onChange);
  sequence.onProcedureComplete(function () {
    bead.visible = false;
    ghost.visible = false;
  });
  applyProgress(0);
  ticking = requestAnimationFrame(tick);

  return {
    dispose: function () {
      cancelAnimationFrame(ticking);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
      viewer.removeEventListener("pointermove", onPointerMove);
      if (group.parent) group.parent.remove(group);
      applyPose(0);
    }
  };
}
