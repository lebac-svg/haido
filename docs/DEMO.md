# Recording the live-map demo (`docs/assets/live-map.gif`)

A ~30-second capture that shows the whole value proposition without a word of
narration. Referenced from README ("See it live").

## Setup

- Any repo with a `.haido` workspace (this repo itself works — dogfood on camera).
- Two windows side by side: a Claude Code session (left), the live map (right):

```bash
haido viz --live --open
```

- Map settings: 2D view, ⬥ notes on. Zoom so the whole repo fits with labels readable.

## Shot list (~30s)

1. **0–5s** — the map at rest: colored territories, diamonds tethered to files.
2. **5–15s** — ask Claude to add a small feature. As it edits, files glow white
   and cool down; the viewer's eye follows the activity across the map.
3. **15–22s** — Claude creates a new file → a node blooms in with a ripple.
4. **22–28s** — Claude edits a function that has an anchored note → the diamond
   flashes **yellow** (drift) the moment the save lands. This is the money shot:
   knowledge noticing it went stale, in real time.
5. **28–30s** — hover the yellow diamond: the note + why appears. Cut.

## Capture notes

- 16:9, ≥1280px wide; system dark theme (page is dark, `#0d0d0d`).
- GIF ≤ 8 MB for the README (or record .mp4 and convert:
  `ffmpeg -i demo.mp4 -vf "fps=12,scale=960:-1" docs/assets/live-map.gif`).
- Update the README: replace the `TODO(record)` comment with
  `![haido live map](docs/assets/live-map.gif)`.
