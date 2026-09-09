import { bindToolHold } from "./toolhold.js";
import { createView, syncView, projectWorld } from "./input.js";

var HOLE_NAMES = [
  "skull_drill_hole_01",
  "skull_drill_hole_02",
  "skull_drill_hole_03",
  "skull_drill_hole_04"
];
var FALLBACK = [
  [0.0535, 0.3403, 0.0027],
  [0.0470, 0.3520, -0.0323],
  [0.0652, 0.3222, -0.0458],
  [0.0695, 0.3097, -0.0111]
];
var INTERIOR = { x: 0.055, y: 0.31, z: -0.015 };
var HOLE_DEPTH = 0.012;
var MAX_PLUNGE = 0.05;
var WITHDRAW = 0.005;
var SEAT_PX = 64;
var LEAVE_PX = 90;
var ARMED = 0x38bdf8;

export function bindDrill(ctx, sequence) {
  var THREE = ctx.THREE;
  var scene = ctx.scene;
  var viewer = ctx.viewer;
  var step = sequence.getStep("drill");
  var view = createView(THREE);
  var box = new THREE.Box3();
  var into = new THREE.Vector3();
  var tipAt = new THREE.Vector3();
  var group = new THREE.Group();
  group.name = "drill-guides";
  scene.add(group);

  var holes = HOLE_NAMES.map(function (name, index) {
    var object = scene.getObjectByName(name);
    var pos = new THREE.Vector3();
    if (object) {
      object.updateMatrixWorld(true);
      box.setFromObject(object);
      if (!box.isEmpty()) box.getCenter(pos);
      else pos.set(FALLBACK[index][0], FALLBACK[index][1], FALLBACK[index][2]);
    } else {
      pos.set(FALLBACK[index][0], FALLBACK[index][1], FALLBACK[index][2]);
    }
    into.set(INTERIOR.x - pos.x, INTERIOR.y - pos.y, INTERIOR.z - pos.z);
    if (into.lengthSq() < 1e-8) into.set(0, -1, 0);
    else into.normalize();
    cacheHoleMaterials(object);
    return {
      name: name,
      object: object,
      pos: pos.clone(),
      into: into.clone(),
      maxDepth: 0,
      through: false
    };
  });

  var zAxis = new THREE.Vector3(0, 0, 1);
  var ghost = new THREE.Mesh(
    new THREE.CylinderGeometry(0.004, 0.004, HOLE_DEPTH, 12),
    new THREE.MeshBasicMaterial({
      color: ARMED,
      transparent: true,
      opacity: 0.35,
      depthWrite: false
    })
  );
  ghost.name = "drill-ghost";
  ghost.geometry.rotateX(Math.PI / 2);
  group.add(ghost);

  var index = 0;
  var seated = false;
  var depth = 0;
  var hold = null;

  function queueRender() {
    if (typeof ctx.queueRender === "function") ctx.queueRender();
  }

  function current() {
    return index >= 0 && index < holes.length ? holes[index] : null;
  }

  function cacheHoleMaterials(object) {
    if (!object) return;
    object.traverse(function (child) {
      if (!child.isMesh || !child.material) return;
      var mats = Array.isArray(child.material) ? child.material : [child.material];
      var cloned = [];
      var i;
      for (i = 0; i < mats.length; i++) {
        var mat = mats[i] ? mats[i].clone() : mats[i];
        if (mat && mat.emissive) mat.userData.restEmissive = mat.emissive.clone();
        if (mat && mat.color) mat.userData.restColor = mat.color.clone();
        cloned.push(mat);
      }
      child.material = Array.isArray(child.material) ? cloned : cloned[0];
    });
  }

  function tintHole(object, armed) {
    if (!object) return;
    object.traverse(function (child) {
      if (!child.isMesh || !child.material) return;
      var mats = Array.isArray(child.material) ? child.material : [child.material];
      for (var i = 0; i < mats.length; i++) {
        var mat = mats[i];
        if (!mat) continue;
        if (mat.emissive && mat.userData.restEmissive) {
          mat.emissive.copy(mat.userData.restEmissive);
          if (armed) mat.emissive.setHex(ARMED);
        } else if (mat.color && mat.userData.restColor) {
          mat.color.copy(mat.userData.restColor);
          if (armed) mat.color.setHex(ARMED);
        }
      }
    });
  }

  function live() {
    return step && sequence.currentStep === step && !sequence.isComplete;
  }

  function reportProgress() {
    var amount = holes.length ? (index + Math.min(1, depth / HOLE_DEPTH)) / holes.length : 0;
    if (index >= holes.length) amount = 1;
    if (step) step.setProgress(amount);
    sequence.ping();
  }

  function placeGhost() {
    var hole = current();
    var show = live() && sequence.isWorking && hole && !hole.through && !seated && !step.isComplete;
    ghost.visible = !!show;
    if (!show || !hole) return;
    ghost.position.copy(hole.pos).addScaledVector(hole.into, HOLE_DEPTH * 0.5);
    ghost.quaternion.setFromUnitVectors(zAxis, hole.into);
  }

  function refreshHoles() {
    var i;
    for (i = 0; i < holes.length; i++) {
      var hole = holes[i];
      if (hole.object) {
        hole.object.visible = !hole.through;
        tintHole(hole.object, live() && i === index && !hole.through);
      }
    }
    placeGhost();
    queueRender();
  }

  function unseat() {
    seated = false;
    depth = 0;
  }

  function finishVisuals() {
    var i;
    for (i = 0; i < holes.length; i++) {
      holes[i].through = true;
      holes[i].maxDepth = HOLE_DEPTH;
    }
    index = holes.length;
    unseat();
    if (hold) hold.putBack();
    refreshHoles();
    if (step) step.setProgress(1);
  }

  function advance() {
    var hole = current();
    if (hole) hole.through = true;
    unseat();
    index += 1;
    if (index >= holes.length) {
      refreshHoles();
      if (hold) hold.putBack();
      if (step && !step.isComplete) step.completeStep();
      return;
    }
    refreshHoles();
    reportProgress();
  }

  function holeScreen(hole) {
    if (!syncView(view, scene)) return null;
    return projectWorld(view, viewer, hole.pos.x, hole.pos.y, hole.pos.z);
  }

  function whileHeld(api) {
    var hole = current();
    var event = api.event;
    if (!hole || !event || sequence.isBriefing || step.isComplete) return false;

    var screen = holeScreen(hole);
    if (!screen) return false;
    var dist = Math.hypot(event.clientX - screen.x, event.clientY - screen.y);

    if (!seated) {
      if (dist > SEAT_PX) return false;
      seated = true;
      depth = 0;
    }

    var alongMeters = 0;
    if (syncView(view, scene)) {
      var far = projectWorld(
        view,
        viewer,
        hole.pos.x + hole.into.x * 0.04,
        hole.pos.y + hole.into.y * 0.04,
        hole.pos.z + hole.into.z * 0.04
      );
      if (far) {
        var ax = far.x - screen.x;
        var ay = far.y - screen.y;
        var al2 = ax * ax + ay * ay;
        if (al2 > 1) {
          alongMeters = ((event.clientX - screen.x) * ax + (event.clientY - screen.y) * ay) / al2 * 0.04;
        }
      }
    }

    if (dist > LEAVE_PX && alongMeters < HOLE_DEPTH * 0.25) {
      if (hole.through) {
        advance();
        return true;
      }
      unseat();
      return false;
    }

    if (alongMeters < -WITHDRAW) {
      if (hole.through || hole.maxDepth >= HOLE_DEPTH - 1e-4) {
        advance();
        return true;
      }
      unseat();
      return false;
    }

    var wanted = alongMeters;
    if (wanted < 0) wanted = 0;
    if (wanted > HOLE_DEPTH * 1.4) wanted = HOLE_DEPTH * 1.4;
    var dt = api.dt || 1 / 60;
    var maxStep = MAX_PLUNGE * dt;
    var delta = wanted - depth;
    if (delta > maxStep) delta = maxStep;
    if (delta < -maxStep) delta = -maxStep;
    depth += delta;
    hole.maxDepth = Math.max(hole.maxDepth, depth);
    if (!hole.through && hole.maxDepth >= HOLE_DEPTH - 1e-4) {
      hole.through = true;
      if (hole.object) hole.object.visible = false;
    }

    api.alignTo(hole.into);
    tipAt.copy(hole.pos).addScaledVector(hole.into, Math.max(0, depth));
    api.moveTipTo(tipAt);
    placeGhost();
    reportProgress();
    queueRender();
    return true;
  }

  hold = bindToolHold(ctx, sequence, {
    toolId: "drill",
    stepId: "drill",
    localTipDir: [0, -1, 0],
    whileHeld: whileHeld,
    onRelease: function () {
      var hole = current();
      if (hole && (hole.through || hole.maxDepth >= HOLE_DEPTH - 1e-4)) {
        advance();
        return;
      }
      unseat();
      refreshHoles();
    }
  });

  if (step) {
    var originalReset = step.resetStep;
    var originalComplete = step.completeStep;
    step.resetStep = function () {
      originalReset.call(step);
      index = 0;
      unseat();
      var i;
      for (i = 0; i < holes.length; i++) {
        holes[i].through = false;
        holes[i].maxDepth = 0;
      }
      refreshHoles();
    };
    step.completeStep = function () {
      finishVisuals();
      originalComplete.call(step);
    };
    step.setEngagedCheck(function () {
      return !!(hold && hold.held);
    });
  }

  function onChange() {
    if (!live()) unseat();
    refreshHoles();
  }

  sequence.onChange(onChange);
  sequence.onProcedureComplete(function () {
    ghost.visible = false;
  });
  refreshHoles();

  return {
    holes: holes,
    hole1: holes[0] ? holes[0].pos : null,
    dispose: function () {
      if (hold) hold.dispose();
      if (group.parent) group.parent.remove(group);
    }
  };
}
