export function ndcFromEvent(event, el) {
  var rect = el.getBoundingClientRect();
  var w = Math.max(rect.width, 1);
  var h = Math.max(rect.height, 1);
  return {
    x: ((event.clientX - rect.left) / w) * 2 - 1,
    y: -((event.clientY - rect.top) / h) * 2 + 1
  };
}

export function eventOver(event, el) {
  var rect = el.getBoundingClientRect();
  return event.clientX >= rect.left && event.clientX <= rect.right &&
    event.clientY >= rect.top && event.clientY <= rect.bottom;
}

export function createView(THREE) {
  return {
    proxyCam: new THREE.PerspectiveCamera(),
    raycaster: new THREE.Raycaster(),
    ndc: new THREE.Vector2(),
    viewDir: new THREE.Vector3(),
    scratch: new THREE.Vector3(),
    projected: new THREE.Vector3()
  };
}

export function syncView(view, scene) {
  var cam = scene && scene.camera;
  if (!cam || !cam.matrixWorld || !cam.projectionMatrix) return null;
  view.proxyCam.matrixWorld.copy(cam.matrixWorld);
  view.proxyCam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  view.proxyCam.projectionMatrix.copy(cam.projectionMatrix);
  view.proxyCam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  view.proxyCam.position.setFromMatrixPosition(cam.matrixWorld);
  view.viewDir.set(0, 0, -1).transformDirection(cam.matrixWorld).normalize();
  return view.proxyCam;
}

export function setRayFromEvent(view, viewer, event) {
  var cam = view.proxyCam;
  if (!cam) return false;
  var p = ndcFromEvent(event, viewer);
  view.ndc.set(p.x, p.y);
  view.raycaster.setFromCamera(view.ndc, cam);
  return true;
}

export function projectWorld(view, viewer, x, y, z) {
  var cam = view.proxyCam;
  if (!cam || !viewer) return null;
  view.scratch.set(x, y, z).project(cam);
  if (view.scratch.z < -1 || view.scratch.z > 1) return null;
  var rect = viewer.getBoundingClientRect();
  return {
    x: (view.scratch.x * 0.5 + 0.5) * rect.width + rect.left,
    y: (-view.scratch.y * 0.5 + 0.5) * rect.height + rect.top
  };
}

export function screenDistance(event, sx, sy) {
  var dx = event.clientX - sx;
  var dy = event.clientY - sy;
  return Math.sqrt(dx * dx + dy * dy);
}
