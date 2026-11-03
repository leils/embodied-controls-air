import { HOLD_FRAMES, INDEX_TIP, assignHands, isPinching } from "./vision.js";
import { sendMidi, showMidiChannel } from "./midi.js";

const readoutEl = document.getElementById("readout");
const pinchClutchInput = document.getElementById("pinchClutch");
const channelStrengthInput = document.getElementById("channelStrength");
const channelMinInput = document.getElementById("channelMin");
const channelMaxInput = document.getElementById("channelMax");
const channelDeadzoneInput = document.getElementById("channelDeadzone");

const channels = [1, 2, 3, 4].map((number) => ({
  number,
  midiChannel: number,
  selected: false,
  value: 0,
  row: document.querySelector(`[data-channel="${number}"]`),
}));

let pendingKey = "";
let pendingFrames = 0;
/** Last right-index y while tracking relative height for individual channels. */
let indexTrackY = null;

function channelRange() {
  let min = Number(channelMinInput.value);
  let max = Number(channelMaxInput.value);
  if (!Number.isFinite(min)) {
    min = 0;
  }
  if (!Number.isFinite(max)) {
    max = 127;
  }
  min = Math.min(127, Math.max(0, Math.round(min)));
  max = Math.min(127, Math.max(0, Math.round(max)));
  if (min > max) {
    [min, max] = [max, min];
  }
  return { min, max };
}

function channelStrength() {
  const value = Number(channelStrengthInput.value);
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(1000, Math.max(1, value));
}

function channelDeadzone() {
  const value = Number(channelDeadzoneInput.value);
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.min(0.1, value);
}

function clampChannelValue(value) {
  const { min, max } = channelRange();
  return Math.min(max, Math.max(min, value));
}

function renderChannel(channel) {
  const { min, max } = channelRange();
  const range = channel.row.querySelector('input[type="range"]');
  range.min = String(min);
  range.max = String(max);
  channel.row.classList.toggle("selected", channel.selected);
  channel.row.querySelector('input[type="checkbox"]').checked = channel.selected;
  range.value = String(channel.value);
  channel.row.querySelector("output").textContent = String(channel.value);
}

function applyChannelSettings() {
  for (const channel of channels) {
    const next = clampChannelValue(channel.value);
    if (next !== channel.value) {
      channel.value = next;
      sendMidi(channel);
    }
    renderChannel(channel);
  }
}

function selectChannel(number) {
  let changed = false;
  for (const channel of channels) {
    const selected = channel.number === number;
    if (channel.selected !== selected) {
      channel.selected = selected;
      changed = true;
      renderChannel(channel);
    }
  }
  if (changed) {
    indexTrackY = null;
  }
}

/**
 * Adjust the selected channel from relative right-index motion.
 * Raising the finger (y decreases) increases the value; lowering decreases it.
 * Still fingers leave the value alone. Returns a short motion label for the readout.
 */
function adjustSelectedByIndexHeight(y) {
  const channel = channels.find((item) => item.selected);
  if (!channel) {
    indexTrackY = null;
    return "hold";
  }
  if (indexTrackY == null) {
    indexTrackY = y;
    return "ready";
  }
  const deltaUp = indexTrackY - y;
  indexTrackY = y;
  if (Math.abs(deltaUp) < channelDeadzone()) {
    return "still";
  }
  const value = clampChannelValue(Math.round(channel.value + deltaUp * channelStrength()));
  if (value === channel.value) {
    return deltaUp > 0 ? "up" : "down";
  }
  channel.value = value;
  renderChannel(channel);
  sendMidi(channel);
  return deltaUp > 0 ? "up" : "down";
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

function describeHands(left, right, motion) {
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
      : `Right index: ${motion}`;
  const channelText = selected ? `Channel ${selected.number} = ${selected.value}` : "No channel";
  readoutEl.textContent = `${leftText} · ${rightText} · ${channelText}`;
}

export function reset() {
  indexTrackY = null;
}

export function updateChannels(hands) {
  const { left, right } = assignHands(hands);
  applyLeftIntent(leftIntent(left));
  const clutchEngaged = !pinchClutchInput.checked || (right && isPinching(right.landmarks));
  let motion = "—";
  if (right && clutchEngaged) {
    motion = adjustSelectedByIndexHeight(right.landmarks[INDEX_TIP].y);
  } else {
    indexTrackY = null;
  }
  describeHands(left, right, motion);
}

export function mountChannels() {
  for (const channel of channels) {
    showMidiChannel(channel.row, channel.midiChannel);
  }
  for (const input of [
    channelStrengthInput,
    channelMinInput,
    channelMaxInput,
    channelDeadzoneInput,
  ]) {
    input.addEventListener("change", applyChannelSettings);
  }
  for (const channel of channels) {
    renderChannel(channel);
    for (const input of channel.row.querySelectorAll("input")) {
      input.addEventListener("click", (event) => event.preventDefault());
      input.addEventListener("input", () => renderChannel(channel));
    }
  }
}
