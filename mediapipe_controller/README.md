# MediaPipe controller

Webcam controller with three modes, picked from the **Mode** dropdown. Channel names are editable. When a MIDI output is connected, each value change sends Control Change 1. Individual channels use MIDI channels 1–4, Pinch uses 5–6, and Bank channels use 9–16, so no two modes share outputs. Sent messages are listed in the MIDI log.

**Settings** opens a panel from the right. It shows the settings for the current mode and the gesture tester. Press Escape or **Close** to dismiss it.

## Individual channels

Hands are assigned by side of the mirrored preview. Your left hand appears on the left.

| Hand | Gesture | Result |
| --- | --- | --- |
| Left | 1, 2, 3, or 4 fingers up | Select that channel. The others clear. |
| Left | Closed fist | Clear every channel. |
| Left | Open palm, or hand leaves the frame | Keep the current selection. |
| Right | Index fingertip motion | Nudge the selected channel from its current value. Raise the finger to increase, lower to decrease, hold still to leave it alone. Absolute height is ignored, so selecting a channel does not jump the slider. |
| Right | Closed fist, thumbs up, or thumbs down | Freeze the value. Tracking resumes a few frames after the hand opens, so uncurling the fingers does not raise it. |

**Settings** (in the Settings panel, shared with Bank channels):

| Setting | Meaning |
| --- | --- |
| Strength | How many steps the value moves per 1.0 of frame height traveled |
| Min / Max | Clamp for every channel (0–127) |
| Deadzone | How much index motion is ignored before the value changes |

**Pinch clutch** (in the Settings panel) is off by default. When it is on, the right index finger updates the slider only while that hand is pinching thumb to index. Releasing the pinch holds the value and resets the motion baseline.

Finger count uses the index, middle, ring, and pinky. The thumb is ignored. A pose must hold for a few frames before the selection changes. Slider values stay where they are when a channel is deselected.

## Bank channels

Two banks of four channels. Bank 1 sends on MIDI 9–12, Bank 2 on MIDI 13–16. Both banks are shown. The active bank is outlined, and the other bank is dimmed.

**Playing.** Works like Individual channels inside the active bank: left hand fingers pick channel 1–4, a left fist clears, right index motion moves the value. Strength, Min, Max, Deadzone, and Pinch clutch are the same settings Individual channels uses.

**Choosing a bank.** Give a thumbs up with both hands at once to enter bank choice. The pose holds for a few frames, and holding it does not toggle again until either thumb drops. The selected channel clears, the right hand stops changing values, and both banks turn a muted blue while waiting for a choice. Raise 1 or 2 fingers on the left hand to pick a bank. The picked bank turns bright blue with a dashed outline. Both thumbs up again locks into it. Locking without picking keeps the current bank. After locking, no channel is selected and every value stays where it was.

## Pinch

One slider. It moves only while both hands pinch thumb to index.

The grab starts at the current value. Moving the index fingers farther apart raises it, and moving them closer lowers it. Vertical position does not matter. **Strength** is how many slider steps you get per 1.0 of frame distance (index tips at opposite edges of the frame are about 1.0 apart). Releasing either pinch holds the value.

**Strength** and **Two channels** are in the Settings panel. **Two channels** is on by default: two channel checkboxes and sliders instead of the single slider. Uncheck it to use one slider.

| Gesture | Result |
| --- | --- |
| Left hand, 1 or 2 fingers up | Select that channel and stick to it. |
| Both hands closed into fists | Clear the selected channel. Slider values stay put. |
| Both hands pinching | Move the selected channel by the index-finger distance, using the same strength. |

## Gesture tester

Lives in the Settings panel. Check **Run tester** to start it. While it runs, hand input goes to the tester instead of the current mode, so no MIDI is sent. Closing the Settings panel stops the tester. It keeps a log of completed gestures. The line under the video shows the live pose: both fists, both open, palms together, a thumb on either hand, or need both hands.

**Closed twice.** Both hands close into fists, both open, then both close into fists again. The second close has to finish within 1 second of the first. Each step holds for a few frames. A hand leaving the frame starts the sequence over. Holding the second fist does not log again until both hands open.

**Palms together.** Both palms flat against each other, like prayer or a clap that stays closed. It logs once, then waits until the hands separate.

**Thumbs up / Thumbs down.** Either hand, using MediaPipe's built-in `Thumb_Up` and `Thumb_Down` gestures. Each hand logs separately, for example `Thumbs up (left)`. The pose holds for a few frames before it logs, and holding it does not log again. Drop the thumb or switch direction to log the next one.

## Run locally

```bash
cd mediapipe_controller
python3 -m http.server 8080
```

Open [http://localhost:8080](http://localhost:8080) and start the camera. Use Chrome or Edge. `file://` will not get camera access.
