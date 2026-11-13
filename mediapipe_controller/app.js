import {
  createRecognizer,
  readHands,
  drawHands,
  clearOverlay,
  assignHands,
  fingerFlags,
  isPinching,
  isThumbUp,
} from "./vision.js";
import { mountMidi } from "./midi.js";
import { mountChannels, updateChannels, reset as resetChannels } from "./channels.js";
import { mountBanks, updateBanks, reset as resetBanks } from "./banks.js";
import { mountPinch, updatePinch, reset as resetPinch } from "./pinch.js";
import { updateGestures, reset as resetGestures } from "./gestures.js";

const video = document.getElementById("webcam");
const toggleBtn = document.getElementById("toggleCamera");
const statusEl = document.getElementById("status");
const readoutEl = document.getElementById("readout");
const channelPanel = document.getElementById("channelPanel");
const bankPanel = document.getElementById("bankPanel");
const pinchPanel = document.getElementById("pinchPanel");
const channelSettings = document.getElementById("channelSettings");
const pinchSettings = document.getElementById("pinchSettings");
const modeSelect = document.getElementById("modeSelect");
const settingsDrawer = document.getElementById("settingsDrawer");
const openSettingsBtn = document.getElementById("openSettings");
const closeSettingsBtn = document.getElementById("closeSettings");
const gestureTestInput = document.getElementById("gestureTest");
const colorIndicatorsInput = document.getElementById("colorIndicators");
const handIndicatorsEl = document.getElementById("handIndicators");
const indicatorLeft = document.getElementById("indicatorLeft");
const indicatorRight = document.getElementById("indicatorRight");
const stageEl = document.getElementById("stage");
const indicatorPresentColor = document.getElementById("indicatorPresentColor");
const indicatorAbsentColor = document.getElementById("indicatorAbsentColor");
const indicatorFingerUpColor = document.getElementById("indicatorFingerUpColor");
const indicatorPinchColor = document.getElementById("indicatorPinchColor");
const indicatorThumbGlowColor = document.getElementById("indicatorThumbGlowColor");

const fingerSegsLeft = [...indicatorLeft.querySelectorAll(".finger-seg")];
const fingerSegsRight = [...indicatorRight.querySelectorAll(".finger-seg")];

let recognizer = null;
let cameraRunning = false;
let stream = null;
let rafId = null;
let lastVideoTime = -1;
let mode = "channels";

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function resetAll() {
  resetPinch();
  resetChannels();
  resetBanks();
  resetGestures();
}

function setMode(next) {
  mode = next;
  resetAll();
  channelPanel.hidden = mode !== "channels";
  bankPanel.hidden = mode !== "banks";
  pinchPanel.hidden = mode !== "pinch";
  channelSettings.hidden = mode !== "channels" && mode !== "banks";
  pinchSettings.hidden = mode !== "pinch";
}

function setGestureTest(on) {
  gestureTestInput.checked = on;
  resetAll();
}

function setSettingsOpen(open) {
  settingsDrawer.classList.toggle("open", open);
  openSettingsBtn.setAttribute("aria-expanded", String(open));
  if (open) {
    closeSettingsBtn.focus();
    return;
  }
  if (gestureTestInput.checked) {
    setGestureTest(false);
  }
  openSettingsBtn.focus();
}

function setColorIndicators(on) {
  stageEl.classList.toggle("color-indicators", on);
  handIndicatorsEl.hidden = !on;
  handIndicatorsEl.setAttribute("aria-hidden", String(!on));
  if (on) {
    if (!cameraRunning) {
      setHandIndicatorState(null, null);
    }
    return;
  }
  setHandIndicatorState(null, null);
  if (cameraRunning && recognizer) {
    const { results, hands } = readHands(recognizer, video);
    drawHands(results, hands, null);
  }
}

function applyFingerSegs(segs, hand) {
  const flags = hand ? fingerFlags(hand.landmarks) : [false, false, false, false];
  segs.forEach((seg, index) => seg.classList.toggle("up", flags[index]));
}

function applyHandIndicator(el, segs, hand) {
  const present = Boolean(hand);
  const pinching = present && isPinching(hand.landmarks);
  el.classList.toggle("present", present);
  el.classList.toggle("pinching", pinching);
  el.classList.toggle("thumbs-up", present && !pinching && isThumbUp(hand));
  applyFingerSegs(segs, hand);
}

function setHandIndicatorState(left, right) {
  applyHandIndicator(indicatorLeft, fingerSegsLeft, left);
  applyHandIndicator(indicatorRight, fingerSegsRight, right);
}

function applyIndicatorColors() {
  handIndicatorsEl.style.setProperty("--indicator-present", indicatorPresentColor.value);
  handIndicatorsEl.style.setProperty("--indicator-absent", indicatorAbsentColor.value);
  handIndicatorsEl.style.setProperty("--indicator-finger-up", indicatorFingerUpColor.value);
  handIndicatorsEl.style.setProperty("--indicator-pinch", indicatorPinchColor.value);
  handIndicatorsEl.style.setProperty("--indicator-thumb-glow", indicatorThumbGlowColor.value);
}

function updateHandIndicators(hands) {
  const sides = assignHands(hands);
  setHandIndicatorState(sides.left, sides.right);
}

function drawFrame(results, hands, pinch) {
  if (colorIndicatorsInput.checked) {
    updateHandIndicators(hands);
    clearOverlay();
    return;
  }
  drawHands(results, hands, pinch);
}

function predictLoop() {
  if (!cameraRunning) {
    return;
  }
  rafId = requestAnimationFrame(predictLoop);
  if (video.readyState < 2 || video.currentTime === lastVideoTime) {
    return;
  }
  lastVideoTime = video.currentTime;

  const { results, hands } = readHands(recognizer, video);
  if (gestureTestInput.checked) {
    updateGestures(hands);
    drawFrame(results, hands, null);
  } else if (mode === "pinch") {
    const pinch = updatePinch(hands);
    drawFrame(results, hands, pinch);
  } else if (mode === "banks") {
    updateBanks(hands);
    drawFrame(results, hands, null);
  } else {
    updateChannels(hands);
    drawFrame(results, hands, null);
  }
}

async function startCamera() {
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  cameraRunning = true;
  lastVideoTime = -1;
  toggleBtn.textContent = "Stop camera";
  setStatus("Camera running");
  predictLoop();
}

function stopCamera() {
  cameraRunning = false;
  if (rafId != null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (stream) {
    for (const track of stream.getTracks()) {
      track.stop();
    }
    stream = null;
  }
  video.srcObject = null;
  resetAll();
  clearOverlay();
  setHandIndicatorState(null, null);
  readoutEl.textContent = "Camera stopped.";
  toggleBtn.textContent = "Start camera";
  setStatus("Camera stopped");
}

async function toggleCamera() {
  toggleBtn.disabled = true;
  try {
    if (cameraRunning) {
      stopCamera();
    } else {
      await startCamera();
    }
  } catch (err) {
    console.error(err);
    setStatus(`Camera error: ${err.message ?? err}`, true);
  } finally {
    toggleBtn.disabled = false;
  }
}

async function init() {
  modeSelect.addEventListener("change", () => setMode(modeSelect.value));
  setMode(modeSelect.value);
  openSettingsBtn.addEventListener("click", () => setSettingsOpen(true));
  closeSettingsBtn.addEventListener("click", () => setSettingsOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && settingsDrawer.classList.contains("open")) {
      setSettingsOpen(false);
    }
  });
  gestureTestInput.addEventListener("change", () => setGestureTest(gestureTestInput.checked));
  colorIndicatorsInput.addEventListener("change", () => setColorIndicators(colorIndicatorsInput.checked));
  for (const input of [
    indicatorPresentColor,
    indicatorAbsentColor,
    indicatorFingerUpColor,
    indicatorPinchColor,
    indicatorThumbGlowColor,
  ]) {
    input.addEventListener("input", applyIndicatorColors);
  }
  applyIndicatorColors();
  setColorIndicators(false);
  mountMidi();
  mountChannels();
  mountBanks();
  mountPinch();
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        "getUserMedia is unavailable. Serve this page over http://localhost (not file://)."
      );
    }
    setStatus("Loading MediaPipe model…");
    recognizer = await createRecognizer();
    setStatus("Model ready — start the camera");
    toggleBtn.disabled = false;
    toggleBtn.addEventListener("click", toggleCamera);
  } catch (err) {
    console.error(err);
    setStatus(`Init failed: ${err.message ?? err}`, true);
  }
}

init();
