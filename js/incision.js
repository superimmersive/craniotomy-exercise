import { buildPath, samplePath, nearestOnScreen } from "./spline.js";

var RADIUS_PX = 56;
var LOOK_AHEAD = 0.03;
var LOOK_BEHIND = 0.01;
var MAX_SPEED = 0.08;
var SHARPNESS = 12;
var COMPLETE_AT = 0.99;
var GHOST_COLOR = 0x94a3b8;
var CUT_COLOR = 0x7f1d1d;
var MARKER_COLOR = 0x38bdf8;

function vec(THREE, p) {
  return new THREE.Vector3(p.x, p.y, p.z);
}

function makeTube(THREE, points, radius, color, opacity) {
  if (!points || points.length < 2) return null;
  var pts = [];
  var i;
  for (i = 0; i < points.length; i++) pts.push(vec(THREE, points[i]));
  if (pts[0].distanceTo(pts[pts.length - 1]) < 1e-5) {
    pts[pts.length - 1] = pts[pts.length - 1].clone().add(new THREE.Vector3(0, 0.0002, 0));
  }
  var curve = new THREE.CatmullRomCurve3(pts);
  var geo = new THREE.TubeGeometry(curve, Math.max(8, points.length * 2), radius, 6, false);
  var mat = new THREE.MeshBasicMaterial({
    color: color,
    transparent: opacity < 1,
    opacity: opacity,
    depthWrite: false
  });
  var mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

export function bindIncision(ctx, sequence, pickup, curveJson) {
  var THREE = ctx.THREE;
  var scene = ctx.scene;
  var viewer = ctx.viewer;
  var path = buildPath(curveJson, { mirrorX: true });
  var step = sequence.getStep("incision");
  var group = new THREE.Group();
  group.name = "incision-guides";
  scene.add(group);

  var baked = scene.getObjectByName && scene.getObjectByName("skin_incision_line");
  if (baked) baked.visible = false;

  var ghost = makeTube(THREE, samplePath(path, 0, 1, 48), 0.0009, GHOST_COLOR, 0.35);
  if (ghost) {
    ghost.name = "incision-ghost";
    group.add(ghost);
  }

  var cutMesh = null;
  var marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.0045, 16, 12),
    new THREE.MeshBasicMaterial({ color: MARKER_COLOR })
  );
  marker.name = "incision-marker";
  group.add(marker);

  var progress = 0;
  var target = 0;
  var lastTime = performance.now();
  var built = -1;
  var ticking = 0;
  var cursorX = 0;
  var cursorY = 0;
  var hasCursor = false;
  var proxyCam = new THREE.PerspectiveCamera();
  var scratch = new THREE.Vector3();

  function queueRender() {
    if (typeof ctx.queueRender === "function") ctx.queueRender();
  }

  function live() {
    return step && sequence.currentStep === step && sequence.isWorking && !step.isComplete;
  }

  function showGuides(on) {
    group.visible = on || progress > 0.002;
    if (ghost) ghost.visible = on && !step.isComplete;
    marker.visible = on && !step.isComplete;
  }

  function rebuildCut(amount) {
    if (cutMesh && cutMesh.parent) cutMesh.parent.remove(cutMesh);
    cutMesh = null;
    built = amount;
    if (amount < 0.002) return;
    cutMesh = makeTube(THREE, samplePath(path, 0, amount, Math.max(8, Math.ceil(amount * 48))), 0.0014, CUT_COLOR, 1);
    if (cutMesh) {
      cutMesh.name = "incision-cut";
      group.add(cutMesh);
    }
  }

  function placeMarker() {
    var p = path.position(progress);
    marker.position.set(p.x, p.y, p.z);
  }

  function applyProgress(value) {
    progress = value;
    target = value;
    if (step) step.setProgress(value);
    sequence.ping();
    if (Math.abs(value - built) >= 0.004 || value >= 1 || value <= 0) rebuildCut(value);
    placeMarker();
    showGuides(sequence.currentStep === step);
    queueRender();
  }

  function complete() {
    if (!step || step.isComplete) {
      applyProgress(1);
      return;
    }
    applyProgress(1);
    step.completeStep();
    if (pickup && pickup.putBack) pickup.putBack();
  }

  function reset() {
    progress = 0;
    target = 0;
    applyProgress(0);
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
    if (!cam || !viewer) return null;
    scratch.set(p.x, p.y, p.z).project(cam);
    if (scratch.z < -1 || scratch.z > 1) return null;
    var rect = viewer.getBoundingClientRect();
    return {
      x: (scratch.x * 0.5 + 0.5) * rect.width + rect.left,
      y: (-scratch.y * 0.5 + 0.5) * rect.height + rect.top
    };
  }

  if (step) {
    var originalReset = step.resetStep;
    var originalComplete = step.completeStep;
    step.resetStep = function () {
      originalReset.call(step);
      reset();
    };
    step.completeStep = function () {
      applyProgress(1);
      originalComplete.call(step);
    };
  }

  function onPointer(event) {
    cursorX = event.clientX;
    cursorY = event.clientY;
    hasCursor = true;
  }

  function track(now) {
    var dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    if (!live() || !pickup || !pickup.held || !hasCursor) return;

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
    if (hit.distance <= RADIUS_PX && hit.t > target) {
      target = hit.t > 1 ? 1 : hit.t;
    }

    var blend = SHARPNESS > 0 ? 1 - Math.exp(-SHARPNESS * dt) : 1;
    var desired = progress + (target - progress) * blend;
    var maxStep = MAX_SPEED * dt / length;
    var stepAmt = desired - progress;
    if (stepAmt < 0) stepAmt = 0;
    if (stepAmt > maxStep) stepAmt = maxStep;
    if (stepAmt > 1e-6) {
      applyProgress(progress + stepAmt);
    }
    if (progress >= COMPLETE_AT) complete();
  }

  function tick(now) {
    ticking = requestAnimationFrame(tick);
    track(now);
    showGuides(sequence.currentStep === step && !sequence.isComplete);
  }

  function onChange() {
    showGuides(sequence.currentStep === step && !sequence.isComplete);
    if (sequence.currentStep === step) placeMarker();
    queueRender();
  }

  window.addEventListener("pointermove", onPointer, true);
  sequence.onChange(onChange);
  sequence.onProcedureComplete(function () {
    showGuides(false);
  });
  applyProgress(0);
  ticking = requestAnimationFrame(tick);

  return {
    path: path,
    dispose: function () {
      cancelAnimationFrame(ticking);
      window.removeEventListener("pointermove", onPointer, true);
      if (group.parent) group.parent.remove(group);
    }
  };
}
