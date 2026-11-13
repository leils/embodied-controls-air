import {
  HOLD_FRAMES,
  INDEX_TIP,
  assignHands,
  createHoldCounter,
  isClosedFist,
  isOpenPalm,
  isPinching,
  isThumbGesture,
} from "./vision.js";
import { sendMidi, showMidiChannel } from "./midi.js";

const readoutEl = document.getElementById("readout");
const pinchClutchInput = document.getElementById("pinchClutch");
const channelStrengthInput = document.getElementById("channelStrength");
const channelMinInput = document.getElementById("channelMin");
const channelMaxInput = document.getElementById("channelMax");
const channelDeadzoneInput = document.getElementById("channelDeadzone");

/** Every channel list created through createChannelControl, so settings changes reach all of them. */
const groups = [];

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
  for (const channels of groups) {
    for (const channel of channels) {
      const next = clampChannelValue(channel.value);
      if (next !== channel.value) {
        channel.value = next;
        sendMidi(channel);
      }
      renderChannel(channel);
    }
  }
}

/**
 * Left-hand intent. A fist clears, 1..maxFingers fingers selects that number.
 * An open palm holds: it reads as four fingers up, and would otherwise select
 * the fourth item whenever both hands open.
 */
export function leftIntent(hand, maxFingers) {
  if (!hand) {
    return { kind: "absent" };
  }
  if (isClosedFist(hand)) {
    return { kind: "deselect" };
  }
  if (isOpenPalm(hand)) {
    return { kind: "hold" };
  }
  if (hand.fingersUp >= 1 && hand.fingersUp <= maxFingers) {
    return { kind: "select", number: hand.fingersUp };
  }
  return { kind: "hold" };
}

export function describeLeft(left) {
  if (!left) {
    return "Left: —";
  }
  if (isClosedFist(left)) {
    return "Left: fist";
  }
  if (isOpenPalm(left)) {
    return "Left: open";
  }
  if (isThumbGesture(left)) {
    return "Left: thumb";
  }
  return `Left: ${left.fingersUp} fingers`;
}

export function describeRight(right, motion) {
  if (!right) {
    return "Right: —";
  }
  if (motion === "fist" || motion === "thumb") {
    return `Right: ${motion}`;
  }
  if (pinchClutchInput.checked && !isPinching(right.landmarks)) {
    return "Right: pinch to move";
  }
  return `Right index: ${motion}`;
}

export function describeChannel(channel) {
  return channel ? `Channel ${channel.number} = ${channel.value}` : "No channel";
}

/**
 * Selection and value control for one list of channels: the left hand picks
 * a channel, right index motion nudges its value.
 */
export function createChannelControl(channels) {
  groups.push(channels);
  const hold = createHoldCounter();
  /** Last right-index y while tracking relative height. */
  let trackY = null;
  /** Frames to skip after a right fist or thumb, so the fingers uncurling does not raise the value. */
  let settleFrames = 0;
  let frozenLabel = "fist";

  function selected() {
    return channels.find((channel) => channel.selected) ?? null;
  }

  function select(number) {
    let changed = false;
    for (const channel of channels) {
      const isSelected = channel.number === number;
      if (channel.selected !== isSelected) {
        channel.selected = isSelected;
        changed = true;
        renderChannel(channel);
      }
    }
    if (changed) {
      trackY = null;
    }
  }

  function applyLeft(left) {
    const intent = leftIntent(left, channels.length);
    if (intent.kind === "absent" || intent.kind === "hold") {
      hold.reset();
      return;
    }
    const key = intent.kind === "deselect" ? "none" : String(intent.number);
    if (hold.step(key)) {
      select(intent.kind === "deselect" ? null : intent.number);
    }
  }

  /**
   * Raising the finger (y decreases) increases the value; lowering decreases it.
   * Still fingers leave the value alone. Returns a short motion label for the readout.
   */
  function adjustByIndexHeight(y) {
    const channel = selected();
    if (!channel) {
      trackY = null;
      return "hold";
    }
    if (trackY == null) {
      trackY = y;
      return "ready";
    }
    const deltaUp = trackY - y;
    trackY = y;
    if (Math.abs(deltaUp) < channelDeadzone()) {
      return "still";
    }
    const value = clampChannelValue(Math.round(channel.value + deltaUp * channelStrength()));
    if (value !== channel.value) {
      channel.value = value;
      renderChannel(channel);
      sendMidi(channel);
    }
    return deltaUp > 0 ? "up" : "down";
  }

  function applyRight(right) {
    if (!right) {
      trackY = null;
      return "—";
    }
    if (isClosedFist(right) || isThumbGesture(right)) {
      trackY = null;
      settleFrames = HOLD_FRAMES;
      frozenLabel = isClosedFist(right) ? "fist" : "thumb";
      return frozenLabel;
    }
    if (settleFrames > 0) {
      settleFrames -= 1;
      trackY = null;
      return frozenLabel;
    }
    if (pinchClutchInput.checked && !isPinching(right.landmarks)) {
      trackY = null;
      return "—";
    }
    return adjustByIndexHeight(right.landmarks[INDEX_TIP].y);
  }

  /** Returns the right-hand motion label. */
  function update(left, right) {
    applyLeft(left);
    return applyRight(right);
  }

  function reset() {
    trackY = null;
    settleFrames = 0;
    hold.reset();
  }

  function mount() {
    for (const channel of channels) {
      showMidiChannel(channel.row, channel.midiChannel);
      renderChannel(channel);
      for (const input of channel.row.querySelectorAll("input")) {
        input.addEventListener("click", (event) => event.preventDefault());
        input.addEventListener("input", () => renderChannel(channel));
      }
    }
  }

  return { update, select, selected, reset, mount };
}

const individual = createChannelControl(
  [1, 2, 3, 4].map((number) => ({
    number,
    midiChannel: number,
    selected: false,
    value: 0,
    row: document.querySelector(`[data-channel="${number}"]`),
  }))
);

export function reset() {
  individual.reset();
}

export function updateChannels(hands) {
  const { left, right } = assignHands(hands);
  const motion = individual.update(left, right);
  readoutEl.textContent = `${describeLeft(left)} · ${describeRight(right, motion)} · ${describeChannel(individual.selected())}`;
}

export function mountChannels() {
  for (const input of [
    channelStrengthInput,
    channelMinInput,
    channelMaxInput,
    channelDeadzoneInput,
  ]) {
    input.addEventListener("change", applyChannelSettings);
  }
  individual.mount();
}
