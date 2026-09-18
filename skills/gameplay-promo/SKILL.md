---
name: gameplay-promo
description: 'Film a game and cut it into a promo video — a short cinematic opener on the main character, then real gameplay, scored to music with the cuts landing on the beat. Use when someone says "/gameplay-promo", "make a promo video for my game", "make a trailer", "record gameplay for the store listing", or needs a video for Google Play, the App Store, itch.io or Steam. Captures real footage from the running game rather than recreating it, so what the video shows is what the player gets.'
license: MIT
---

# Gameplay Promo

You are filming a game that already exists. Everything in the finished video comes out of the
running game — no mockups, no recreated UI, no stock footage. A promo that shows something the
player will not see is worse than no promo, because the first review says so.

## What you are making

Three or four shots and a soundtrack:

1. **The opener**, up to 10 seconds — the main character alone, **drawn much larger than it ever is
   in play**, doing one thing that ends in motion. For a space game: the ship sits still, its engines
   light and the hull shakes, then it launches. This is the only part that is staged, and it is still
   rendered by the game itself.
2. **Gameplay**, the bulk of it. Ask for **one long take — two to three minutes** — and sample short
   windows out of it. Ask the user to play it themselves unless they say otherwise: an autopilot
   dodges on a timer and it shows, while a person hesitates, cuts it fine, and recovers.
3. **A closing card** — the title screen, logo or splash, 2–3 seconds. Almost every game already has
   one and it needs no new code: run the game and do not start a match.
4. **One music track**, chosen by the user, running from its first second to the last frame.

Target 25–35 seconds. Store listings are not social clips; there is room to show the game.

### Why one long take, sampled

A single continuous slice shows one difficulty, one level, one kind of moment. Four six-second
windows spread across three minutes show the game **getting harder**, which is the thing worth
advertising. The first window is deliberately the start of play — it is the only one a viewer is
guaranteed to see — and the rest are spread so the last lands near the end of the session, where the
play is best.

Six seconds is the default for a reason: long enough to read a situation and watch it resolve, short
enough that nothing outstays its welcome. Below four it reads as a montage of fragments; past ten a
single window starts to feel like the whole video.

Segments are joined by a **dip through black**, about a fifth of a second each side. That is the
standard way to say "later, same game" without a caption, and it is why the cut does not read as a
glitch.

### Music: find it, then ask

```bash
node scripts/find-music.mjs <project-dir> --beats
```

That lists the audio already in the repo, longest first, marking what is long enough to be a track
and reporting each one's tempo. It collapses duplicates — game repos routinely hold the same file
in a canonical folder and again inside each engine's tree.

1. **Something found?** Show the list and **ask which to use.** Do not pick for them. You cannot
   hear any of it, and a track's fit with a game is not a property you can measure.
2. **Nothing found?** Ask for a path — a file or a folder to look in.

**The captured audio is never the soundtrack.** Engines often record the game's own sound along with
the video, and it is tempting because it is free and in sync. It does not survive the edit: a
recording carries whatever the game happened to be doing at that second — a track mid-fade between
difficulty tiers, an explosion across a cut, a menu's silence — and chopping it into six-second
windows turns that into noise. One track, chosen deliberately, laid under the whole film.

**The track runs from its own 0th second to the last frame** — through the opener, every gameplay
window and the closing card, as one continuous piece. It is never restarted per segment, and it is
never started partway in.

## Step 0 — what you need before anything

Ask for these four. Do not guess any of them.

|                                          |                                                                        |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| **The main character, and what it does** | "a rocket; it sits still, the engines start slowly, then it launches"  |
| **A music folder**                       | a path. List what you find and say which you picked, and why           |
| **How to run the game**                  | a command per shot — see the contract below                            |
| **Where the video goes**                 | the store, a site, a social post. It changes the length and the aspect |

## Step 0.5 — what the project can already do

**Identify the engine from the repo first** — `project.godot`, `ProjectSettings/ProjectVersion.txt`,
a `*.uproject`, and so on. `references/engine-recipes.md` has the markers and what each engine can
do. Do not ask the user to name their engine when the repo says it, and do not infer it from the
language: C# is Unity or it is not, and the difference decides every command you are about to write.

**If the repo holds more than one engine**, which is common in ports and prototypes, ask two
separate questions: which one to film, and whether the film mode belongs in all of them. One video
is enough; feature parity across engines is a decision only the user can make.

Then find out what that engine can already do, because it decides whether there is a promo to make
at all:

|                                        | If missing                                                         |
| -------------------------------------- | ------------------------------------------------------------------ |
| **Can it write video?**                | Without this there is no promo. See `references/engine-recipes.md` |
| **Can it hide its control chrome?**    | The footage shows key legends and touch pads. Add a film mode      |
| **Can it render the character alone?** | No opener. There is a fallback; it is not as good                  |

All three are changes to **the user's game**, not to this skill.

### The rules for touching their repo

1. **Ask first, per change.** Name the files, say roughly what each costs, and wait. "Make me a
   promo video" is not consent to edit an engine.
2. **Everything defaults to off.** A film mode is a flag that is false unless passed; an opener is a
   scene nothing loads on its own. A player's build must be byte-identical in behaviour, and you
   should verify that rather than assume it — capture a normal run and confirm the HUD is still
   there.
   **And verify the flag works at all.** Engines ignore command-line flags they do not recognise,
   silently and with exit code 0. Passing `--film` to a game that never implemented it produces a
   clean capture full of chrome and no error anywhere. Grep the source for the flag, then look at a
   captured frame.
3. **Additive and separable.** New files, or guarded lines in existing ones. Never refactor
   something on the way past. The user should be able to revert the lot in one commit and lose only
   the ability to film.
4. **Never touch what a player experiences.** Not gameplay, balance, art, audio, or the HUD's
   normal appearance. Hiding chrome happens behind the flag, never by deleting it.
5. **If they decline, say what the video loses** and use the fallbacks in
   `references/engine-recipes.md`. A promo with visible key legends is worse, not impossible.

`references/engine-recipes.md` has the concrete how, per engine — and is explicit that only Godot 4
has been verified here.

## The shot contract

A shot is a command that writes a video file and exits. Two placeholders are substituted:

```
{{out}}      the path to write
{{frames}}   how many frames, at the shot's fps
```

If neither appears, `--out <path> --seconds <n>` is appended instead.

A shot marked `"interactive": true` is **played by the user**. The skill explains what is about to
happen, waits for Enter, launches the game, and records until they quit it. Leave the frame count
out of that command — the take ends when the player ends it.

Anything that can write a file this way works. A Godot project films itself with:

```bash
godot --path <project> <scene> --write-movie {{out}} --fixed-fps 60 --quit-after {{frames}}
```

Flag names in the examples here are illustrative. Every project names its own, and most have none
until someone adds them — the contract is the command, not the flags inside it.

That is a **fixed-frame-rate render, not a screen recording** — it cannot drop frames under load,
and two runs produce identical footage. Prefer it to any screen capture when the engine offers one.

**Warn the player that it will feel slow.** Every frame is encoded as it is drawn, so the game runs
below real time while recording — measured at 64% on a 1080p Godot project. The written file is
correct-speed regardless, because frames are stamped at a fixed rate rather than by the clock. The
consequence worth stating: the take was performed in slow motion, so it will look a little sharper
than the game actually plays.

## Steps

Each step has a gate. Do not pass one without meeting it.

**1. Plan** — write `promo-output/promo.json` from the answers. Gate: the user has seen the plan and
the shot commands, and agreed to them. See `references/step-1-plan.md`.

**2. Capture** — `node scripts/film.mjs promo-output/promo.json --out-dir promo-output`. Gate: every
clip passes its checks. See `references/step-2-capture.md`.

**3. Edit** — `node scripts/edit.mjs promo-output/promo.json --out-dir promo-output`. Gate: the
finished file has the expected duration and is not black. See `references/step-3-edit.md`.

**4. Deliver** — poster frame, where the file actually goes, and what the store wants. See
`references/step-4-deliver.md`.

`references/engine-recipes.md` covers adding capture, a film mode and an opener to a project that
has none — read it during step 0.5, not step 2.

## The laws

- **Film the game, never a drawing of it.** If a shot cannot be captured, cut the shot.
- **The opener's character is far bigger than in play — and it shakes.** In gameplay a character is
  sized to fit between obstacles; alone on a 1920-wide frame at that size it is a speck, and the
  shot reads as an empty sky. Draw it **3–4x gameplay scale, filling roughly a quarter to a third of
  the frame height**, and shake it in proportion to the effort — the arcade shake is what makes the
  launch feel like force rather than a tween. Extract a frame and look at it before moving on; this
  is the single most common way the opener comes out wrong.
- **Prefer a person to an autopilot.** Scripted play reads as scripted: evenly spaced dodges, no
  hesitation, no near-misses. Offer the autopilot only as a fallback, and say which one produced
  the footage.
- **Show the game working.** Capture from where the game is interesting, not from `t=0`. Most games
  open at their least dense — use `skip` to start the clip later rather than filming an empty level.
- **No HUD chrome.** On-screen control pads, key legends, pause and fullscreen buttons say "someone
  is playing this on a laptop". Keep score, timer and world name — they say "this is a game".
- **Cut on the beat.** A cut 100ms off reads as a mistake to people who could not tell you why.
- **Never stretch footage to fit the music.** Trim it. Gameplay slowed 8% looks like a bad frame
  rate, and the frame rate is the one thing a game promo must never appear to have a problem with.
- **Check the footage before the edit, and the edit before delivery.** A black capture is silent,
  survives every intermediate step, and is discovered by a human watching the finished file.

## Dependencies

`ffmpeg` and `ffprobe` on PATH, and Node 18+. Nothing else — no Python, no beat-detection library,
no video framework. `scripts/beats.mjs` finds tempo with ffmpeg's own audio filters, which is why
this runs anywhere ffmpeg does.
