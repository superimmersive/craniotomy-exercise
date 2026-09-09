function clamp01(t) {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function hypot3(ax, ay, az, bx, by, bz) {
  var dx = bx - ax;
  var dy = by - ay;
  var dz = bz - az;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function buildPath(json, options) {
  var raw = (json && json.points) || [];
  var mirrorX = !options || options.mirrorX !== false;
  var pts = [];
  var i;
  for (i = 0; i < raw.length; i++) {
    var p = raw[i];
    pts.push({
      x: mirrorX ? -p.x : p.x,
      y: p.y,
      z: p.z
    });
  }

  var dist = [0];
  for (i = 1; i < pts.length; i++) {
    dist.push(dist[i - 1] + hypot3(
      pts[i - 1].x, pts[i - 1].y, pts[i - 1].z,
      pts[i].x, pts[i].y, pts[i].z
    ));
  }
  var length = dist[dist.length - 1] || 0;

  function atDistance(d) {
    if (pts.length === 0) return { x: 0, y: 0, z: 0 };
    if (pts.length === 1 || length <= 0) return pts[0];
    if (d <= 0) return pts[0];
    if (d >= length) return pts[pts.length - 1];
    var lo = 0;
    var hi = dist.length - 1;
    while (lo + 1 < hi) {
      var mid = (lo + hi) >> 1;
      if (dist[mid] <= d) lo = mid;
      else hi = mid;
    }
    var span = dist[hi] - dist[lo];
    var u = span > 1e-8 ? (d - dist[lo]) / span : 0;
    return {
      x: pts[lo].x + (pts[hi].x - pts[lo].x) * u,
      y: pts[lo].y + (pts[hi].y - pts[lo].y) * u,
      z: pts[lo].z + (pts[hi].z - pts[lo].z) * u
    };
  }

  function position(t) {
    return atDistance(clamp01(t) * length);
  }

  function tangent(t) {
    var eps = length > 0 ? Math.min(0.002, length * 0.01) / length : 0.01;
    var a = position(t - eps);
    var b = position(t + eps);
    var x = b.x - a.x;
    var y = b.y - a.y;
    var z = b.z - a.z;
    var m = Math.sqrt(x * x + y * y + z * z);
    if (m < 1e-8) return { x: 0, y: 1, z: 0 };
    return { x: x / m, y: y / m, z: z / m };
  }

  function nearest(point, minT, maxT, spacing) {
    var from = clamp01(Math.min(minT, maxT));
    var to = clamp01(Math.max(minT, maxT));
    if (to - from < 1e-5) {
      var p0 = position(from);
      var dx0 = point.x - p0.x;
      var dy0 = point.y - p0.y;
      var dz0 = point.z - p0.z;
      return {
        t: from,
        point: p0,
        distance: Math.sqrt(dx0 * dx0 + dy0 * dy0 + dz0 * dz0)
      };
    }
    var space = spacing || 0.002;
    var span = (to - from) * length;
    var samples = Math.ceil(span / space) + 1;
    if (samples < 2) samples = 2;
    if (samples > 256) samples = 256;

    var bestT = from;
    var bestP = position(from);
    var bestD = Infinity;
    var prevT = from;
    var prev = bestP;
    var s;
    for (s = 1; s < samples; s++) {
      var t = from + (to - from) * (s / (samples - 1));
      var cur = position(t);
      var sx = cur.x - prev.x;
      var sy = cur.y - prev.y;
      var sz = cur.z - prev.z;
      var sl2 = sx * sx + sy * sy + sz * sz;
      var along = 0;
      if (sl2 > 1e-12) {
        along = ((point.x - prev.x) * sx + (point.y - prev.y) * sy + (point.z - prev.z) * sz) / sl2;
        if (along < 0) along = 0;
        else if (along > 1) along = 1;
      }
      var cx = prev.x + sx * along;
      var cy = prev.y + sy * along;
      var cz = prev.z + sz * along;
      var ddx = point.x - cx;
      var ddy = point.y - cy;
      var ddz = point.z - cz;
      var dist = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
      if (dist < bestD) {
        bestD = dist;
        bestP = { x: cx, y: cy, z: cz };
        bestT = prevT + (t - prevT) * along;
      }
      prevT = t;
      prev = cur;
    }
    return { t: bestT, point: bestP, distance: bestD };
  }

  return {
    points: pts,
    length: length,
    position: position,
    tangent: tangent,
    nearest: nearest
  };
}

export function recutClosedPath(json, worldTarget, options) {
  var path = buildPath(json, options);
  var pts = path.points.slice();
  var n = pts.length;
  var i;
  if (n < 2 || !worldTarget) return path;
  if (hypot3(pts[0].x, pts[0].y, pts[0].z, pts[n - 1].x, pts[n - 1].y, pts[n - 1].z) < 1e-4) {
    pts.pop();
    n = pts.length;
  }
  var best = 0;
  var bestD = Infinity;
  for (i = 0; i < n; i++) {
    var d = hypot3(
      pts[i].x, pts[i].y, pts[i].z,
      worldTarget.x, worldTarget.y, worldTarget.z
    );
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  var rotated = [];
  for (i = 0; i <= n; i++) {
    rotated.push(pts[(best + i) % n]);
  }
  return buildPath({ points: rotated, closed: false }, { mirrorX: false });
}

export function nearestOnScreen(path, cx, cy, minT, maxT, projectPoint) {
  var from = clamp01(Math.min(minT, maxT));
  var to = clamp01(Math.max(minT, maxT));
  var samples = 48;
  var bestT = from;
  var bestD = Infinity;
  var prev = null;
  var prevT = from;
  var i;
  for (i = 0; i < samples; i++) {
    var t = from + (to - from) * (i / Math.max(samples - 1, 1));
    var screen = projectPoint(path.position(t));
    if (!screen) {
      prev = null;
      continue;
    }
    if (prev) {
      var vx = screen.x - prev.x;
      var vy = screen.y - prev.y;
      var sl2 = vx * vx + vy * vy;
      var along = 0;
      if (sl2 > 1e-6) {
        along = ((cx - prev.x) * vx + (cy - prev.y) * vy) / sl2;
        if (along < 0) along = 0;
        else if (along > 1) along = 1;
      }
      var px = prev.x + vx * along;
      var py = prev.y + vy * along;
      var dx = cx - px;
      var dy = cy - py;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestD) {
        bestD = dist;
        bestT = prevT + (t - prevT) * along;
      }
    }
    prev = screen;
    prevT = t;
  }
  return { t: bestT, distance: bestD };
}

export function samplePath(path, fromT, toT, count) {
  var pts = [];
  var n = Math.max(2, count || 24);
  var i;
  for (i = 0; i <= n; i++) {
    var t = fromT + (toT - fromT) * (i / n);
    var p = path.position(t);
    pts.push(p);
  }
  return pts;
}
