import {
  HOLD_FRAMES,
  INDEX_TIP,
  assignHands,
  bothFists,
  isClosedFist,
  isPinching,
  landmarkDistance,
} from "./vision.js";
import { sendMidi, showMidiChannel } from "./midi.js";

const PINCH_MIDI_START = 5;

const readoutEl = document.getElementById("readout");
const pinchSlider = document.getElementById("pinchSlider");
const pinchValueEl = document.getElementById("pinchValue");
const pinchStrengthInput = document.getElementById("pinchStrength");
const pinchMultiInput = document.getElementById("pinchMulti");
const pinchSingle = document.getElementById("pinchSingle");
const pinchChannelsPanel = document.getElementById("pinchChannels");
const pinchNameInput = document.getElementById("pinchName");

const pinchChannels = [1, 2].map((number) => ({
  number,
  midiChannel: PINCH_MIDI_START + number - 1,
  selected: false,
  value: 0,
  row: document.querySelector(`[data-pinch-channel="${number}"]`),
}));

let pinchValue = 0;
let pinchGrab = null;
let pinchSelectKey = "";
let pinchSelectFrames = 0;

function pinchStrength() {
  const value = Number(pinchStrengthInput.value);
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(1000, Math.max(1, value));
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

export function reset() {
  pinchGrab = null;
  pinchSelectKey = "";
  pinchSelectFrames = 0;
}

export function updatePinch(hands) {
  const pinch = pinchMultiInput.checked ? applyPinchChannels(hands) : applyPinch(hands);
  describePinch(hands, pinch);
  return pinch;
}

export function mountPinch() {
  for (const channel of pinchChannels) {
    showMidiChannel(channel.row, channel.midiChannel);
  }
  showMidiChannel(pinchNameInput.closest(".channel"), PINCH_MIDI_START);
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
}
