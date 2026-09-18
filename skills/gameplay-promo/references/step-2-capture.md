# Step 2 — Capture

```bash
node scripts/film.mjs promo-output/promo.json --out-dir promo-output
```

Runs each shot in order, writing `promo-output/clips/<name>.avi`, and checks every one before the
next begins. The engine's own output is passed straight through, so its errors arrive as they
happen rather than as "capture failed" after the fact.

## What is checked, and why each check exists

| Check                          | Catches                                                                 |
| ------------------------------ | ----------------------------------------------------------------------- |
| Resolution ≥ 640×360           | a window that opened at its default size instead of the one asked for   |
| Duration ≥ half what was asked | a run that quit early — a crash, or a `--quit-after` the engine ignored |
| Middle frame not black         | **the one that matters**: a capture that produced a file but never drew |

The black check samples the **middle**, never frame zero. Games legitimately open on black — a fade,
a splash, an empty sky — so judging the first frame rejects good footage while passing a clip that
dies after its opening shot.

A silent black capture is the failure mode worth all this machinery. The file exists, has the right
duration, plays, and is empty. Without this check it survives the edit, the encode and the upload,
and is found by a human watching the finished video.

## When a shot fails

Read the engine's output above the error first — it usually says exactly what happened.

| Symptom                | Usually                                                              |
| ---------------------- | -------------------------------------------------------------------- |
| Black middle frame     | the scene errored on load, or a headless flag disabled rendering     |
| Far shorter than asked | the engine ignored the frame count, or the run ended on its own      |
| No file at all         | the command did not substitute `{{out}}`, so it wrote somewhere else |

A movie writer generally needs a **real window**. Adding a headless flag to make capture quieter
produces exactly the silent black file this step exists to catch.

## Interactive takes

A shot with `"interactive": true` is played by the user. The script explains what will happen, waits
for Enter, then launches and records until they quit.

Three things to tell them before it starts, because all three surprise people:

1. **Recording begins the moment the window opens.** There is no countdown.
2. **The game will feel slow** — 64% of real time on a 1080p Godot project, because every frame is
   encoded as it is drawn. The finished video is correct-speed; only playing it feels sluggish.
3. **Quitting the game ends the take.** Closing the window is the stop button.

The duration check changes for these: there is no target to fall short of, only a floor of 4s that
catches a window closed before anything happened. Everything else is checked as normal.

Expect to re-take. It costs one command, and a good 20 seconds of play is worth more to the finished
video than anything the edit can do afterwards.

## Capture is slow, and that is fine

Rendering is not real time — it is usually slower, because every frame is encoded. Forty-six seconds
of gameplay takes about a minute. Say so before starting a long capture rather than appearing hung.

Clips are kept. The edit reads them from disk, so iterating on the cut costs nothing — only a
changed shot needs re-capturing.

## Gate

Every clip reports `ok` with a plausible resolution, duration and luma.
