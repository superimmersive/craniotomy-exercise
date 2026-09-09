import { recutClosedPath, samplePath, nearestOnScreen } from "./spline.js";
import { bindToolHold } from "./toolhold.js";
import { createView, syncView, projectWorld } from "./input.js";

var RADIUS_PX = 56;
var LOOK_AHEAD = 0.03;
var LOOK_BEHIND = 0.01;
var MAX_SPEED = 0.08;
var SHARPNESS = 12;
var COMPLETE_AT = 0.99;
var GHOST_COLOR = 0xcbd5e1;
var CUT_COLOR = 0xd6d3d1;
var MARKER_COLOR = 0x38bdf8;
var HOLE1 = { x: 0.0535, y: 0.3403, z: 0.0027 };

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

export function bindCraniotome(ctx, sequence, curveJson, hole1) {
  var THREE = ctx.THREE;
  var scene = ctx.scene;
  var viewer = ctx.viewer;
  var target = hole1 ? { x: hole1.x, y: hole1.y, z: hole1.z } : HOLE1;
  var path = recutClosedPath(curveJson, target, { mirrorX: true });
  var step = sequence.getStep("craniotome");
  var view = createView(THREE);
  var group = new THREE.Group();
  group.name = "craniotome-guides";
  scene.add(group);

  var baked = scene.getObjectByName && scene.getObjectByName("SkullCap_Spline");
  if (baked) baked.visible = false;

  var ghost = makeTube(THREE, samplePath(path, 0, 1, 64), 0.0009, GHOST_COLOR, 0.4);
  if (ghost) {
    ghost.name = "craniotome-ghost";
    group.add(ghost);
  }

  var cutMesh = null;
  var marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.0045, 16, 12),
    new THREE.MeshBasicMaterial({ color: MARKER_COLOR })
  );
  marker.name = "craniotome-marker";
  group.add(marker);

  var progress = 0;
  var targetT = 0;
  var lastTime = performance.now();
  var built = -1;
  var ticking = 0;
  var cursorX = 0;
  var cursorY = 0;
  var hasCursor = false;

  var hold = bindToolHold(ctx, sequence, {
    toolId: "craniotome",
    stepId: "craniotome",
    localTipDir: [0, -1, 0],
    snapMarkerName: "craniotome-marker"
  });

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
    cutMesh = makeTube(
      THREE,
      samplePath(path, 0, amount, Math.max(8, Math.ceil(amount * 64))),
      0.0016,
      CUT_COLOR,
      1
    );
    if (cutMesh) {
      cutMesh.name = "craniotome-cut";
      group.add(cutMesh);
    }
  }

  function placeMarker() {
    var p = path.position(progress);
    marker.position.set(p.x, p.y, p.z);
  }

  function applyProgress(value) {
    progress = value;
    targetT = value;
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
    if (hold) hold.putBack();
    step.completeStep();
  }

  function reset() {
    progress = 0;
    targetT = 0;
    applyProgress(0);
  }

  function projectPoint(p) {
    if (!syncView(view, scene)) return null;
    return projectWorld(view, viewer, p.x, p.y, p.z);
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
    step.setEngagedCheck(function () {
      return !!(hold && hold.held);
    });
  }

  function onPointer(event) {
    cursorX = event.clientX;
    cursorY = event.clientY;
    hasCursor = true;
  }

  function track(now) {
    var dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    if (!live() || !hold || !hold.held || !hasCursor) return;

    var length = path.length;
    if (length <= 0) return;
    var hit = nearestOnScreen(
      path,
      cursorX,
      cursorY,
      targetT - LOOK_BEHIND / length,
      targetT + LOOK_AHEAD / length,
      projectPoint
    );
    if (hit.distance <= RADIUS_PX && hit.t > targetT) {
      targetT = hit.t > 1 ? 1 : hit.t;
    }

    var blend = SHARPNESS > 0 ? 1 - Math.exp(-SHARPNESS * dt) : 1;
    var desired = progress + (targetT - progress) * blend;
    var maxStep = MAX_SPEED * dt / length;
    var stepAmt = desired - progress;
    if (stepAmt < 0) stepAmt = 0;
    if (stepAmt > maxStep) stepAmt = maxStep;
    if (stepAmt > 1e-6) applyProgress(progress + stepAmt);
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
      if (hold) hold.dispose();
      if (group.parent) group.parent.remove(group);
    }
  };
}
