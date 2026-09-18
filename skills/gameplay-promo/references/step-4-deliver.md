# Step 4 — Deliver

## Poster frame

Pull it from a moment that shows the game, not the fade:

```bash
ffmpeg -v error -ss <seconds> -i promo-output/promo.mp4 -frames:v 1 -q:v 2 promo-output/poster.jpg
```

Pick the timestamp deliberately — the character mid-action, or the busiest gameplay frame. The
first frame is almost always black, and every platform that regenerates its own thumbnail will pick
something worse than you would.

## Where it actually goes

**Google Play takes a YouTube URL, not a file.** The store listing field is a link; the MP4 is
uploaded to YouTube first and the listing points at it. Tell the user this before they go looking
for an upload button.

|                 | Wants                                                           |
| --------------- | --------------------------------------------------------------- |
| Google Play     | YouTube URL. Landscape, no age restriction on the video, no ads |
| App Store       | an uploaded file, 15–30s, portrait or landscape per device      |
| itch.io / Steam | a file or a YouTube link                                        |

For YouTube: 1920×1080 H.264 + AAC is exactly right, which is what step 3 produced.

## Report

Say what was made, in numbers the user can check:

- duration, resolution, file size
- which track, its tempo, and whether the cuts were beat-locked
- where each shot came from, and how much was skipped

If anything was not verified, say which. "I could not check how it sounds" is useful; silence is not.

## Re-cutting

The clips stay in `promo-output/clips/`. Changing the music, the order, the trim or the fade only
re-runs step 3 — seconds, not minutes. Only a changed shot needs re-capturing.
