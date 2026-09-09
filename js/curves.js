const CURVE_FILES = {
  incision: "assets/curves/incision-curve.json",
  skinFlap: "assets/curves/hand-guide-skin-flap.json",
  skullCap: "assets/curves/skullcap-spline.json"
};

export async function loadCurves() {
  var entries = Object.keys(CURVE_FILES);
  var loaded = await Promise.all(
    entries.map(function (key) {
      return fetch(CURVE_FILES[key]).then(function (res) {
        if (!res.ok) throw new Error("Missing " + CURVE_FILES[key]);
        return res.json();
      });
    })
  );
  var curves = {};
  entries.forEach(function (key, i) {
    curves[key] = loaded[i];
  });
  return curves;
}
