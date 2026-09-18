<p align="center">
  <img src="assets/logo.png" alt="gameplay-promo" width="120">
</p>

<h1 align="center">gameplay-promo</h1>

<p align="center">
  A Claude Code skill that films a game you already have and cuts it into a promo video —
  a cinematic opener, real gameplay, and a closing card, scored to music with the cuts on the beat.
</p>

## What it produced

[![The Last Space Voyager — promo video](assets/example-poster.jpg)](https://www.youtube.com/watch?v=TidWI8QBDq0)

**[The Last Space Voyager — promo video](https://www.youtube.com/watch?v=TidWI8QBDq0)** (32s). Every
frame came out of the running game: the opener is a scene the skill added to the project, the
gameplay is one three-minute take played by a human and sampled into four windows, and the track was
already in the repo.

## Install

```bash
/plugin marketplace add mkolew/gameplay-promo
/plugin install gameplay-promo
```

Then `/gameplay-promo`, or just ask for a trailer or a gameplay video.

## What it makes

1. **A staged opener**, up to 10 seconds — the main character alone, drawn far larger than it ever
   is in play, doing one thing that ends in motion. Rendered by the game itself, so it cannot look
   like a different product.
2. **Gameplay**, sampled out of **one long played take**. You play for two or three minutes; it cuts
   four six-second windows spread across the session, so the film shows the game getting harder
   rather than one slice of one difficulty.
3. **A closing card** — the title screen or logo, which usually needs no new code at all.
4. **One music track**, chosen by you from what is already in the project, playing from its first
   second to the last frame.

Segments join with a dip through black — the standard way to say "later, same game" without a
caption. Cuts land on the beat when the track has one.

Nothing is recreated in HTML, and there is no stock footage. A promo that shows something the player
will not see is worse than no promo, because the first review says so.

## What it needs

`ffmpeg` and `ffprobe` on PATH, and Node 18+. Nothing else: no Python, no beat-detection library, no
video framework. Tempo is found with ffmpeg's own audio filters.

## What it may change in your game

Most projects cannot yet film themselves. The skill checks, proposes, and **waits for you**:

|                      |                                                                              |
| -------------------- | ---------------------------------------------------------------------------- |
| A way to write video | without it there is no promo                                                 |
| A film mode          | hides control chrome — key legends, touch pads, pause and fullscreen buttons |
| An opener scene      | optional; there is a fallback that uses your title screen instead            |

Those are changes to your game, and the skill will not make them uninvited. Everything it adds
defaults to off — a flag that is false unless passed, a scene nothing loads — so a player's build
behaves identically, and the lot reverts in one commit.

[`references/engine-recipes.md`](skills/gameplay-promo/references/engine-recipes.md) has the
concrete how, per engine. **Godot 4 is the only one verified**; Unity, Unreal and web/canvas are
written from documented features and say so.

## Scripts

|                          |                                                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `scripts/find-music.mjs` | lists the audio already in a project, longest first, with tempo. Collapses the copies game repos keep in each engine's tree |
| `scripts/film.mjs`       | runs each shot command and verifies what came back — resolution, duration, and whether the middle frame is black            |
| `scripts/beats.mjs`      | tempo and beat grid, using ffmpeg alone                                                                                     |
| `scripts/edit.mjs`       | samples the windows, joins them, lays the music under, encodes                                                              |

```bash
node --test skills/gameplay-promo/scripts/beats.test.mjs
```

The beat detector is tested against synthetic click tracks at known tempos, because "does 140 BPM
sound right for this song" is not an assertion.

## Notes worth knowing

- **Recording runs below real time.** Every frame is encoded as it is drawn — measured at 64% on a
  1080p Godot project. The written file is correct-speed regardless; only playing it feels slow.
- **An unknown flag is ignored silently.** A film mode that was never implemented produces a clean
  capture full of chrome and exit code 0, so the skill verifies the flag exists and looks at a frame.
- **The game's own captured audio is never the soundtrack.** Engines often record it, and it is
  tempting because it is free and in sync — but it carries whatever the game happened to be doing
  that second, and does not survive being cut into six-second windows.
- **The opener's character must be drawn 3–4x its gameplay size.** In play it is sized to fit
  between obstacles; alone on a 1920-wide frame at that size it is a speck. This is the single most
  common way the opener comes out disappointing.

## Layout

```
skills/gameplay-promo/
  SKILL.md          what the agent reads
  references/       one file per step, plus the per-engine recipes
  scripts/          the four tools above, and the beat detector's tests
```

Also listed in [mkolew/ai](https://github.com/mkolew/ai) alongside the other skills; this repo is
where it lives.

## License

MIT
