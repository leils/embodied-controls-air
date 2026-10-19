import {
  FilesetResolver,
  GestureRecognizer,
  DrawingUtils,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/vision_bundle.mjs";

const TASKS_VISION_VERSION = "0.10.18";
const WASM_ROOT = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";

const LANDMARK_NAMES = [
  "wrist",
  "thumb_cmc",
  "thumb_mcp",
  "thumb_ip",
  "thumb_tip",
  "index_mcp",
  "index_pip",
  "index_dip",
  "index_tip",
  "middle_mcp",
  "middle_pip",
  "middle_dip",
  "middle_tip",
  "ring_mcp",
  "ring_pip",
  "ring_dip",
  "ring_tip",
  "pinky_mcp",
  "pinky_pip",
  "pinky_dip",
  "pinky_tip",
];

/** MediaPipe Gesture Recognizer built-in (canned) labels. */
const BUILTIN_GESTURES = [
  "None",
  "Closed_Fist",
  "Open_Palm",
  "Pointing_Up",
  "Thumb_Down",
  "Thumb_Up",
  "Victory",
  "ILoveYou",
];

const FINGER_DEFS = [
  { name: "thumb", tip: 4, pip: 3, mcp: 2 },
  { name: "index", tip: 8, pip: 6, mcp: 5 },
  { name: "middle", tip: 12, pip: 10, mcp: 9 },
  { name: "ring", tip: 16, pip: 14, mcp: 13 },
  { name: "pinky", tip: 20, pip: 18, mcp: 17 },
];

const video = document.getElementById("webcam");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");
const toggleBtn = document.getElementById("toggleCamera");
const statusEl = document.getElementById("status");
const signalDump = document.getElementById("signalDump");
const gestureFeedback = document.getElementById("gestureFeedback");
const fpsEl = document.getElementById("fps");

let gestureRecognizer = null;
let cameraRunning = false;
let stream = null;
let rafId = null;
let lastVideoTime = -1;
let frameCount = 0;
let fpsTimer = 0;

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function resizeCanvas() {
  const width = video.videoWidth || canvas.clientWidth;
  const height = video.videoHeight || canvas.clientHeight;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function formatScore(score) {
  return typeof score === "number" ? score.toFixed(3) : "—";
}

function formatCoord(value) {
  return typeof value === "number" ? value.toFixed(4) : "—";
}

function topCategory(categories) {
  if (!categories || categories.length === 0) {
    return null;
  }
  return categories[0];
}

function categoryName(categories) {
  const top = topCategory(categories);
  return top?.categoryName ?? top?.displayName ?? null;
}

/**
 * Finger-up heuristics from landmarks (not a MediaPipe built-in).
 * Non-thumb: tip is "up" if farther from wrist than PIP (works for most orientations).
 * Thumb: tip farther from index MCP than thumb IP (sideways extension).
 */
function analyzeFingers(landmarks) {
  if (!landmarks || landmarks.length < 21) {
    return {
      count: 0,
      fingers: FINGER_DEFS.map((f) => ({ name: f.name, up: false })),
    };
  }

  const wrist = landmarks[0];
  const indexMcp = landmarks[5];

  const fingers = FINGER_DEFS.map((finger) => {
    const tip = landmarks[finger.tip];
    const pip = landmarks[finger.pip];

    if (finger.name === "thumb") {
      const tipDist = Math.hypot(tip.x - indexMcp.x, tip.y - indexMcp.y);
      const ipDist = Math.hypot(pip.x - indexMcp.x, pip.y - indexMcp.y);
      return { name: finger.name, up: tipDist > ipDist * 1.05 };
    }

    const tipDist = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
    const pipDist = Math.hypot(pip.x - wrist.x, pip.y - wrist.y);
    return { name: finger.name, up: tipDist > pipDist * 1.08 };
  });

  return {
    count: fingers.filter((f) => f.up).length,
    fingers,
  };
}

/**
 * Palm open/closed: prefer MediaPipe Open_Palm / Closed_Fist when confident,
 * otherwise fall back to finger count.
 */
function palmState(gestureName, gestureScore, fingerCount) {
  if (gestureName === "Open_Palm" && (gestureScore ?? 0) >= 0.5) {
    return { label: "open", source: "gesture" };
  }
  if (gestureName === "Closed_Fist" && (gestureScore ?? 0) >= 0.5) {
    return { label: "closed", source: "gesture" };
  }
  if (fingerCount >= 4) {
    return { label: "open", source: "fingers" };
  }
  if (fingerCount <= 1) {
    return { label: "closed", source: "fingers" };
  }
  return { label: "partial", source: "fingers" };
}

function summarizeHand(index, results) {
  const handednessCats = results.handednesses?.[index] ?? [];
  const gestureCats = results.gestures?.[index] ?? [];
  const landmarks = results.landmarks?.[index] ?? [];
  const handLabel = categoryName(handednessCats) ?? "?";
  const handScore = topCategory(handednessCats)?.score;
  const gesture = topCategory(gestureCats);
  const gestureName = gesture?.categoryName ?? gesture?.displayName ?? "None";
  const gestureScore = gesture?.score;
  const fingerInfo = analyzeFingers(landmarks);
  const palm = palmState(gestureName, gestureScore, fingerInfo.count);

  return {
    index,
    handLabel,
    handScore,
    gestureName,
    gestureScore,
    fingerInfo,
    palm,
    landmarks,
  };
}

function categoryLine(categories) {
  if (!categories || categories.length === 0) {
    return "  (none)";
  }
  return categories
    .map(
      (c) =>
        `  ${c.categoryName ?? c.displayName ?? "?"}  score=${formatScore(c.score)}`
    )
    .join("\n");
}

function landmarksBlock(landmarks) {
  if (!landmarks || landmarks.length === 0) {
    return "  (none)";
  }
  return landmarks
    .map((lm, i) => {
      const name = LANDMARK_NAMES[i] ?? `lm_${i}`;
      return `  [${String(i).padStart(2, "0")}] ${name.padEnd(11)} x=${formatCoord(lm.x)} y=${formatCoord(lm.y)} z=${formatCoord(lm.z)}`;
    })
    .join("\n");
}

function formatResults(results, summaries) {
  const handCount = results.landmarks?.length ?? 0;
  if (handCount === 0) {
    return "hands: 0\n(no hands detected)";
  }

  const blocks = [];
  for (let i = 0; i < handCount; i++) {
    const summary = summaries[i];
    const handedness = results.handednesses?.[i] ?? [];
    const gestures = results.gestures?.[i] ?? [];
    const landmarks = results.landmarks?.[i] ?? [];
    const fingerLine = summary.fingerInfo.fingers
      .map((f) => `${f.name}:${f.up ? "up" : "down"}`)
      .join(" ");

    blocks.push(
      [
        `--- hand ${i} ---`,
        "handedness:",
        categoryLine(handedness),
        "gestures (MediaPipe built-in):",
        categoryLine(gestures),
        `derived: fingers_up=${summary.fingerInfo.count} palm=${summary.palm.label} (${summary.palm.source})`,
        `         ${fingerLine}`,
        "landmarks (normalized image coords):",
        landmarksBlock(landmarks),
      ].join("\n")
    );
  }

  return `hands: ${handCount}\nbuilt-in gestures: ${BUILTIN_GESTURES.join(", ")}\n\n${blocks.join("\n\n")}`;
}

function renderFeedback(summaries) {
  if (summaries.length === 0) {
    gestureFeedback.innerHTML =
      '<p class="feedback-empty">No hands detected</p>';
    return;
  }

  gestureFeedback.innerHTML = summaries
    .map((s) => {
      const fingerBits = s.fingerInfo.fingers
        .map(
          (f) =>
            `<span class="finger-bit${f.up ? " up" : ""}">${f.name}${f.up ? " ↑" : ""}</span>`
        )
        .join("");

      return `
        <article class="hand-card">
          <p class="hand-card-title">Hand ${s.index} · ${s.handLabel} (${formatScore(s.handScore)})</p>
          <p class="gesture-name">${s.gestureName}</p>
          <p class="gesture-score">MediaPipe gesture · score ${formatScore(s.gestureScore)}</p>
          <div class="metric-row">
            <div class="metric">
              <span class="metric-label">Palm</span>
              <span class="metric-value">${s.palm.label}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Fingers up</span>
              <span class="metric-value">${s.fingerInfo.count} / 5</span>
            </div>
          </div>
          <div class="finger-bits">${fingerBits}</div>
        </article>
      `;
    })
    .join("");
}

function drawHandLabel(summary) {
  const landmarks = summary.landmarks;
  if (!landmarks || landmarks.length === 0) {
    return;
  }

  const wrist = landmarks[0];
  const x = wrist.x * canvas.width;
  const y = wrist.y * canvas.height;
  const lines = [
    summary.gestureName,
    `palm ${summary.palm.label} · ${summary.fingerInfo.count} fingers`,
  ];

  ctx.save();
  // Undo CSS mirror so text stays readable in the mirrored stage.
  ctx.scale(-1, 1);
  ctx.translate(-canvas.width, 0);

  const textX = canvas.width - x;
  ctx.font = "600 16px ui-monospace, Menlo, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";

  let textY = y - 12;
  for (const line of lines) {
    const width = ctx.measureText(line).width;
    ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
    ctx.fillRect(textX - 4, textY - 16, width + 8, 20);
    ctx.fillStyle = "#e8e8e8";
    ctx.fillText(line, textX, textY);
    textY += 22;
  }
  ctx.restore();
}

function drawResults(results, summaries) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!results.landmarks || results.landmarks.length === 0) {
    return;
  }

  const drawingUtils = new DrawingUtils(ctx);
  for (const landmarks of results.landmarks) {
    drawingUtils.drawConnectors(
      landmarks,
      GestureRecognizer.HAND_CONNECTIONS,
      { color: "#4a9eff", lineWidth: 3 }
    );
    drawingUtils.drawLandmarks(landmarks, {
      color: "#e8e8e8",
      fillColor: "#4a9eff",
      radius: 4,
    });
  }

  for (const summary of summaries) {
    drawHandLabel(summary);
  }
}

function updateFps(now) {
  frameCount += 1;
  if (!fpsTimer) {
    fpsTimer = now;
  }
  const elapsed = now - fpsTimer;
  if (elapsed >= 1000) {
    const fps = Math.round((frameCount * 1000) / elapsed);
    fpsEl.textContent = `FPS: ${fps}`;
    frameCount = 0;
    fpsTimer = now;
  }
}

function predictLoop() {
  if (!cameraRunning) {
    return;
  }

  rafId = requestAnimationFrame(predictLoop);

  if (video.readyState < 2) {
    return;
  }

  resizeCanvas();

  if (video.currentTime === lastVideoTime) {
    return;
  }
  lastVideoTime = video.currentTime;

  const now = performance.now();
  const results = gestureRecognizer.recognizeForVideo(video, now);
  const handCount = results.landmarks?.length ?? 0;
  const summaries = [];
  for (let i = 0; i < handCount; i++) {
    summaries.push(summarizeHand(i, results));
  }

  drawResults(results, summaries);
  renderFeedback(summaries);
  signalDump.textContent = formatResults(results, summaries);
  updateFps(now);
}

async function startCamera() {
  stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "user",
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  cameraRunning = true;
  lastVideoTime = -1;
  frameCount = 0;
  fpsTimer = 0;
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
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  gestureFeedback.innerHTML =
    '<p class="feedback-empty">Camera stopped.</p>';
  signalDump.textContent = "Camera stopped.";
  fpsEl.textContent = "FPS: —";
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
    signalDump.textContent = String(err);
    gestureFeedback.innerHTML = `<p class="feedback-empty">${String(err)}</p>`;
  } finally {
    toggleBtn.disabled = false;
  }
}

async function init() {
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        "getUserMedia is unavailable. Serve this page over http://localhost (not file://)."
      );
    }

    setStatus("Loading MediaPipe model…");
    const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
    gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numHands: 2,
    });

    setStatus("Model ready — start the camera");
    toggleBtn.disabled = false;
    toggleBtn.addEventListener("click", toggleCamera);
  } catch (err) {
    console.error(err);
    setStatus(`Init failed: ${err.message ?? err}`, true);
    signalDump.textContent = String(err);
    gestureFeedback.innerHTML = `<p class="feedback-empty">${String(err)}</p>`;
  }
}

init();
