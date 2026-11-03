import { createRecognizer, readHands, drawHands, clearOverlay } from "./vision.js";
import { mountMidi } from "./midi.js";
import { mountChannels, updateChannels, reset as resetChannels } from "./channels.js";
import { mountPinch, updatePinch, reset as resetPinch } from "./pinch.js";

const video = document.getElementById("webcam");
const toggleBtn = document.getElementById("toggleCamera");
const statusEl = document.getElementById("status");
const readoutEl = document.getElementById("readout");
const channelPanel = document.getElementById("channelPanel");
const pinchPanel = document.getElementById("pinchPanel");
const modeChannelsBtn = document.getElementById("modeChannels");
const modePinchBtn = document.getElementById("modePinch");

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

function setMode(next) {
  mode = next;
  resetPinch();
  resetChannels();
  channelPanel.hidden = mode !== "channels";
  pinchPanel.hidden = mode !== "pinch";
  modeChannelsBtn.classList.toggle("active", mode === "channels");
  modePinchBtn.classList.toggle("active", mode === "pinch");
  modeChannelsBtn.setAttribute("aria-pressed", String(mode === "channels"));
  modePinchBtn.setAttribute("aria-pressed", String(mode === "pinch"));
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
  if (mode === "pinch") {
    const pinch = updatePinch(hands);
    drawHands(results, hands, pinch);
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
  resetPinch();
  resetChannels();
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
  modeChannelsBtn.addEventListener("click", () => setMode("channels"));
  modePinchBtn.addEventListener("click", () => setMode("pinch"));
  mountMidi();
  mountChannels();
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
