var LINES = {
  intro: "assets/audio/vo/intro.wav",
  headLock: "assets/audio/vo/head_lock.wav",
  incision: "assets/audio/vo/incision.wav",
  skinFlap: "assets/audio/vo/skin_flap.wav",
  drill: "assets/audio/vo/drill.wav",
  craniotome: "assets/audio/vo/craniotome.wav",
  boneFlap: "assets/audio/vo/bone_flap.wav",
  skullCap: "assets/audio/vo/skull_cap.wav"
};

var COMPLETE = "assets/audio/vo/complete.wav";
var MUTE_KEY = "craniotomy-vo-muted";

export function bindVoiceover(sequence) {
  var audio = new Audio();
  audio.preload = "auto";
  var playingKey = null;
  var blocked = false;
  var muted = false;
  try { muted = window.localStorage.getItem(MUTE_KEY) === "1"; } catch (err) {}
  audio.muted = muted;

  function wantedKey() {
    if (sequence.isComplete) return "complete";
    if (!sequence.isBriefing) return null;
    var step = sequence.currentStep;
    return step ? step.id : null;
  }

  function wantedSrc(key) {
    if (key === "complete") return COMPLETE;
    return key && LINES[key] ? LINES[key] : null;
  }

  function stop() {
    playingKey = null;
    audio.pause();
    try { audio.currentTime = 0; } catch (err) {}
  }

  function play(key) {
    var src = wantedSrc(key);
    if (!src) {
      stop();
      return;
    }
    if (playingKey === key && !audio.paused) return;
    playingKey = key;
    if (audio.getAttribute("src") !== src) audio.src = src;
    if (muted) {
      audio.pause();
      return;
    }
    var start = audio.play();
    if (start && typeof start.catch === "function") {
      start.catch(function () {
        blocked = true;
      });
    }
  }

  function setMuted(value) {
    muted = !!value;
    audio.muted = muted;
    try { window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch (err) {}
    if (muted) {
      audio.pause();
    } else {
      var key = wantedKey();
      if (key) {
        playingKey = null;
        play(key);
      }
    }
  }

  function refresh() {
    var key = wantedKey();
    if (!key) {
      stop();
      return;
    }
    if (playingKey === key) return;
    stop();
    play(key);
  }

  function unlock() {
    if (!blocked) return;
    blocked = false;
    var key = wantedKey();
    if (key) play(key);
  }

  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
  sequence.onChange(refresh);
  sequence.onProcedureComplete(refresh);
  refresh();

  return {
    get muted() {
      return muted;
    },
    setMuted: setMuted,
    dispose: function () {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
      stop();
    }
  };
}
