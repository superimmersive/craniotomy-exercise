import { bindToolHold } from "./toolhold.js";
import { createView, syncView, projectWorld } from "./input.js";

var COMPLETE_AT = 0.99;
var MAX_SPEED = 1.5;
var SEAT_PX = 72;
var HINT = 0.055;

export function bindBoneFlap(ctx, sequence) {
  var THREE = ctx.THREE;
  var scene = ctx.scene;
  var viewer = ctx.viewer;
  var step = sequence.getStep("boneFlap");
  var tools = ctx.tools;
  var elevator = tools && tools.byId && tools.byId.elevator;
  var view = createView(THREE);

  var elevStart = scene.getObjectByName("pos_bone_flap_elevator_StartPose");
  var elevEnd = scene.getObjectByName("pos_bone_flap_elevator_EndPose");
  var flapStart = scene.getObjectByName("pos_bone_flap_StartPose");
  var flapEnd = scene.getObjectByName("pos_bone_flap_EndPose");
  var cap = scene.getObjectByName("SkullCap");
  var capHome = cap ? cap.parent : null;

  var elevStartPos = new THREE.Vector3();
  var elevEndPos = new THREE.Vector3();
  var elevStartQ = new THREE.Quaternion();
  var elevEndQ = new THREE.Quaternion();
  var flapStartPos = new THREE.Vector3();
  var flapStartQ = new THREE.Quaternion();
  var flapEndQ = new THREE.Quaternion();
  var startHint = new THREE.Vector3();
  var endHint = new THREE.Vector3();
  var fwd = new THREE.Vector3();
  var worldPos = new THREE.Vector3();
  var worldQ = new THREE.Quaternion();
  var parentQ = new THREE.Quaternion();
  var invMat = new THREE.Matrix4();
  var poseScale = new THREE.Vector3();
  var ghost = null;
  var t = 0;
  var seated = false;
  var latched = false;
  var hold = null;

  function queueRender() {
    if (typeof ctx.queueRender === "function") ctx.queueRender();
  }

  function copyWorld(obj, pos, quat) {
    if (!obj) return;
    obj.updateMatrixWorld(true);
    obj.getWorldPosition(pos);
    obj.getWorldQuaternion(quat);
  }

  function capturePoses() {
    if (elevStart) copyWorld(elevStart, elevStartPos, elevStartQ);
    else {
      elevStartPos.set(0.047, 0.354, -0.0329);
      elevStartQ.set(0.617, 0.211, -0.578, 0.49);
    }
    if (elevEnd) copyWorld(elevEnd, elevEndPos, elevEndQ);
    else {
      elevEndPos.set(0.047, 0.354, -0.0329);
      elevEndQ.set(0.405, 0.401, -0.467, 0.676);
    }
    if (flapStart) copyWorld(flapStart, flapStartPos, flapStartQ);
    else {
      flapStartPos.set(0.0711, 0.3111, -0.0087);
      flapStartQ.set(0.269, 0.456, -0.415, 0.74);
    }
    if (flapEnd) flapEnd.getWorldQuaternion(flapEndQ);
    else flapEndQ.set(0.311, 0.432, -0.44, 0.723);
    fwd.set(0, 0, 1).applyQuaternion(elevStartQ);
    startHint.copy(elevStartPos).addScaledVector(fwd, HINT);
    fwd.set(0, 0, 1).applyQuaternion(elevEndQ);
    endHint.copy(elevEndPos).addScaledVector(fwd, HINT);
  }

  function setWorldPose(obj, pos, quat) {
    if (!obj) return;
    var parent = obj.parent;
    if (!parent) {
      obj.position.copy(pos);
      obj.quaternion.copy(quat);
      return;
    }
    parent.updateMatrixWorld(true);
    invMat.copy(parent.matrixWorld).invert();
    obj.position.copy(pos).applyMatrix4(invMat);
    parent.getWorldQuaternion(parentQ);
    obj.quaternion.copy(parentQ).invert().multiply(quat);
  }

  function mountGhost() {
    if (!ghost) return;
    ghost.position.set(0, 0, 0);
    ghost.quaternion.identity();
    ghost.scale.set(1, 1, 1);
    if (elevStart) {
      elevStart.updateMatrixWorld(true);
      elevStart.add(ghost);
      ghost.position.set(0, 0, 0);
      ghost.quaternion.identity();
      elevStart.getWorldScale(poseScale);
      ghost.scale.set(
        Math.abs(poseScale.x) > 1e-6 ? 1 / poseScale.x : 1,
        Math.abs(poseScale.y) > 1e-6 ? 1 / poseScale.y : 1,
        Math.abs(poseScale.z) > 1e-6 ? 1 / poseScale.z : 1
      );
      return;
    }
    scene.add(ghost);
    setWorldPose(ghost, elevStartPos, elevStartQ);
  }

  capturePoses();

  if (elevator && elevator.root) {
    ghost = elevator.root.clone(true);
    ghost.name = "bone-flap-seat-ghost";
    ghost.traverse(function (child) {
      if (child.userData && child.userData.pickProxy) {
        child.visible = false;
        child.raycast = function () {};
        return;
      }
      if (!child.isMesh) return;
      child.material = new THREE.MeshBasicMaterial({
        color: 0x26b7ff,
        transparent: true,
        opacity: 0.38,
        depthWrite: false
      });
    });
    mountGhost();
  }

  function live() {
    return step && sequence.currentStep === step && !sequence.isComplete && !latched;
  }

  function applyT(amount) {
    t = amount < 0 ? 0 : amount > 1 ? 1 : amount;
    worldQ.copy(elevStartQ).slerp(elevEndQ, t);
    worldPos.copy(elevStartPos).lerp(elevEndPos, t);
    if (seated && elevator) setWorldPose(elevator.root, worldPos, worldQ);
    worldQ.copy(flapStartQ).slerp(flapEndQ, t);
    if (cap && capHome && cap.parent === capHome) {
      setWorldPose(cap, flapStartPos, worldQ);
    }
    if (step) step.setProgress(t);
    sequence.ping();
    queueRender();
  }

  function showGhost() {
    if (!ghost) return;
    ghost.visible = live() && !seated && !latched && (sequence.isWorking || sequence.isBriefing);
  }

  function unseat() {
    seated = false;
    showGhost();
  }

  function latch() {
    latched = true;
    seated = false;
    applyT(1);
    if (hold) hold.putBack();
    showGhost();
    if (step && !step.isComplete) step.completeStep();
  }

  function reset() {
    latched = false;
    seated = false;
    applyT(0);
    showGhost();
  }

  function finish() {
    latched = true;
    seated = false;
    applyT(1);
    if (hold) hold.putBack();
    showGhost();
  }

  function whileHeld(api) {
    var event = api.event;
    if (!event || sequence.isBriefing || latched || !step || step.isComplete) return false;
    if (!syncView(view, scene)) return false;

    if (!seated) {
      var startScreen = projectWorld(
        view, viewer, elevStartPos.x, elevStartPos.y, elevStartPos.z
      );
      if (!startScreen) return false;
      if (Math.hypot(event.clientX - startScreen.x, event.clientY - startScreen.y) > SEAT_PX) {
        return false;
      }
      seated = true;
      showGhost();
    }

    var a = projectWorld(view, viewer, startHint.x, startHint.y, startHint.z);
    var b = projectWorld(view, viewer, endHint.x, endHint.y, endHint.z);
    var wanted = t;
    if (a && b) {
      var vx = b.x - a.x;
      var vy = b.y - a.y;
      var sl2 = vx * vx + vy * vy;
      if (sl2 > 4) {
        wanted = ((event.clientX - a.x) * vx + (event.clientY - a.y) * vy) / sl2;
      }
    }
    if (wanted < 0) wanted = 0;
    if (wanted > 1) wanted = 1;
    var dt = api.dt || 1 / 60;
    var maxStep = MAX_SPEED * dt;
    var delta = wanted - t;
    if (delta > maxStep) delta = maxStep;
    if (delta < -maxStep) delta = -maxStep;
    applyT(t + delta);

    worldQ.copy(elevStartQ).slerp(elevEndQ, t);
    worldPos.copy(elevStartPos).lerp(elevEndPos, t);
    api.setQuaternion(worldQ);
    api.moveTipTo(worldPos);
    if (t >= COMPLETE_AT) latch();
    return true;
  }

  hold = bindToolHold(ctx, sequence, {
    toolId: "elevator",
    stepId: "boneFlap",
    localTipDir: [0, 0, -1],
    whileHeld: whileHeld,
    hitExtra: function () {
      return ghost && ghost.visible ? [ghost] : [];
    },
    onRelease: function () {
      if (latched) return;
      unseat();
      applyT(t);
    }
  });

  if (step) {
    var originalReset = step.resetStep;
    var originalComplete = step.completeStep;
    step.resetStep = function () {
      originalReset.call(step);
      reset();
    };
    step.completeStep = function () {
      finish();
      originalComplete.call(step);
    };
    step.setEngagedCheck(function () {
      return !!(hold && hold.held);
    });
  }

  function onChange() {
    capturePoses();
    if (!live()) seated = false;
    if (ghost && elevStart && ghost.parent !== elevStart) mountGhost();
    showGhost();
    queueRender();
  }

  sequence.onChange(onChange);
  sequence.onProcedureComplete(function () {
    if (ghost) ghost.visible = false;
  });
  showGhost();

  return {
    dispose: function () {
      if (hold) hold.dispose();
      if (ghost && ghost.parent) ghost.parent.remove(ghost);
    }
  };
}
