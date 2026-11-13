import { createRecognizer, readHands, drawHands, clearOverlay } from "./vision.js";
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
    drawHands(results, hands, null);
  } else if (mode === "pinch") {
    const pinch = updatePinch(hands);
    drawHands(results, hands, pinch);
  } else if (mode === "banks") {
    updateBanks(hands);
    drawHands(results, hands, null);
  } else {
    updateChannels(hands);
    drawHands(results, hands, null);
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
