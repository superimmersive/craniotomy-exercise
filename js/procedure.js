export const SKIP_DELAY_MS = 0;
export const SKIP_FADE_MS = 0;

const INTRO_INSTRUCTION =
  "Welcome to craniotomy training. You will position and lock the head, then cut, peel, drill, open the bone, and lay the skull cap in the bowl.\n\nRead each card, press Continue, then do that step. Tools stay inactive until you continue.";

function createStep(config) {
  var progress = 0;
  var complete = false;
  var armed = false;
  var pickupOffered = false;
  var listeners = [];

  var step = {
    id: config.id,
    instruction: config.instruction,
    intro: !!config.intro,
    get progress() {
      return complete ? 1 : progress;
    },
    get isComplete() {
      return complete;
    },
    get isArmed() {
      return armed;
    },
    get isEngaged() {
      return config.isEngaged ? !!config.isEngaged() : false;
    },
    get pickupOffered() {
      return pickupOffered;
    },
    whenComplete: function (fn) {
      listeners.push(fn);
    },
    setArmed: function (value) {
      armed = value;
      if (config.onArmed) config.onArmed(value);
      if (value && config.intro) step.completeStep();
    },
    setPickupOffered: function (value) {
      pickupOffered = value;
      if (config.onPickupOffered) config.onPickupOffered(value);
    },
    setEngagedCheck: function (fn) {
      config.isEngaged = fn;
    },
    resetStep: function () {
      progress = 0;
      complete = false;
      armed = false;
      if (config.onReset) config.onReset();
    },
    setProgress: function (value) {
      if (complete) return;
      progress = value < 0 ? 0 : value > 1 ? 1 : value;
      if (config.onProgress) config.onProgress(progress);
    },
    completeStep: function () {
      if (complete) return;
      progress = 1;
      complete = true;
      armed = false;
      if (config.onCompleteVisual) config.onCompleteVisual();
      for (var i = 0; i < listeners.length; i++) listeners[i]();
    }
  };

  return step;
}

function createStubSteps() {
  return [
    createStep({
      id: "intro",
      intro: true,
      instruction: INTRO_INSTRUCTION
    }),
    createStep({
      id: "headLock",
      instruction: "Turn the head so the surgical site faces you, then press Lock on the skull clamp."
    }),
    createStep({
      id: "incision",
      instruction: "Take the scalpel and draw the incision along the marked curve."
    }),
    createStep({
      id: "skinFlap",
      instruction: "Grab the bead at the edge of the incision and peel the skin flap along the arc."
    }),
    createStep({
      id: "drill",
      instruction: "Take the cranial drill and bore the four burr holes in order."
    }),
    createStep({
      id: "craniotome",
      instruction: "Take the craniotome and cut round the skull from the first burr hole back to it."
    }),
    createStep({
      id: "boneFlap",
      instruction: "Seat the bone flap elevator at the edge of the cut and lever the skull cap loose."
    }),
    createStep({
      id: "skullCap",
      instruction: "Lift the skull cap off the head and lay it in the sponge bowl."
    })
  ];
}

export function createSequence(steps) {
  var resolved = steps || createStubSteps();
  var index = 0;
  var complete = false;
  var briefing = true;
  var autoContinue = false;
  var listeners = [];
  var completeListeners = [];
  var autoTimer = 0;

  function current() {
    return resolved[index] || null;
  }

  function hasIntro() {
    return resolved.length > 0 && resolved[0].intro;
  }

  function notify() {
    for (var i = 0; i < listeners.length; i++) listeners[i](index);
  }

  function refreshPickupOffers() {
    var offer = autoContinue && !complete && briefing && current() && !current().intro;
    for (var i = 0; i < resolved.length; i++) {
      resolved[i].setPickupOffered(offer && i === index);
    }
  }

  function enterBriefing() {
    briefing = true;
    if (current()) current().setArmed(false);
    refreshPickupOffers();
    notify();
  }

  function advance() {
    if (index >= 0 && index < resolved.length) {
      resolved[index].setArmed(false);
    }
    index += 1;
    if (index >= resolved.length) {
      index = resolved.length;
      complete = true;
      briefing = false;
      refreshPickupOffers();
      notify();
      for (var i = 0; i < completeListeners.length; i++) completeListeners[i]();
      return;
    }
    enterBriefing();
  }

  function handleComplete(stepIndex) {
    if (complete || stepIndex !== index) return;
    advance();
  }

  for (var s = 0; s < resolved.length; s++) {
    (function (stepIndex) {
      resolved[stepIndex].whenComplete(function () {
        handleComplete(stepIndex);
      });
    })(s);
  }

  function tickAutoContinue() {
    if (!autoContinue || complete || !briefing) return;
    var step = current();
    if (!step || step.intro) return;
    if (step.isEngaged) sequence.continueCurrentStep();
  }

  var sequence = {
    get stepIndex() {
      return index;
    },
    get stepCount() {
      return resolved.length;
    },
    get isComplete() {
      return complete;
    },
    get isBriefing() {
      return briefing && !complete;
    },
    get isWorking() {
      return !complete && !briefing && current() != null;
    },
    get isIntro() {
      return !!(current() && current().intro);
    },
    getStep: function (id) {
      for (var i = 0; i < resolved.length; i++) {
        if (resolved[i].id === id) return resolved[i];
      }
      return null;
    },
    ping: function () {
      notify();
    },
    get currentStep() {
      return current();
    },
    get currentInstruction() {
      return current() ? current().instruction : "";
    },
    get displayStepNumber() {
      return hasIntro() ? index : index + 1;
    },
    get displayStepCount() {
      return hasIntro() ? Math.max(0, resolved.length - 1) : resolved.length;
    },
    get autoContinue() {
      return autoContinue;
    },
    set autoContinue(value) {
      autoContinue = !!value;
      refreshPickupOffers();
    },
    get progress() {
      var step = current();
      return step ? step.progress : complete ? 1 : 0;
    },
    onChange: function (fn) {
      listeners.push(fn);
    },
    onProcedureComplete: function (fn) {
      completeListeners.push(fn);
    },
    continueCurrentStep: function () {
      var step = current();
      if (complete || !briefing || !step) return;
      briefing = false;
      step.setArmed(true);
      refreshPickupOffers();
      notify();
      if (step.id === "headLock" && !step.isComplete) step.completeStep();
    },
    skipCurrentStep: function () {
      var step = current();
      var from = index;
      if (complete || !step) return;
      if (briefing) {
        briefing = false;
        step.setArmed(true);
        refreshPickupOffers();
        notify();
      }
      if (index === from && step && !step.isComplete) {
        step.completeStep();
      }
      if (index === from) advance();
    },
    resetProcedure: function () {
      complete = false;
      for (var i = 0; i < resolved.length; i++) {
        resolved[i].resetStep();
        resolved[i].setArmed(false);
      }
      index = 0;
      briefing = true;
      refreshPickupOffers();
      notify();
    },
    start: function () {
      refreshPickupOffers();
      notify();
      if (typeof requestAnimationFrame !== "function") return;
      if (autoTimer) cancelAnimationFrame(autoTimer);
      function loop() {
        tickAutoContinue();
        autoTimer = requestAnimationFrame(loop);
      }
      autoTimer = requestAnimationFrame(loop);
    }
  };

  return sequence;
}
