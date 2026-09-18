# Step 3 — Edit

```bash
node scripts/edit.mjs promo-output/promo.json --out-dir promo-output
```

Reads the captured clips, trims each so its boundary lands on a beat, joins them with cross-fades,
lays the music under, and encodes one H.264 file.

## How the beat grid is used

`beats.mjs` returns a uniform grid — a tempo and a phase — not a list of detected peaks. The grid is
the signal; individual peaks are noisy, and on real tracks only a third to three quarters of them
agree with the true tempo.

Each clip's end is moved to the **nearest** grid line, and clips are only ever **shortened**.
Stretching to reach the next beat would either freeze a frame or slow the footage, and gameplay
running 8% slow looks like the game has a performance problem.

Below `confidence` **1.25** the grid is discarded and the cuts fall where they fall. Say this out
loud when it happens; do not let a user wonder why the edit feels loose.

## The filter graph

- `xfade`, not `concat`. A hard cut between two shots of the same starfield reads as a dropped
  frame rather than an edit.
- 0.4s cross-fade — long enough to register, short enough not to hide the cut.
- Fade up from black over 0.6s, down over 0.8s. The opening fade is what makes a motionless first
  shot read as deliberate rather than as a paused video.
- Music trimmed to the video with a 1.5s tail fade, so it resolves instead of stopping mid-phrase.

## Output

`-c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p -movflags +faststart`

`yuv420p` is not optional: without it, players that decode 4:4:4 will not, and the video is black on
exactly the devices you did not test. `+faststart` puts the index first so it streams rather than
downloading fully before playing.

## Gate

The finished file has the expected duration, and is not black. Check both — do not assume:

```bash
ffprobe -v error -show_entries format=duration,size -of default=nw=1 promo-output/promo.mp4
ffmpeg -v info -i promo-output/promo.mp4 \
  -vf "fps=2,signalstats,metadata=print:key=lavfi.signalstats.YAVG" -f null - 2>&1 | grep -c YAVG
```

A contact sheet is the fastest way to see the whole arc at once:

```bash
ffmpeg -v error -i promo-output/promo.mp4 \
  -vf "select='not(mod(n\,90))',scale=210:-1,tile=5x2" -frames:v 1 promo-output/contact.png
```
