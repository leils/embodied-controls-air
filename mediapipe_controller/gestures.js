import { HOLD_FRAMES, assignHands, bothFists, isClosedFist, landmarkDistance } from "./vision.js";

const INDEX_MCP = 5;
const PINKY_MCP = 17;
const SEQUENCE_MS = 1000;
const LOG_LIMIT = 40;
const APART_FACTOR = 1.6;
const THUMB_GESTURES = { Thumb_Up: "Thumbs up", Thumb_Down: "Thumbs down" };
const THUMB_SCORE = 0.5;

const readoutEl = document.getElementById("readout");
const gestureLogEl = document.getElementById("gestureLog");

const log = [];
let closePhase = "idle";
let closeFrames = 0;
let firstCloseAt = 0;
let palmFrames = 0;
let palmsLatched = false;
let thumbs = freshThumbs();

function freshThumbs() {
  return {
    left: { name: null, frames: 0, latched: null },
    right: { name: null, frames: 0, latched: null },
  };
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: (a.z ?? 0) - (b.z ?? 0) };
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function normalize(v) {
  const length = Math.hypot(v.x, v.y, v.z);
  if (length < 1e-6) {
    return null;
  }
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

function palmNormal(landmarks) {
  const wrist = landmarks[0];
  const index = landmarks[INDEX_MCP];
  const pinky = landmarks[PINKY_MCP];
  return cross(subtract(index, wrist), subtract(pinky, wrist));
}

function palmCenter(landmarks) {
  const wrist = landmarks[0];
  const index = landmarks[INDEX_MCP];
  const pinky = landmarks[PINKY_MCP];
  return {
    x: (wrist.x + index.x + pinky.x) / 3,
    y: (wrist.y + index.y + pinky.y) / 3,
    z: ((wrist.z ?? 0) + (index.z ?? 0) + (pinky.z ?? 0)) / 3,
  };
}

function palmSpan(hands) {
  const a = hands[0].landmarks;
  const b = hands[1].landmarks;
  const widthA = landmarkDistance(a[INDEX_MCP], a[PINKY_MCP]);
  const widthB = landmarkDistance(b[INDEX_MCP], b[PINKY_MCP]);
  const span = (widthA + widthB) / 2;
  if (span <= 0) {
    return null;
  }
  const centerA = palmCenter(a);
  const centerB = palmCenter(b);
  return {
    span,
    gap: Math.hypot(centerA.x - centerB.x, centerA.y - centerB.y),
    centerA,
    centerB,
    landmarksA: a,
    landmarksB: b,
  };
}

// Absolute dot product: a left hand's landmark order mirrors the right, so the
// normal may point out of the palm or out of the back. Either way, a large
// component along the gap means the palm is turned toward the other hand.
function facesOtherPalm(landmarks, towardOther) {
  const normal = normalize(palmNormal(landmarks));
  if (!normal || !towardOther) {
    return false;
  }
  const across = Math.abs(dot(normal, towardOther));
  const towardCamera = Math.abs(normal.z);
  return across > towardCamera && across > 0.4;
}

function palmsFaceEachOther(metrics) {
  const towardB = normalize(subtract(metrics.centerB, metrics.centerA));
  if (!towardB) {
    return false;
  }
  const towardA = { x: -towardB.x, y: -towardB.y, z: -towardB.z };
  return facesOtherPalm(metrics.landmarksA, towardB) && facesOtherPalm(metrics.landmarksB, towardA);
}

function palmsTogether(hands) {
  if (hands.length < 2 || hands.some(isClosedFist)) {
    return false;
  }
  const metrics = palmSpan(hands);
  if (!metrics || metrics.gap > metrics.span) {
    return false;
  }
  return palmsFaceEachOther(metrics);
}

function palmsApart(hands) {
  if (hands.length < 2 || hands.some(isClosedFist)) {
    return true;
  }
  const metrics = palmSpan(hands);
  if (!metrics) {
    return true;
  }
  return metrics.gap > metrics.span * APART_FACTOR;
}

function bothOpen(hands) {
  return hands.length >= 2 && hands.every((hand) => !isClosedFist(hand));
}

function logGesture(name) {
  const time = new Date().toLocaleTimeString("en-GB", { hour12: false });
  log.unshift(`${time}  ${name}`);
  if (log.length > LOG_LIMIT) {
    log.length = LOG_LIMIT;
  }
  gestureLogEl.textContent = log.join("\n");
}

function stepClose(hands, together, now) {
  if (hands.length < 2) {
    closePhase = "idle";
    closeFrames = 0;
    return;
  }

  if (closePhase === "latched") {
    if (bothOpen(hands) && !together) {
      closePhase = "idle";
      closeFrames = 0;
    }
    return;
  }

  if (closePhase !== "idle" && now - firstCloseAt > SEQUENCE_MS) {
    closePhase = "idle";
    closeFrames = 0;
  }

  const waitingForFists = closePhase !== "fists";
  const matched = waitingForFists ? bothFists(hands) : bothOpen(hands) && !together;
  if (!matched) {
    closeFrames = 0;
    return;
  }
  closeFrames += 1;
  if (closeFrames < HOLD_FRAMES) {
    return;
  }

  closeFrames = 0;
  if (closePhase === "fists") {
    closePhase = "open";
    return;
  }
  if (closePhase === "open" && now - firstCloseAt <= SEQUENCE_MS) {
    logGesture("Closed twice");
    closePhase = "latched";
    return;
  }
  closePhase = "fists";
  firstCloseAt = now;
}

function stepPalms(hands, together) {
  if (together) {
    if (!palmsLatched) {
      palmFrames += 1;
      if (palmFrames >= HOLD_FRAMES) {
        logGesture("Palms together");
        palmsLatched = true;
      }
    }
    return;
  }
  palmFrames = 0;
  if (palmsApart(hands)) {
    palmsLatched = false;
  }
}

function thumbGesture(hand) {
  if (!hand || hand.gestureScore < THUMB_SCORE || !THUMB_GESTURES[hand.gestureName]) {
    return null;
  }
  return hand.gestureName;
}

// The latch only changes after a pose (including "no thumb") holds for
// HOLD_FRAMES, so a one-frame recognizer flicker does not log twice.
function stepThumbs(hands) {
  const sides = assignHands(hands);
  for (const side of ["left", "right"]) {
    const state = thumbs[side];
    const name = thumbGesture(sides[side]);
    if (name !== state.name) {
      state.name = name;
      state.frames = 0;
    }
    state.frames += 1;
    if (state.frames < HOLD_FRAMES || state.latched === name) {
      continue;
    }
    state.latched = name;
    if (name) {
      logGesture(`${THUMB_GESTURES[name]} (${side})`);
    }
  }
}

function sideLabel(hand) {
  if (!hand) {
    return "—";
  }
  const thumb = thumbGesture(hand);
  if (thumb) {
    return THUMB_GESTURES[thumb].toLowerCase();
  }
  return isClosedFist(hand) ? "fist" : "open";
}

function poseLabel(hands, together) {
  const { left, right } = assignHands(hands);
  if (thumbGesture(left) || thumbGesture(right)) {
    return `Left: ${sideLabel(left)} · Right: ${sideLabel(right)}`;
  }
  if (hands.length < 2) {
    return "need both hands";
  }
  if (bothFists(hands)) {
    return "both fists";
  }
  if (together) {
    return "palms together";
  }
  if (bothOpen(hands)) {
    return "both open";
  }
  return `Left: ${sideLabel(left)} · Right: ${sideLabel(right)}`;
}

export function reset() {
  closePhase = "idle";
  closeFrames = 0;
  firstCloseAt = 0;
  palmFrames = 0;
  palmsLatched = false;
  thumbs = freshThumbs();
}

export function updateGestures(hands) {
  const now = performance.now();
  const together = palmsTogether(hands);
  stepClose(hands, together, now);
  stepPalms(hands, together);
  stepThumbs(hands);
  readoutEl.textContent = poseLabel(hands, together);
}
