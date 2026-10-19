const CC_NUMBER = 1;

const connectBtn = document.getElementById("connect");
const outputSelect = document.getElementById("output");
const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");
const incomingEl = document.getElementById("incoming");
const sliders = [
  { el: document.getElementById("slider1"), valueEl: document.getElementById("value1"), channel: 0 },
  { el: document.getElementById("slider2"), valueEl: document.getElementById("value2"), channel: 1 },
];

let midiAccess = null;

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function selectedOutput() {
  const id = outputSelect.value;
  return id ? midiAccess?.outputs.get(id) ?? null : null;
}

function refreshOutputs() {
  const previous = outputSelect.value;
  outputSelect.replaceChildren();

  const outputs = [...(midiAccess?.outputs.values() ?? [])];
  if (outputs.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No outputs";
    outputSelect.append(option);
    outputSelect.disabled = true;
    for (const slider of sliders) {
      slider.el.disabled = true;
    }
    setStatus("Connected, but no MIDI outputs are available");
    return;
  }

  for (const output of outputs) {
    const option = document.createElement("option");
    option.value = output.id;
    option.textContent = output.name || output.id;
    outputSelect.append(option);
  }

  const iac = outputs.find((output) => /IAC/i.test(output.name ?? ""));
  if (outputs.some((output) => output.id === previous)) {
    outputSelect.value = previous;
  } else if (iac) {
    outputSelect.value = iac.id;
  }
  outputSelect.disabled = false;
  for (const slider of sliders) {
    slider.el.disabled = false;
  }
  listenToInputs();
  setStatus(`Sending to ${selectedOutput()?.name ?? "output"}`);
}

function listenToInputs() {
  for (const input of midiAccess?.inputs.values() ?? []) {
    input.onmidimessage = (event) => {
      const [status, data1, data2] = event.data;
      const command = status & 0xf0;
      const channel = (status & 0x0f) + 1;
      if (command === 0xb0) {
        incomingEl.textContent = `${input.name}\nch ${channel}  CC ${data1}  value ${data2}`;
        return;
      }
      const bytes = [...event.data].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
      incomingEl.textContent = `${input.name}\n${bytes}`;
    };
  }
}

function sendCc(channel, value) {
  const output = selectedOutput();
  if (!output) {
    return;
  }

  const status = 0xb0 | channel;
  const message = [status, CC_NUMBER, value];
  output.send(message);

  const bytes = message.map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
  logEl.textContent = `ch ${channel + 1}  CC ${CC_NUMBER}  value ${value}\n${bytes}`;
}

function onSliderInput(slider) {
  const value = Number(slider.el.value);
  slider.valueEl.textContent = String(value);
  sendCc(slider.channel, value);
}

async function connect() {
  connectBtn.disabled = true;
  try {
    if (!navigator.requestMIDIAccess) {
      throw new Error(
        "Web MIDI is not available in this browser. Use Chrome or Edge over http://localhost or https."
      );
    }

    midiAccess = await navigator.requestMIDIAccess();
    midiAccess.onstatechange = refreshOutputs;
    refreshOutputs();
    connectBtn.textContent = "Reconnect";
  } catch (err) {
    console.error(err);
    setStatus(err.message ?? String(err), true);
  } finally {
    connectBtn.disabled = false;
  }
}

connectBtn.addEventListener("click", connect);
outputSelect.addEventListener("change", () => {
  const output = selectedOutput();
  setStatus(output ? `Sending to ${output.name}` : "No output selected");
});

for (const slider of sliders) {
  slider.el.addEventListener("input", () => onSliderInput(slider));
}
