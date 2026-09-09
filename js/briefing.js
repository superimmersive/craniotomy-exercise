export function bindBriefing(root, sequence, voiceover) {
  var titleEl = root.querySelector("[data-briefing-title]");
  var bodyEl = root.querySelector("[data-briefing-body]");
  var continueBtn = root.querySelector("[data-briefing-continue]");
  var skipBtn = root.querySelector("[data-briefing-skip]");
  var restartBtn = root.querySelector("[data-briefing-restart]");
  var autoEl = root.querySelector("[data-briefing-auto]");
  var autoRow = root.querySelector("[data-briefing-auto-row]");
  var meterEl = root.querySelector("[data-briefing-meter]");
  var muteBtn = root.querySelector("[data-briefing-mute]");
  var syncingAuto = false;

  function setHidden(el, hidden) {
    if (!el) return;
    el.hidden = hidden;
  }

  function showSkip(visible) {
    if (!skipBtn) return;
    skipBtn.hidden = !visible;
    skipBtn.style.opacity = visible ? "1" : "0";
    skipBtn.disabled = !visible;
  }

  function heading(label) {
    var prefix = sequence.isWorking ? "In progress" : "Instruction";
    return prefix + " — " + label;
  }

  function syncMute() {
    if (!muteBtn) return;
    var muted = !!(voiceover && voiceover.muted);
    muteBtn.classList.toggle("is-muted", muted);
    muteBtn.setAttribute("aria-pressed", muted ? "true" : "false");
    muteBtn.setAttribute("aria-label", muted ? "Unmute voiceover" : "Mute voiceover");
    muteBtn.title = muted ? "Unmute" : "Mute";
  }

  function refresh() {
    if (autoEl) {
      syncingAuto = true;
      autoEl.checked = sequence.autoContinue;
      syncingAuto = false;
    }

    if (sequence.isComplete) {
      if (titleEl) titleEl.textContent = "Procedure complete";
      if (bodyEl) {
        bodyEl.textContent =
          "The procedure is complete. Press Restart to begin a new session from the start.";
      }
      setHidden(continueBtn, true);
      setHidden(restartBtn, false);
      setHidden(autoRow, true);
      if (meterEl) meterEl.style.width = "100%";
      showSkip(false);
      return;
    }

    setHidden(restartBtn, true);
    showSkip(!!sequence.isWorking);

    if (sequence.isIntro) {
      if (titleEl) titleEl.textContent = heading("Introduction");
      if (bodyEl) bodyEl.textContent = sequence.currentInstruction;
      setHidden(continueBtn, !sequence.isBriefing);
      setHidden(autoRow, false);
      if (meterEl) meterEl.style.width = "0%";
      return;
    }

    var label = "Step " + sequence.displayStepNumber + " of " + sequence.displayStepCount;
    if (titleEl) titleEl.textContent = heading(label);
    if (bodyEl) bodyEl.textContent = sequence.currentInstruction;
    setHidden(continueBtn, !sequence.isBriefing);
    setHidden(autoRow, true);
    if (meterEl) meterEl.style.width = Math.round(sequence.progress * 100) + "%";
  }

  if (continueBtn) {
    continueBtn.addEventListener("click", function () {
      sequence.continueCurrentStep();
    });
  }

  if (skipBtn) {
    skipBtn.addEventListener("click", function () {
      sequence.skipCurrentStep();
    });
  }

  if (restartBtn) {
    restartBtn.addEventListener("click", function () {
      sequence.resetProcedure();
    });
  }

  if (autoEl) {
    autoEl.addEventListener("change", function () {
      if (syncingAuto) return;
      sequence.autoContinue = autoEl.checked;
    });
  }

  if (muteBtn) {
    muteBtn.addEventListener("click", function () {
      if (!voiceover) return;
      voiceover.setMuted(!voiceover.muted);
      syncMute();
    });
  }

  sequence.onChange(refresh);
  sequence.onProcedureComplete(refresh);
  syncMute();
  refresh();

  return {
    refresh: refresh,
    dispose: function () {}
  };
}
