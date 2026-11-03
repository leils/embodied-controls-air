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
export const INDEX_TIP = 8;
const PINKY_MCP = 17;
export const HOLD_FRAMES = 6;
const PINCH_RATIO = 0.6;
const FRAME_MARGIN = 0.1;

const FINGERS = [
  { name: "index", tip: 8, pip: 6 },
  { name: "middle", tip: 12, pip: 10 },
  { name: "ring", tip: 16, pip: 14 },
  { name: "pinky", tip: 20, pip: 18 },
];

const video = document.getElementById("webcam");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");

export async function createRecognizer() {
  const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
  return GestureRecognizer.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
    runningMode: "VIDEO",
    numHands: 2,
  });
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

export function landmarkDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function isPinching(landmarks) {
  const gap = landmarkDistance(landmarks[THUMB_TIP], landmarks[INDEX_TIP]);
  const palm = landmarkDistance(landmarks[INDEX_MCP], landmarks[PINKY_MCP]);
  return palm > 0 && gap / palm < PINCH_RATIO;
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

export function assignHands(hands) {
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

export function isClosedFist(hand) {
  return hand.gestureName === "Closed_Fist" && hand.gestureScore >= 0.5;
}

export function bothFists(hands) {
  return hands.length >= 2 && hands.every(isClosedFist);
}

export function readHands(recognizer, videoEl) {
  const results = recognizer.recognizeForVideo(videoEl, performance.now());
  const hands = (results.landmarks ?? []).map((_, index) => summarizeHand(index, results));
  return { results, hands };
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

export function drawHands(results, hands, pinch) {
  resizeCanvas();
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
  if (!pinch || hands.length < 2) {
    return;
  }
  const a = hands[0].landmarks[INDEX_TIP];
  const b = hands[1].landmarks[INDEX_TIP];
  ctx.beginPath();
  ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
  ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
  ctx.strokeStyle = pinch.active ? "#4a9eff" : "#9a9a9a";
  ctx.lineWidth = 2;
  ctx.stroke();
}

export function clearOverlay() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}
