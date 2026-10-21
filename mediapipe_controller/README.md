# MediaPipe controller

Webcam controller with two modes. Channel names are editable. When a MIDI output is connected, each value change sends Control Change 1. Individual channels use MIDI channels 1–4. Pinch uses MIDI channels 5–6, so the two modes do not share outputs. Sent messages are listed in the MIDI log.

## Individual channels

Hands are assigned by side of the mirrored preview. Your left hand appears on the left.

| Hand | Gesture | Result |
| --- | --- | --- |
| Left | 1, 2, 3, or 4 fingers up | Select that channel. The others clear. |
| Left | Closed fist | Clear every channel. |
| Left | Open palm, or hand leaves the frame | Keep the current selection. |
| Right | Index fingertip height | Set the selected channel from 0 to 127 inside the on-screen box. The box sits 10% in from each edge of the video, so the ends are not the frame edges. |

**Pinch clutch** is off by default. When it is on, the right index finger updates the slider only while that hand is pinching thumb to index. Releasing the pinch holds the value.

Finger count uses the index, middle, ring, and pinky. The thumb is ignored. A pose must hold for a few frames before the selection changes. Slider values stay where they are when a channel is deselected.

## Pinch

One slider. It moves only while both hands pinch thumb to index.

The grab starts at the current value. Moving the index fingers farther apart raises it, and moving them closer lowers it. Vertical position does not matter. **Strength** is how many slider steps you get per 1.0 of frame distance (index tips at opposite edges of the frame are about 1.0 apart). Releasing either pinch holds the value.

**Two channels** is on by default: two channel checkboxes and sliders instead of the single slider. Uncheck it to use one slider.

| Gesture | Result |
| --- | --- |
| Left hand, 1 or 2 fingers up | Select that channel and stick to it. |
| Both hands closed into fists | Clear the selected channel. Slider values stay put. |
| Both hands pinching | Move the selected channel by the index-finger distance, using the same strength. |

## Run locally

```bash
cd mediapipe_controller
python3 -m http.server 8080
```

Open [http://localhost:8080](http://localhost:8080) and start the camera. Use Chrome or Edge. `file://` will not get camera access.
