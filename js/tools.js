import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

var ITEMS = [
  { id: "scalpel", src: "assets/models/Scalpel.glb" },
  { id: "drill", src: "assets/models/cranial%20drill.glb" },
  { id: "craniotome", src: "assets/models/Craniotome.glb" },
  { id: "elevator", src: "assets/models/boneFlapElevator.glb" },
  { id: "bowl", src: "assets/models/spongeBowl.glb?v=" + Date.now() }
];

var FLOOR_Y = 0.002;

var SLOTS = {
  scalpel: { x: -0.20, z: 0.28, euler: [0, Math.PI / 2, 0] },
  drill: { x: -0.09, z: 0.28, euler: [Math.PI / 2, 0, 0] },
  craniotome: { x: 0.02, z: 0.28, euler: [Math.PI / 2, 0, 0] },
  elevator: { x: 0.12, z: 0.28, euler: [0, 0, 0] },
  bowl: { x: 0.26, z: 0.28, euler: [0, 0, 0] }
};

var PICK = {
  scalpel: [0.18, 0.04, 0.04],
  drill: [0.06, 0.22, 0.06],
  craniotome: [0.05, 0.2, 0.05],
  elevator: [0.04, 0.04, 0.18]
};

function brushedMetalMaterial(THREE) {
  var brush = makeBrushTexture(THREE, 512);
  var mat = new THREE.MeshPhysicalMaterial({
    name: "ToolBrushedMetal",
    color: 0xb7c0c8,
    metalness: 1,
    roughness: 0.34,
    roughnessMap: brush,
    envMapIntensity: 1.25,
    toneMapped: true,
    emissive: 0x000000,
    vertexColors: false,
    clearcoat: 0.12,
    clearcoatRoughness: 0.55,
    reflectivity: 0.9
  });
  if ("anisotropy" in mat) {
    mat.anisotropy = 0.85;
    mat.anisotropyMap = brush;
    mat.anisotropyRotation = 0;
  }
  return mat;
}

function applyBrushedMetal(root, template) {
  root.traverse(function (child) {
    if (!child.isMesh || child.userData.pickProxy) return;
    var cloned = template.clone();
    cloned.roughnessMap = template.roughnessMap;
    if (template.anisotropyMap) cloned.anisotropyMap = template.anisotropyMap;
    cloned.vertexColors = false;
    cloned.needsUpdate = true;
    child.material = cloned;
  });
}

function makeBrushTexture(THREE, size) {
  var canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  var ctx = canvas.getContext("2d");
  var img = ctx.createImageData(size, size);
  var data = img.data;
  var y;
  var x;
  var i;
  var grain;
  var v;
  for (y = 0; y < size; y++) {
    grain = Math.random() * 0.1;
    for (x = 0; x < size; x++) {
      i = (y * size + x) * 4;
      v = 0.52 + Math.sin(y * 1.15) * 0.05 + grain + (Math.random() - 0.5) * 0.16;
      v = Math.max(0, Math.min(1, v));
      v = Math.round(v * 255);
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  var tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 8);
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  if (THREE.LinearSRGBColorSpace) tex.colorSpace = THREE.LinearSRGBColorSpace;
  return tex;
}

function smoothBowlNormals(root) {
  root.traverse(function (child) {
    if (!child.isMesh || child.userData.pickProxy || !child.geometry) return;
    var geo = mergeVertices(child.geometry, 1e-4);
    geo.computeVertexNormals();
    if (geo.computeTangents && geo.getAttribute("uv")) {
      try { geo.computeTangents(); } catch (err) {}
    }
    child.geometry = geo;
    var mats = Array.isArray(child.material) ? child.material : [child.material];
    for (var i = 0; i < mats.length; i++) {
      if (!mats[i]) continue;
      mats[i].flatShading = false;
      mats[i].needsUpdate = true;
    }
  });
}

function prepare(root) {
  root.traverse(function (child) {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    child.frustumCulled = false;
    var materials = Array.isArray(child.material) ? child.material : [child.material];
    for (var i = 0; i < materials.length; i++) {
      var mat = materials[i];
      if (!mat) continue;
      mat.toneMapped = true;
      if (mat.envMapIntensity == null) mat.envMapIntensity = 1;
      mat.needsUpdate = true;
    }
  });
}

function ghostMaterial(THREE) {
  return new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    colorWrite: false
  });
}

function addPickVolume(root, THREE, size) {
  var pick = new THREE.Mesh(
    new THREE.BoxGeometry(size[0], size[1], size[2]),
    ghostMaterial(THREE)
  );
  pick.name = "pick-" + root.name;
  pick.userData.pickProxy = true;
  pick.visible = true;
  root.add(pick);
  return pick;
}

function addHomePad(kit, THREE, restPosition) {
  var home = new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 16, 12),
    ghostMaterial(THREE)
  );
  home.name = "home-scalpel";
  home.visible = true;
  home.position.copy(restPosition);
  kit.add(home);
  return home;
}

function snapMeshToRoot(root) {
  var mesh = null;
  var count = 0;
  root.traverse(function (child) {
    if (child.isMesh && !child.userData.pickProxy) {
      mesh = child;
      count += 1;
    }
  });
  if (count !== 1 || !mesh) return;
  mesh.position.set(0, 0, 0);
  mesh.rotation.set(0, 0, 0);
  mesh.scale.set(1, 1, 1);
  if (mesh !== root) {
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.scale.set(1, 1, 1);
  }
}

function seatOnFloor(root, THREE, slot) {
  var y = FLOOR_Y + 0.0006;
  root.position.set(0, 0, 0);
  root.rotation.set(slot.euler[0], slot.euler[1], slot.euler[2]);
  root.updateMatrixWorld(true);
  var box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) {
    root.position.set(slot.x, y, slot.z);
    return;
  }
  root.position.set(
    slot.x - (box.min.x + box.max.x) * 0.5,
    y - box.min.y,
    slot.z - (box.min.z + box.max.z) * 0.5
  );
  root.updateMatrixWorld(true);
}

function layoutKit(byId, THREE) {
  var id;
  for (id in SLOTS) {
    if (!Object.prototype.hasOwnProperty.call(SLOTS, id)) continue;
    if (!byId[id] || !byId[id].root) continue;
    snapMeshToRoot(byId[id].root);
    seatOnFloor(byId[id].root, THREE, SLOTS[id]);
    byId[id].restPosition.copy(byId[id].root.position);
    byId[id].restQuaternion.copy(byId[id].root.quaternion);
  }
}

export function loadTools(scene, THREE) {
  var existing = scene.getObjectByName("craniotomy-tools");
  if (existing && existing.parent) existing.parent.remove(existing);

  var kit = new THREE.Group();
  kit.name = "craniotomy-tools";
  scene.add(kit);

  var loader = new GLTFLoader();
  var metal = brushedMetalMaterial(THREE);
  return Promise.all(ITEMS.map(function (item) {
    return new Promise(function (resolve) {
      loader.load(
        item.src,
        function (gltf) {
          var root = gltf.scene || gltf.scenes[0];
          root.name = "tool-" + item.id;
          prepare(root);
          applyBrushedMetal(root, metal);
          if (item.id === "bowl") smoothBowlNormals(root);
          kit.add(root);
          root.updateMatrixWorld(true);
          resolve({
            id: item.id,
            root: root,
            restPosition: root.position.clone(),
            restQuaternion: root.quaternion.clone()
          });
        },
        undefined,
        function () {
          resolve(null);
        }
      );
    });
  })).then(function (entries) {
    var byId = {};
    for (var i = 0; i < entries.length; i++) {
      if (!entries[i]) continue;
      byId[entries[i].id] = entries[i];
    }
    layoutKit(byId, THREE);
    if (byId.scalpel) {
      byId.scalpel.pick = addPickVolume(byId.scalpel.root, THREE, PICK.scalpel);
      byId.scalpel.home = addHomePad(kit, THREE, byId.scalpel.restPosition);
    }
    if (byId.drill) {
      byId.drill.pick = addPickVolume(byId.drill.root, THREE, PICK.drill);
    }
    if (byId.craniotome) {
      byId.craniotome.pick = addPickVolume(byId.craniotome.root, THREE, PICK.craniotome);
    }
    if (byId.elevator) {
      byId.elevator.pick = addPickVolume(byId.elevator.root, THREE, PICK.elevator);
    }
    return { kit: kit, byId: byId };
  });
}
