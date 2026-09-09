import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

var ENTRIES = [
  {
    id: "incision",
    stepId: "incision",
    src: "assets/models/guide_skin_incision.glb",
    clips: ["ScalpleGhost", "scalple_ghost", "Action.007"]
  },
  {
    id: "skinFlap",
    stepId: "skinFlap",
    src: "assets/models/guide_skin_flap.glb",
    clips: ["Scene", "SkinflapGhost", "Action.003", "Action.004"]
  },
  {
    id: "drill",
    stepId: "drill",
    src: "assets/models/guide_dril_holes.glb",
    clips: ["Power Drill.001Action", "guide_drill_holes"]
  }
];

var HIDE_NAME = /incision_line|curve_/i;

function pickClip(clips, names) {
  var i;
  var j;
  for (i = 0; i < names.length; i++) {
    for (j = 0; j < clips.length; j++) {
      if (clips[j] && clips[j].name === names[i]) return clips[j];
    }
  }
  return clips[0] || null;
}

function ghostify(root, THREE) {
  var mat = new THREE.MeshBasicMaterial({
    color: 0x26b7ff,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false
  });
  root.traverse(function (child) {
    child.frustumCulled = false;
    child.raycast = function () {};
    if (!child.isMesh) return;
    child.castShadow = false;
    child.receiveShadow = false;
    child.material = mat;
    if (HIDE_NAME.test(child.name || "")) child.visible = false;
  });
}

function loadEntry(loader, item, THREE) {
  return new Promise(function (resolve) {
    loader.load(
      item.src + "?v=" + Date.now(),
      function (gltf) {
        var root = gltf.scene || gltf.scenes[0];
        if (!root) {
          resolve(null);
          return;
        }
        root.name = "briefing-guide-" + item.id;
        ghostify(root, THREE);
        var clip = pickClip(gltf.animations || [], item.clips);
        var mixer = clip ? new THREE.AnimationMixer(root) : null;
        var action = null;
        if (mixer && clip) {
          action = mixer.clipAction(clip);
          action.setLoop(THREE.LoopRepeat, Infinity);
          action.enabled = true;
          action.paused = true;
        }
        resolve({
          stepId: item.stepId,
          root: root,
          mixer: mixer,
          action: action
        });
      },
      undefined,
      function () {
        resolve(null);
      }
    );
  });
}

export function bindGuides(ctx, sequence) {
  var THREE = ctx.THREE;
  var scene = ctx.scene;
  var players = [];
  var shown = null;
  var last = 0;
  var ticking = 0;

  function queueRender() {
    if (typeof ctx.queueRender === "function") ctx.queueRender();
  }

  function mount(player) {
    scene.add(player.root);
    player.root.visible = false;
  }

  function setShown(player, on) {
    if (!player) return;
    player.root.visible = !!on;
    if (!player.action) return;
    if (on) {
      player.action.reset();
      player.action.paused = false;
      player.action.play();
    } else {
      player.action.stop();
      player.action.paused = true;
    }
  }

  function wanted() {
    if (!sequence.isBriefing || sequence.isComplete) return null;
    var step = sequence.currentStep;
    if (!step) return null;
    var i;
    for (i = 0; i < players.length; i++) {
      if (players[i].stepId === step.id) return players[i];
    }
    return null;
  }

  function refresh() {
    var next = wanted();
    if (next === shown && next && next.root.visible) return;
    if (shown) setShown(shown, false);
    shown = next;
    if (shown) setShown(shown, true);
    queueRender();
  }

  function tick(now) {
    ticking = requestAnimationFrame(tick);
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!shown || !shown.mixer || !shown.root.visible) return;
    shown.mixer.update(dt);
    queueRender();
  }

  var loader = new GLTFLoader();
  return Promise.all(ENTRIES.map(function (item) {
    return loadEntry(loader, item, THREE);
  })).then(function (loaded) {
    var i;
    for (i = 0; i < loaded.length; i++) {
      if (!loaded[i]) continue;
      mount(loaded[i]);
      players.push(loaded[i]);
    }
    sequence.onChange(refresh);
    sequence.onProcedureComplete(function () {
      if (shown) setShown(shown, false);
      shown = null;
    });
    last = performance.now();
    ticking = requestAnimationFrame(tick);
    refresh();
    return {
      dispose: function () {
        cancelAnimationFrame(ticking);
        var j;
        for (j = 0; j < players.length; j++) {
          setShown(players[j], false);
          if (players[j].root.parent) players[j].root.parent.remove(players[j].root);
        }
        players = [];
        shown = null;
      }
    };
  });
}
