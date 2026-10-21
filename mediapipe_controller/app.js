import {
  FilesetResolver,
  GestureRecognizer,
  DrawingUtils,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/vision_bundle.mjs";

const TASKS_VISION_VERSION = "0.10.18";
const WASM_ROOT = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";

const THUMB_TIP = 4;
const INDEX_MCP = 5;
const INDEX_TIP = 8;
const PINKY_MCP = 17;
const HOLD_FRAMES = 6;
const VALUE_BLEND = 0.45;
const PINCH_RATIO = 0.6;
const FRAME_MARGIN = 0.1;
const CC_NUMBER = 1;
const PINCH_MIDI_START = 5;
const MIDI_LOG_LIMIT = 40;

const FINGERS = [
  { name: "index", tip: 8, pip: 6 },
  { name: "middle", tip: 12, pip: 10 },
  { name: "ring", tip: 16, pip: 14 },
  { name: "pinky", tip: 20, pip: 18 },
];

const video = document.getElementById("webcam");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");
const toggleBtn = document.getElementById("toggleCamera");
const statusEl = document.getElementById("status");
const readoutEl = document.getElementById("readout");
const pinchClutchInput = document.getElementById("pinchClutch");
const channelPanel = document.getElementById("channelPanel");
const pinchPanel = document.getElementById("pinchPanel");
const modeChannelsBtn = document.getElementById("modeChannels");
const modePinchBtn = document.getElementById("modePinch");
const pinchSlider = document.getElementById("pinchSlider");
const pinchValueEl = document.getElementById("pinchValue");
const pinchStrengthInput = document.getElementById("pinchStrength");
const pinchMultiInput = document.getElementById("pinchMulti");
const pinchSingle = document.getElementById("pinchSingle");
const pinchChannelsPanel = document.getElementById("pinchChannels");
const pinchNameInput = document.getElementById("pinchName");
const connectMidiBtn = document.getElementById("connectMidi");
const midiOutputSelect = document.getElementById("midiOutput");
const midiStatusEl = document.getElementById("midiStatus");
const midiLogEl = document.getElementById("midiLog");

const channels = [1, 2, 3, 4].map((number) => ({
  number,
  midiChannel: number,
  selected: false,
  value: 0,
  row: document.querySelector(`[data-channel="${number}"]`),
}));

let gestureRecognizer = null;
let cameraRunning = false;
let stream = null;
let rafId = null;
let lastVideoTime = -1;
let pendingKey = "";
let pendingFrames = 0;
let mode = "channels";
let pinchValue = 0;
let pinchGrab = null;
let pinchSelectKey = "";
let pinchSelectFrames = 0;
let midiAccess = null;
const midiLog = [];

const pinchChannels = [1, 2].map((number) => ({
  number,
  midiChannel: PINCH_MIDI_START + number - 1,
  selected: false,
  value: 0,
  row: document.querySelector(`[data-pinch-channel="${number}"]`),
}));

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function setMidiStatus(message, isError = false) {
  midiStatusEl.textContent = message;
  midiStatusEl.classList.toggle("error", isError);
}

function channelName(channel) {
  const name = channel.row.querySelector(".channel-name")?.value.trim();
  return name || `Channel ${channel.number}`;
}

function showMidiChannel(row, midiChannel) {
  const label = document.createElement("span");
  label.className = "midi-ch";
  label.textContent = `MIDI ${midiChannel}`;
  row.querySelector(".channel-check").append(label);
}

function selectedMidiOutput() {
  const id = midiOutputSelect.value;
  return id ? midiAccess?.outputs.get(id) ?? null : null;
}

function logMidi(name, channelNumber, value, message) {
  const bytes = message.map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
  const time = new Date().toLocaleTimeString("en-GB", { hour12: false });
  midiLog.unshift(`${time}  ${name}  ch ${channelNumber}  CC ${CC_NUMBER}  ${value}  ${bytes}`);
  if (midiLog.length > MIDI_LOG_LIMIT) {
    midiLog.length = MIDI_LOG_LIMIT;
  }
  midiLogEl.textContent = midiLog.join("\n");
}

function sendMidi(channel, name = channelName(channel)) {
  const output = selectedMidiOutput();
  if (!output) {
    return;
  }
  const message = [0xb0 | (channel.midiChannel - 1), CC_NUMBER, channel.value];
  output.send(message);
  logMidi(name, channel.midiChannel, channel.value, message);
}

function refreshMidiOutputs() {
  const previous = midiOutputSelect.value;
  midiOutputSelect.replaceChildren();
  const outputs = [...(midiAccess?.outputs.values() ?? [])];
  if (outputs.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No outputs";
    midiOutputSelect.append(option);
    midiOutputSelect.disabled = true;
    setMidiStatus("Connected, but no MIDI outputs are available");
    return;
  }
  for (const output of outputs) {
    const option = document.createElement("option");
    option.value = output.id;
    option.textContent = output.name || output.id;
    midiOutputSelect.append(option);
  }
  const iac = outputs.find((output) => /IAC/i.test(output.name ?? ""));
  if (outputs.some((output) => output.id === previous)) {
    midiOutputSelect.value = previous;
  } else if (iac) {
    midiOutputSelect.value = iac.id;
  }
  midiOutputSelect.disabled = false;
  setMidiStatus(`Sending to ${selectedMidiOutput()?.name ?? "output"}`);
}

async function connectMidi() {
  connectMidiBtn.disabled = true;
  try {
    if (!navigator.requestMIDIAccess) {
      throw new Error("Web MIDI is not available in this browser. Use Chrome or Edge.");
    }
    midiAccess = await navigator.requestMIDIAccess();
    midiAccess.onstatechange = refreshMidiOutputs;
    refreshMidiOutputs();
    connectMidiBtn.textContent = "Reconnect";
  } catch (err) {
    console.error(err);
    setMidiStatus(err.message ?? String(err), true);
  } finally {
    connectMidiBtn.disabled = false;
  }
}

function renderChannel(channel) {
  channel.row.classList.toggle("selected", channel.selected);
  channel.row.querySelector('input[type="checkbox"]').checked = channel.selected;
  channel.row.querySelector('input[type="range"]').value = String(channel.value);
  channel.row.querySelector("output").textContent = String(channel.value);
}

function selectChannel(number) {
  for (const channel of channels) {
    const selected = channel.number === number;
    if (channel.selected !== selected) {
      channel.selected = selected;
      renderChannel(channel);
    }
  }
}

function renderPinch() {
  pinchSlider.value = String(pinchValue);
  pinchValueEl.textContent = String(pinchValue);
}

function renderPinchChannel(channel) {
  channel.row.classList.toggle("selected", channel.selected);
  channel.row.querySelector('input[type="checkbox"]').checked = channel.selected;
  channel.row.querySelector('input[type="range"]').value = String(channel.value);
  channel.row.querySelector("output").textContent = String(channel.value);
}

function setPinchMulti(on) {
  pinchGrab = null;
  pinchSelectKey = "";
  pinchSelectFrames = 0;
  pinchSingle.hidden = on;
  pinchChannelsPanel.hidden = !on;
}

function selectPinchChannel(number) {
  let changed = false;
  for (const channel of pinchChannels) {
    const selected = channel.number === number;
    if (channel.selected !== selected) {
      channel.selected = selected;
      changed = true;
      renderPinchChannel(channel);
    }
  }
  if (changed) {
    pinchGrab = null;
  }
}

function setMode(next) {
  mode = next;
  pinchGrab = null;
  pinchSelectKey = "";
  pinchSelectFrames = 0;
  channelPanel.hidden = mode !== "channels";
  pinchPanel.hidden = mode !== "pinch";
  modeChannelsBtn.classList.toggle("active", mode === "channels");
  modePinchBtn.classList.toggle("active", mode === "pinch");
  modeChannelsBtn.setAttribute("aria-pressed", String(mode === "channels"));
  modePinchBtn.setAttribute("aria-pressed", String(mode === "pinch"));
}

function setSelectedValue(raw) {
  const channel = channels.find((item) => item.selected);
  if (!channel) {
    return;
  }
  const value = Math.round(channel.value + (raw - channel.value) * VALUE_BLEND);
  if (value === channel.value) {
    return;
  }
  channel.value = value;
  renderChannel(channel);
  sendMidi(channel);
}

function topCategory(categories) {
  return categories?.[0] ?? null;
}

function countFingersUp(landmarks) {
  const wrist = landmarks[0];
  return FINGERS.filter((finger) => {
    const tip = landmarks[finger.tip];
    const pip = landmarks[finger.pip];
    const tipDist = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
    const pipDist = Math.hypot(pip.x - wrist.x, pip.y - wrist.y);
    return tipDist > pipDist * 1.08;
  }).length;
}

function pinchStrength() {
  const value = Number(pinchStrengthInput.value);
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(1000, Math.max(1, value));
}

function landmarkDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isPinching(landmarks) {
  const gap = landmarkDistance(landmarks[THUMB_TIP], landmarks[INDEX_TIP]);
  const palm = landmarkDistance(landmarks[INDEX_MCP], landmarks[PINKY_MCP]);
  return palm > 0 && gap / palm < PINCH_RATIO;
}

function heightToValue(y) {
  const span = 1 - FRAME_MARGIN * 2;
  const t = (y - FRAME_MARGIN) / span;
  const clamped = Math.min(1, Math.max(0, t));
  return Math.round((1 - clamped) * 127);
}

function summarizeHand(index, results) {
  const landmarks = results.landmarks[index];
  const gesture = topCategory(results.gestures?.[index]);
  return {
    landmarks,
    gestureName: gesture?.categoryName ?? gesture?.displayName ?? "None",
    gestureScore: gesture?.score ?? 0,
    fingersUp: countFingersUp(landmarks),
    screenX: 1 - landmarks[0].x,
  };
}

function assignHands(hands) {
  hands = [...hands].sort((a, b) => a.screenX - b.screenX);
  if (hands.length === 0) {
    return { left: null, right: null };
  }
  if (hands.length === 1) {
    return hands[0].screenX < 0.5
      ? { left: hands[0], right: null }
      : { left: null, right: hands[0] };
  }
  return { left: hands[0], right: hands[hands.length - 1] };
}

function leftIntent(hand) {
  if (!hand) {
    return { kind: "absent" };
  }
  if (hand.gestureName === "Closed_Fist" && hand.gestureScore >= 0.5) {
    return { kind: "deselect" };
  }
  if (hand.fingersUp >= 1 && hand.fingersUp <= 4) {
    return { kind: "select", channel: hand.fingersUp };
  }
  return { kind: "hold" };
}

function applyLeftIntent(intent) {
  if (intent.kind === "absent" || intent.kind === "hold") {
    pendingKey = "";
    pendingFrames = 0;
    return;
  }
  const key = intent.kind === "deselect" ? "none" : String(intent.channel);
  pendingFrames = key === pendingKey ? pendingFrames + 1 : 1;
  pendingKey = key;
  if (pendingFrames === HOLD_FRAMES) {
    selectChannel(intent.kind === "deselect" ? null : intent.channel);
  }
}

function isClosedFist(hand) {
  return hand.gestureName === "Closed_Fist" && hand.gestureScore >= 0.5;
}

function bothFists(hands) {
  return hands.length >= 2 && hands.every(isClosedFist);
}

function pinchSpanUpdate(hands, currentValue) {
  if (hands.length < 2 || !hands.every((hand) => isPinching(hand.landmarks))) {
    pinchGrab = null;
    return { active: false, value: currentValue };
  }

  const [a, b] = hands;
  const span = landmarkDistance(a.landmarks[INDEX_TIP], b.landmarks[INDEX_TIP]);
  if (!pinchGrab) {
    pinchGrab = { originSpan: span, originValue: currentValue };
  }

  const value = Math.round(
    Math.min(127, Math.max(0, pinchGrab.originValue + (span - pinchGrab.originSpan) * pinchStrength()))
  );
  return { active: true, span, value };
}

function applyPinch(hands) {
  const pinch = pinchSpanUpdate(hands, pinchValue);
  if (pinch.active && pinch.value !== pinchValue) {
    pinchValue = pinch.value;
    renderPinch();
    const name = pinchNameInput.value.trim() || "Pinch";
    sendMidi(
      { midiChannel: PINCH_MIDI_START, value: pinchValue, row: pinchNameInput.closest(".channel") },
      name
    );
  }
  return pinch;
}

function pinchMultiIntent(hands, left) {
  if (bothFists(hands)) {
    return { kind: "deselect" };
  }
  if (left && left.fingersUp >= 1 && left.fingersUp <= 2) {
    return { kind: "select", channel: left.fingersUp };
  }
  return { kind: "hold" };
}

function applyPinchSelection(intent) {
  if (intent.kind === "hold") {
    pinchSelectKey = "";
    pinchSelectFrames = 0;
    return;
  }
  const key = intent.kind === "deselect" ? "none" : String(intent.channel);
  pinchSelectFrames = key === pinchSelectKey ? pinchSelectFrames + 1 : 1;
  pinchSelectKey = key;
  if (pinchSelectFrames === HOLD_FRAMES) {
    selectPinchChannel(intent.kind === "deselect" ? null : intent.channel);
  }
}

function applyPinchChannels(hands) {
  const { left } = assignHands(hands);
  applyPinchSelection(pinchMultiIntent(hands, left));
  const selected = pinchChannels.find((channel) => channel.selected);
  if (!selected) {
    pinchGrab = null;
    return { active: false, left };
  }
  const pinch = pinchSpanUpdate(hands, selected.value);
  if (pinch.active && pinch.value !== selected.value) {
    selected.value = pinch.value;
    renderPinchChannel(selected);
    sendMidi(selected);
  }
  return { ...pinch, left };
}

function describePinch(hands, pinch) {
  if (pinchMultiInput.checked) {
    const selected = pinchChannels.find((channel) => channel.selected);
    const leftText = !pinch.left
      ? "Left: —"
      : isClosedFist(pinch.left)
        ? "Left: fist"
        : `Left: ${pinch.left.fingersUp} fingers`;
    const channelText = bothFists(hands)
      ? "both fists"
      : selected
        ? `Channel ${selected.number}`
        : "No channel";
    const spanText = pinch.active ? `span ${pinch.span.toFixed(2)}` : "not pinching";
    readoutEl.textContent = `${leftText} · ${channelText} · ${spanText}`;
    return;
  }
  if (hands.length < 2) {
    readoutEl.textContent = `Pinch: need both hands · ${pinchValue}`;
    return;
  }
  const pose = hands.map((hand) => (isPinching(hand.landmarks) ? "pinch" : "open")).join(" + ");
  if (!pinch.active) {
    readoutEl.textContent = `Pinch: ${pose} · hold ${pinchValue}`;
    return;
  }
  readoutEl.textContent = `Pinch: both · span ${pinch.span.toFixed(2)} · ${pinchValue}`;
}

function describeHands(left, right) {
  const selected = channels.find((channel) => channel.selected);
  const leftText = !left
    ? "Left: —"
    : left.gestureName === "Closed_Fist"
      ? "Left: fist"
      : `Left: ${left.fingersUp} fingers`;
  const clutchOpen = pinchClutchInput.checked && right && !isPinching(right.landmarks);
  const rightText = !right
    ? "Right: —"
    : clutchOpen
      ? "Right: pinch to move"
      : `Right index: ${heightToValue(right.landmarks[INDEX_TIP].y)}`;
  const channelText = selected ? `Channel ${selected.number}` : "No channel";
  readoutEl.textContent = `${leftText} · ${rightText} · ${channelText}`;
}

function resizeCanvas() {
  const width = video.videoWidth || canvas.clientWidth;
  const height = video.videoHeight || canvas.clientHeight;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function drawActiveFrame() {
  const x = FRAME_MARGIN * canvas.width;
  const y = FRAME_MARGIN * canvas.height;
  ctx.strokeStyle = "rgba(232, 232, 232, 0.55)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, canvas.width - x * 2, canvas.height - y * 2);
}

function drawHands(results, hands, pinchActive) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawActiveFrame();
  if (!results.landmarks?.length) {
    return;
  }
  const drawingUtils = new DrawingUtils(ctx);
  for (const landmarks of results.landmarks) {
    drawingUtils.drawConnectors(landmarks, GestureRecognizer.HAND_CONNECTIONS, {
      color: "#4a9eff",
      lineWidth: 3,
    });
    drawingUtils.drawLandmarks(landmarks, {
      color: "#e8e8e8",
      fillColor: "#4a9eff",
      radius: 4,
    });
  }
  if (mode !== "pinch" || hands.length < 2) {
    return;
  }
  const a = hands[0].landmarks[INDEX_TIP];
  const b = hands[1].landmarks[INDEX_TIP];
  ctx.beginPath();
  ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
  ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
  ctx.strokeStyle = pinchActive ? "#4a9eff" : "#9a9a9a";
  ctx.lineWidth = 2;
  ctx.stroke();
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
  resizeCanvas();

  const results = gestureRecognizer.recognizeForVideo(video, performance.now());
  const hands = (results.landmarks ?? []).map((_, index) => summarizeHand(index, results));
  if (mode === "pinch") {
    const pinch = pinchMultiInput.checked ? applyPinchChannels(hands) : applyPinch(hands);
    drawHands(results, hands, pinch.active);
    describePinch(hands, pinch);
    return;
  }
  const { left, right } = assignHands(hands);
  applyLeftIntent(leftIntent(left));
  const clutchEngaged = !pinchClutchInput.checked || (right && isPinching(right.landmarks));
  if (right && clutchEngaged) {
    setSelectedValue(heightToValue(right.landmarks[INDEX_TIP].y));
  }
  drawHands(results, hands, false);
  describeHands(left, right);
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
  pinchGrab = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
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
  for (const channel of channels) {
    showMidiChannel(channel.row, channel.midiChannel);
  }
  for (const channel of pinchChannels) {
    showMidiChannel(channel.row, channel.midiChannel);
  }
  showMidiChannel(pinchNameInput.closest(".channel"), PINCH_MIDI_START);
  modeChannelsBtn.addEventListener("click", () => setMode("channels"));
  modePinchBtn.addEventListener("click", () => setMode("pinch"));
  connectMidiBtn.addEventListener("click", connectMidi);
  midiOutputSelect.addEventListener("change", () => {
    const output = selectedMidiOutput();
    setMidiStatus(output ? `Sending to ${output.name}` : "No output selected");
  });
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        "getUserMedia is unavailable. Serve this page over http://localhost (not file://)."
      );
    }
    setStatus("Loading MediaPipe model…");
    const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
    gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 2,
    });
    for (const channel of channels) {
      renderChannel(channel);
      for (const input of channel.row.querySelectorAll("input")) {
        input.addEventListener("click", (event) => event.preventDefault());
        input.addEventListener("input", () => renderChannel(channel));
      }
    }
    renderPinch();
    pinchSlider.addEventListener("click", (event) => event.preventDefault());
    pinchSlider.addEventListener("input", renderPinch);
    for (const channel of pinchChannels) {
      renderPinchChannel(channel);
      for (const input of channel.row.querySelectorAll("input")) {
        input.addEventListener("click", (event) => event.preventDefault());
        input.addEventListener("input", () => renderPinchChannel(channel));
      }
    }
    pinchMultiInput.addEventListener("change", () => setPinchMulti(pinchMultiInput.checked));
    setStatus("Model ready — start the camera");
    toggleBtn.disabled = false;
    toggleBtn.addEventListener("click", toggleCamera);
  } catch (err) {
    console.error(err);
    setStatus(`Init failed: ${err.message ?? err}`, true);
  }
}

init();
