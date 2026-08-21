# MediaPipe webcam signals

Bare-bones browser demo: webcam → MediaPipe Gesture Recognizer → live landmark overlay + signal dump. Gestures and hand positions are **display-only** (no controls wired yet).

Runs entirely in the browser. No app backend. Models and WASM load from a CDN.

## Run locally

Browsers block webcam (and often WASM) on `file://`. Serve this folder over localhost:

```bash
cd mediapipe_demo
python3 -m http.server 8080
```

Open [http://localhost:8080](http://localhost:8080), allow camera access, click **Start camera**.

Requires a modern Chromium/Firefox/Safari build with WebGL (GPU delegate) and `getUserMedia`.

## Stack

| Piece | Choice |
| --- | --- |
| UI | Plain HTML / CSS / JS |
| Library | `@mediapipe/tasks-vision@0.10.18` (jsDelivr) |
| Task | Gesture Recognizer (`VIDEO` mode, up to 2 hands) |
| Camera | `navigator.mediaDevices.getUserMedia` |

## What you see

- Mirrored webcam with hand skeleton overlay (21 landmarks + connections)
- Per-hand labels on the video: gesture name, palm state, finger count
- **Live feedback** cards: MediaPipe gesture + score, palm open/closed/partial, fingers up (per digit)
- Collapsible raw landmark dump
- Status line and approximate FPS

## Built-in MediaPipe gestures

Gesture Recognizer ships these canned labels (plus confidence scores):

`None`, `Closed_Fist`, `Open_Palm`, `Pointing_Up`, `Thumb_Down`, `Thumb_Up`, `Victory`, `ILoveYou`

**Not built-in:** finger count. The demo derives “fingers up” from landmark geometry. Palm open/closed prefers `Open_Palm` / `Closed_Fist` when score ≥ 0.5, otherwise falls back to finger count.

## Signal fields

For each detected hand:

| Field | Meaning |
| --- | --- |
| `handedness` | `Left` or `Right`, with confidence `score` |
| `gestures` | Built-in gesture name + `score` (see list above) |
| `derived` | `fingers_up`, `palm` (`open` / `closed` / `partial`), and per-finger up/down |
| `landmarks` | 21 points with normalized image coords: `x`/`y` in `[0, 1]`; `z` is depth relative to the wrist |

Landmark index names (0–20): wrist, thumb (cmc→tip), index/middle/ring/pinky (mcp→tip).

## Files

- `index.html` — layout
- `styles.css` — minimal styling
- `app.js` — camera loop, recognition, draw + dump

## Notes

- First load downloads WASM + the gesture model; later loads are usually cached.
- If GPU init fails on your machine, change `delegate: "GPU"` to `"CPU"` in `app.js`.
- Opening via `file://` will typically fail camera permission — use the local HTTP server above.
