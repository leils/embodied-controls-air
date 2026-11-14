import { assignHands, bothThumbsUp, createHoldCounter, createPoseTrigger } from "./vision.js";
import {
  createChannelControl,
  describeChannel,
  describeLeft,
  describeRight,
  leftIntent,
} from "./channels.js";

const BANK_MIDI_START = 9;
const CHANNELS_PER_BANK = 4;

const readoutEl = document.getElementById("readout");

const banks = [1, 2].map((number) => {
  const el = document.querySelector(`[data-bank="${number}"]`);
  const channels = [...el.querySelectorAll(".channel")].map((row, index) => ({
    number: index + 1,
    midiChannel: BANK_MIDI_START + (number - 1) * CHANNELS_PER_BANK + index,
    selected: false,
    value: 0,
    row,
  }));
  return {
    number,
    el,
    statusEl: el.querySelector(".bank-status"),
    control: createChannelControl(channels),
  };
});

const LOCK_HINT = "both thumbs up to lock";

const toggleTrigger = createPoseTrigger(bothThumbsUp);
const bankHold = createHoldCounter();
let active = banks[0];
let choosing = false;
let pending = null;

function bankStatus(bank) {
  if (choosing && bank === pending) {
    return `selected · ${LOCK_HINT}`;
  }
  if (bank === active) {
    return choosing ? "current" : "active";
  }
  return "";
}

function render() {
  for (const bank of banks) {
    bank.el.classList.toggle("active", bank === active);
    bank.el.classList.toggle("choosing", choosing);
    bank.el.classList.toggle("pending", choosing && bank === pending);
    bank.statusEl.textContent = bankStatus(bank);
  }
}

function clearSelections() {
  for (const bank of banks) {
    bank.control.select(null);
    bank.control.reset();
  }
}

function startChoosing() {
  choosing = true;
  pending = null;
  bankHold.reset();
  clearSelections();
  render();
}

function lockBank() {
  choosing = false;
  active = pending ?? active;
  pending = null;
  clearSelections();
  render();
}

function chooseBank(left) {
  const intent = leftIntent(left, banks.length);
  if (intent.kind !== "select") {
    bankHold.reset();
    return;
  }
  if (bankHold.step(String(intent.number))) {
    pending = banks[intent.number - 1];
    render();
  }
}

export function reset() {
  toggleTrigger.reset();
  bankHold.reset();
  choosing = false;
  pending = null;
  for (const bank of banks) {
    bank.control.reset();
  }
  render();
}

export function updateBanks(hands) {
  const fired = toggleTrigger.step(hands);
  if (fired) {
    if (choosing) {
      lockBank();
    } else {
      startChoosing();
    }
  }

  const { left, right } = assignHands(hands);
  if (choosing) {
    if (!fired) {
      chooseBank(left);
    }
    const target = pending ? `Bank ${pending.number} selected` : `staying on Bank ${active.number}`;
    readoutEl.textContent = `Choosing bank · ${describeLeft(left)} · ${target} · ${LOCK_HINT}`;
    return;
  }

  const motion = fired ? "—" : active.control.update(left, right);
  readoutEl.textContent = `Bank ${active.number} · ${describeLeft(left)} · ${describeRight(right, motion)} · ${describeChannel(active.control.selected())}`;
}

export function mountBanks() {
  for (const bank of banks) {
    bank.control.mount();
  }
  render();
}
