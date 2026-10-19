# Web MIDI controller

Tiny static page that sends MIDI Control Change messages from two sliders.

| Slider | MIDI channel | CC |
| --- | --- | --- |
| Channel 1 | 1 | 1 (modulation) |
| Channel 2 | 2 | 1 (modulation) |

Values are 0–127. No app server. The browser talks to a MIDI output directly.

## Run locally

Web MIDI needs `http://localhost` or HTTPS (not `file://`), and a browser that implements it (Chrome or Edge).

```bash
cd webmidi_demo
python3 -m http.server 8080
```

Open [http://localhost:8080](http://localhost:8080) in Chrome or Edge.

To see the output without a MIDI device or monitor, loop it through the built-in IAC Driver:

1. Open **Audio MIDI Setup** (in `/Applications/Utilities`).
2. **Window → Show MIDI Studio**, double-click **IAC Driver**, and check **Device is online**.
3. On the page, click **Connect MIDI**. The output list should select **IAC Driver Bus 1**.
4. Move a slider. **Last sent** is what the page transmitted. **Incoming** is the same message arriving back through IAC.

## Files

- `index.html` — layout
- `styles.css` — minimal styling
- `app.js` — Web MIDI access and CC sends
