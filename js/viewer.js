import * as THREE from "three";
import { loadTools } from "./tools.js";

var readyResolve;
export const viewerReady = new Promise(function (resolve) {
  readyResolve = resolve;
});

(function () {
  var viewer = document.getElementById("anatomy-viewer");
  if (!viewer) {
    if (readyResolve) readyResolve(null);
    return;
  }

  var zooming = false;
  var panning = false;
  var lastY = 0;
  var lastPanX = 0;
  var lastPanY = 0;
  var baseRadius = 0;
  var homeOrbit = "";
  var homeTarget = "";
  var panX = 0;
  var panY = 0;
  var panZ = 0;
  var aimX = 0;
  var aimY = 0;
  var aimZ = 0;
  var helpersStarted = false;
  var pointerGuards = [];

  function runPointerGuards(event) {
    for (var i = 0; i < pointerGuards.length; i++) {
      if (pointerGuards[i](event)) return true;
    }
    return false;
  }
  var loadEl = document.getElementById("load");
  var loadLabel = document.getElementById("load-label");
  var resetBtn = document.getElementById("reset-view");

  function hideLoad() {
    if (loadEl) loadEl.hidden = true;
  }

  var cameraTargetStr = "0m 0m 0m";

  function anatomyBox(scene) {
    var box = new THREE.Box3();
    var tmp = new THREE.Box3();
    var has = false;
    scene.traverse(function (child) {
      if (!child.isMesh) return;
      var name = child.name || "";
      if (name === "floor-grid") return;
      var node = child;
      while (node) {
        if (node.name === "craniotomy-tools") return;
        node = node.parent;
      }
      tmp.setFromObject(child);
      if (tmp.isEmpty()) return;
      if (!has) {
        box.copy(tmp);
        has = true;
      } else {
        box.union(tmp);
      }
    });
    return has ? box : null;
  }

  function aimAtAnatomyHeight(scene) {
    var box = anatomyBox(scene);
    var midY = 0;
    if (box && Number.isFinite(box.min.y) && Number.isFinite(box.max.y)) {
      midY = (box.min.y + box.max.y) * 0.5;
    }
    aimX = 0;
    aimY = midY;
    aimZ = 0;
    cameraTargetStr = "0m 0m 0m";
    viewer.cameraTarget = cameraTargetStr;
    if (scene && typeof scene.setTarget === "function") scene.setTarget(0, 0, 0);
    if (scene && scene.target && scene.target.position) scene.target.position.set(0, 0, 0);
    applyCameraPan();
    if (typeof scene.queueRender === "function") scene.queueRender();
  }

  function pinArmatureToWorldOrigin() {
    viewer.cameraTarget = "0m 0m 0m";
    if (viewer.jumpCameraToGoal) viewer.jumpCameraToGoal();
  }

  function rememberHome() {
    var orbit = viewer.getCameraOrbit();
    baseRadius = orbit.radius;
    homeOrbit = viewer.cameraOrbit;
    homeTarget = "0m 0m 0m";
  }

  viewer.addEventListener("progress", function (event) {
    var amount = event.detail && event.detail.totalProgress;
    if (!loadLabel || amount == null) return;
    var pct = Math.round(amount * 100);
    loadLabel.textContent = pct >= 100 ? "Loading model" : "Loading model " + pct + "%";
  });

  function startHelpers() {
    if (helpersStarted) return;
    helpersStarted = true;
    pinArmatureToWorldOrigin();
    hideLoad();
    addSceneHelpers(viewer);
  }

  viewer.addEventListener("load", startHelpers);

  viewer.addEventListener("error", function () {
    if (loadLabel) loadLabel.textContent = "Could not load model";
  });

  if (viewer.loaded) startHelpers();

  viewer.addEventListener("pointerdown", function (event) {
    if (event.button === 0 && !event.shiftKey && runPointerGuards(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (event.button === 1) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (event.button === 0 && event.shiftKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      panning = true;
      lastPanX = event.clientX;
      lastPanY = event.clientY;
      viewer.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 2) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    zooming = true;
    lastY = event.clientY;
    if (!baseRadius) baseRadius = viewer.getCameraOrbit().radius;
    viewer.setPointerCapture(event.pointerId);
  }, true);

  window.addEventListener("pointerdown", function (event) {
    if (event.button !== 0 || event.shiftKey) return;
    if (!pointerGuards.length) return;
    var path = event.composedPath ? event.composedPath() : [];
    var onViewer = event.target === viewer || path.indexOf(viewer) >= 0;
    if (!onViewer) return;
    var t = event.target;
    if (t && t.closest && t.closest(".briefing, .chrome, header, footer")) return;
    if (runPointerGuards(event)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
  }, true);

  function applyCameraPan() {
    var scene = getScene(viewer);
    if (!scene || !scene.camera) return;
    var orbit = viewer.getCameraOrbit();
    var radius = orbit.radius;
    var phi = orbit.phi;
    var theta = orbit.theta;
    var sinPhi = Math.sin(phi);
    scene.camera.position.set(
      radius * sinPhi * Math.sin(theta) + panX + aimX,
      radius * Math.cos(phi) + panY + aimY,
      radius * sinPhi * Math.cos(theta) + panZ + aimZ
    );
    if (scene.camera.lookAt) scene.camera.lookAt(aimX + panX, aimY + panY, aimZ + panZ);
    if (scene.camera.updateMatrixWorld) scene.camera.updateMatrixWorld();
  }

  function panBy(dx, dy) {
    var orbit = viewer.getCameraOrbit();
    var fovDeg = viewer.getFieldOfView ? viewer.getFieldOfView() : 30;
    var meters = (2 * orbit.radius * Math.tan((fovDeg * Math.PI) / 360)) /
      Math.max(viewer.clientHeight, 1);
    var scene = getScene(viewer);
    var yaw = scene && typeof scene.yaw === "number" ? scene.yaw : 0;
    var psi = orbit.theta - yaw;
    var cosPsi = Math.cos(psi);
    var sinPsi = Math.sin(psi);
    var cosPhi = Math.cos(orbit.phi);
    var sinPhi = Math.sin(orbit.phi);
    var mx = (-cosPsi * dx - cosPhi * sinPsi * dy) * meters;
    var my = (sinPhi * dy) * meters;
    var mz = (sinPsi * dx - cosPhi * cosPsi * dy) * meters;
    panX += mx;
    panY += my;
    panZ += mz;
    viewer.cameraTarget = cameraTargetStr;
    applyCameraPan();
    if (scene && typeof scene.queueRender === "function") scene.queueRender();
  }

  viewer.addEventListener("pointermove", function (event) {
    if (panning) {
      event.preventDefault();
      event.stopImmediatePropagation();
      panBy(event.clientX - lastPanX, event.clientY - lastPanY);
      lastPanX = event.clientX;
      lastPanY = event.clientY;
      return;
    }
    if (!zooming) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    var orbit = viewer.getCameraOrbit();
    var next = orbit.radius * Math.exp((event.clientY - lastY) * 0.008);
    lastY = event.clientY;
    var minR = baseRadius * 0.35;
    var maxR = baseRadius * 3.5;
    if (next < minR) next = minR;
    if (next > maxR) next = maxR;
    viewer.cameraOrbit = orbit.theta + "rad " + orbit.phi + "rad " + next + "m";
    if (viewer.jumpCameraToGoal) viewer.jumpCameraToGoal();
    applyCameraPan();
  }, true);

  function endDrag(event) {
    if (!zooming && !panning) return;
    zooming = false;
    panning = false;
    if (event && event.pointerId != null) {
      try { viewer.releasePointerCapture(event.pointerId); } catch (err) {}
    }
  }

  viewer.addEventListener("pointerup", endDrag, true);
  viewer.addEventListener("pointercancel", endDrag, true);
  viewer.addEventListener("contextmenu", function (event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  viewer.addEventListener("camera-change", function () {
    applyCameraPan();
    requestAnimationFrame(applyCameraPan);
  });

  function getScene(mv) {
    var symbols = Object.getOwnPropertySymbols(mv);
    for (var i = 0; i < symbols.length; i++) {
      var value = mv[symbols[i]];
      if (value && value.isScene) return value;
    }
    return null;
  }

  function makeGridCanvas(pixels, cells) {
    var canvas = document.createElement("canvas");
    canvas.width = pixels;
    canvas.height = pixels;
    var ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, pixels, pixels);

    var step = pixels / cells;
    var i;
    var p;
    ctx.strokeStyle = "rgba(148, 163, 184, 0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (i = 0; i <= cells; i++) {
      p = i * step + 0.5;
      ctx.moveTo(p, 0);
      ctx.lineTo(p, pixels);
      ctx.moveTo(0, p);
      ctx.lineTo(pixels, p);
    }
    ctx.stroke();

    ctx.strokeStyle = "rgba(203, 213, 225, 0.7)";
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(pixels / 2 + 0.5, 0);
    ctx.lineTo(pixels / 2 + 0.5, pixels);
    ctx.moveTo(0, pixels / 2 + 0.5);
    ctx.lineTo(pixels, pixels / 2 + 0.5);
    ctx.stroke();

    ctx.globalCompositeOperation = "destination-in";
    var fade = ctx.createRadialGradient(
      pixels / 2,
      pixels / 2,
      pixels * 0.1,
      pixels / 2,
      pixels / 2,
      pixels * 0.48
    );
    fade.addColorStop(0, "rgba(255, 255, 255, 0.5)");
    fade.addColorStop(0.55, "rgba(255, 255, 255, 0.18)");
    fade.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, pixels, pixels);
    return canvas;
  }

  function addFloorGrid(scene, THREE, mv) {
    var existing = scene.getObjectByName("floor-grid");
    if (existing && existing.parent) existing.parent.remove(existing);

    var dim = mv.getDimensions ? mv.getDimensions() : { x: 2, y: 2, z: 2 };
    var size = Math.max(dim.x, dim.z, 0.5) * 3;
    var texture = new THREE.CanvasTexture(makeGridCanvas(1024, 24));
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;

    var floor = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false
      })
    );
    floor.name = "floor-grid";
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.002;
    floor.renderOrder = -1;
    floor.raycast = function () {};
    scene.add(floor);
  }

  function frameTools(mv) {
    var orbit = mv.getCameraOrbit();
    var radius = Math.max(orbit.radius, 1.15);
    mv.cameraOrbit = orbit.theta + "rad " + orbit.phi + "rad " + radius + "m";
    if (mv.jumpCameraToGoal) mv.jumpCameraToGoal();
  }

  function addSceneHelpers(mv) {
    var scene = getScene(mv);
    if (!scene) {
      finishReady(null);
      return;
    }

    addFloorGrid(scene, THREE, mv);
    aimAtAnatomyHeight(scene);

    loadTools(scene, THREE)
      .then(function (tools) {
        aimAtAnatomyHeight(scene);
        frameTools(mv);
        rememberHome();
        if (typeof scene.queueRender === "function") scene.queueRender();
        finishReady(tools);
      })
      .catch(function () {
        rememberHome();
        finishReady(null);
      });
  }

  function finishReady(tools) {
    if (!readyResolve) return;
    var scene = getScene(viewer);
    readyResolve({
      viewer: viewer,
      scene: scene,
      THREE: THREE,
      tools: tools,
      queueRender: function () {
        var s = getScene(viewer);
        if (s && typeof s.queueRender === "function") s.queueRender();
      },
      setPointerGuard: function (fn) {
        if (typeof fn === "function") pointerGuards.push(fn);
      }
    });
    readyResolve = null;
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", function () {
      panX = 0;
      panY = 0;
      panZ = 0;
      if (homeOrbit) viewer.cameraOrbit = homeOrbit;
      viewer.cameraTarget = homeTarget || cameraTargetStr;
      if (viewer.jumpCameraToGoal) viewer.jumpCameraToGoal();
      applyCameraPan();
    });
  }
})();
