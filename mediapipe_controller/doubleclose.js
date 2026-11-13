import { HOLD_FRAMES, bothFists, bothOpen } from "./vision.js";

const SEQUENCE_MS = 1000;

/**
 * Both fists, both open, both fists again. The second close has to be confirmed
 * within SEQUENCE_MS of the first. After firing, it waits for both hands to
 * open before a new sequence can start, so a held fist fires only once.
 */
export function createDoubleClose() {
  let phase = "idle";
  let frames = 0;
  let firstCloseAt = 0;

  function reset() {
    phase = "idle";
    frames = 0;
    firstCloseAt = 0;
  }

  function step(hands, now, isOpen = bothOpen) {
    if (hands.length < 2) {
      phase = "idle";
      frames = 0;
      return false;
    }

    if (phase === "latched") {
      if (isOpen(hands)) {
        phase = "idle";
        frames = 0;
      }
      return false;
    }

    if (phase !== "idle" && now - firstCloseAt > SEQUENCE_MS) {
      phase = "idle";
      frames = 0;
    }

    const matched = phase === "fists" ? isOpen(hands) : bothFists(hands);
    if (!matched) {
      frames = 0;
      return false;
    }
    frames += 1;
    if (frames < HOLD_FRAMES) {
      return false;
    }

    frames = 0;
    if (phase === "fists") {
      phase = "open";
      return false;
    }
    if (phase === "open") {
      phase = "latched";
      return true;
    }
    phase = "fists";
    firstCloseAt = now;
    return false;
  }

  return { step, reset };
}
