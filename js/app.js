import { createSequence } from "./procedure.js";
import { bindBriefing } from "./briefing.js";
import { loadCurves } from "./curves.js";
import { viewerReady } from "./viewer.js";
import { bindScalpelPickup } from "./pickup.js";
import { bindIncision } from "./incision.js";
import { bindSkinFlap } from "./skinflap.js";
import { bindGuides } from "./guides.js";
import { bindVoiceover } from "./voiceover.js";
import { bindDrill } from "./drill.js";
import { bindCraniotome } from "./craniotome.js";
import { bindBoneFlap } from "./boneflap.js";
import { bindSkullCap } from "./skullcap.js";

var sequence = createSequence();
var card = document.getElementById("briefing");

var voiceover = bindVoiceover(sequence);
if (card) bindBriefing(card, sequence, voiceover);
sequence.start();

Promise.all([viewerReady, loadCurves()]).then(function (parts) {
  var ctx = parts[0];
  var curves = parts[1];
  window.__craniotomyCurves = curves;
  if (!ctx) return;
  var pickup = ctx.tools ? bindScalpelPickup(ctx, sequence) : null;
  if (curves && curves.incision) bindIncision(ctx, sequence, pickup, curves.incision);
  if (curves && curves.skinFlap) bindSkinFlap(ctx, sequence, curves.skinFlap);
  bindGuides(ctx, sequence);
  var drill = bindDrill(ctx, sequence);
  if (curves && curves.skullCap) {
    bindCraniotome(ctx, sequence, curves.skullCap, drill && drill.hole1);
  }
  bindBoneFlap(ctx, sequence);
  bindSkullCap(ctx, sequence);
}).catch(function () {});
