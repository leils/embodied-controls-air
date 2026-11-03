const CC_NUMBER = 1;
const MIDI_LOG_LIMIT = 40;

const connectMidiBtn = document.getElementById("connectMidi");
const midiOutputSelect = document.getElementById("midiOutput");
const midiStatusEl = document.getElementById("midiStatus");
const midiLogEl = document.getElementById("midiLog");

let midiAccess = null;
const midiLog = [];

function setMidiStatus(message, isError = false) {
  midiStatusEl.textContent = message;
  midiStatusEl.classList.toggle("error", isError);
}

function channelName(channel) {
  const name = channel.row.querySelector(".channel-name")?.value.trim();
  return name || `Channel ${channel.number}`;
}

export function showMidiChannel(row, midiChannel) {
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

export function sendMidi(channel, name = channelName(channel)) {
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

export function mountMidi() {
  connectMidiBtn.addEventListener("click", connectMidi);
  midiOutputSelect.addEventListener("change", () => {
    const output = selectedMidiOutput();
    setMidiStatus(output ? `Sending to ${output.name}` : "No output selected");
  });
}
