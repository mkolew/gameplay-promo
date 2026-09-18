# Engine recipes

The skill captures video by running commands the project supplies. Most projects do not have those
commands yet, so this is how to add them — per engine, and what to do when you cannot.

**Verified here: Godot 4 only.** Everything else is written from the engines' documented features
and has not been run by this skill. Treat those as a starting point to confirm, not as fact, and say
so to the user rather than presenting an untested command as known-good.

## Identify the engine first

Detect it from the repo; do not ask the user to name it and do not guess from the language.

| Engine           | Marker                                                                  |
| ---------------- | ----------------------------------------------------------------------- |
| **Godot 4**      | `project.godot`                                                         |
| **Unity**        | `ProjectSettings/ProjectVersion.txt` (it also states the exact version) |
| **Unreal**       | a `*.uproject` file                                                     |
| **Web / canvas** | `package.json` plus a `<canvas>` in the served HTML                     |
| **LÖVE**         | `main.lua` with `conf.lua`                                              |
| **Bevy**         | `Cargo.toml` listing `bevy`                                             |

```bash
find . -maxdepth 3 \( -name project.godot -o -name ProjectVersion.txt -o -name '*.uproject' \) \
  -not -path '*/node_modules/*' 2>/dev/null
```

**More than one is normal.** Parallel ports, a web build beside a native one, a prototype left in
place. When you find several:

1. **Ask which to film.** You need one video, not one per engine — and the answer is usually the
   engine that is shipping, not the one that is furthest along.
2. **Then ask whether the film mode should go into all of them.** In a repo that deliberately
   mirrors features between engines, adding it to only one creates exactly the drift that repo
   exists to avoid. That is the user's call, not yours, and it is a separate question from which
   engine you film.

## What a project needs

Three things, in descending order of how much they matter:

1. **A way to write video from the game.** Without this there is no promo.
2. **A film mode** that hides control chrome. Without it the footage looks like a recording of
   somebody's laptop.
3. **An opener scene** — the character alone, doing one thing. Optional; there is a fallback.

All three are changes to the user's game. Get agreement before writing any of them.

## Godot 4 — verified

**Capture** is built in. No plugin, no screen recorder:

```bash
godot --path <project> [scene] --write-movie out.avi --fixed-fps 60 --quit-after <frames>
```

`--write-movie` forces fixed-FPS rendering: frames are stamped at 60fps regardless of how long each
took, so the file is correct-speed even though the game runs below real time while recording
(measured 64% on a 1080p project). Omit `--quit-after` for a take the player ends themselves.

It needs a real window. Adding `--headless` to quieten it produces a file that is entirely black.

**Film mode** is a command-line flag the project parses, gating the visibility of its own chrome:

```gdscript
_film = OS.get_cmdline_args().has("--film")
...
_key_hint.visible = keys and not wanted and not _film
_pause_button.visible = _state == State.RUNNING and not _film
```

Hide: on-screen sticks and pads, key legends, pause, fullscreen, "press ESC" hints.
Keep: score, timer, world or level name. Those say "game"; the others say "someone's laptop".

**Opener**: a `.tscn` whose script draws the character with the game's own drawing code, on a
timeline. A worked one, ~120 lines, runs about 5 seconds:

```
0.0 - 1.1s   still. No thrust, sky drifting behind so it is not a frozen image
1.1 - 3.0s   thrust eased 0 -> 1 (pow 1.8, so it lingers low), shake scaled by thrust
3.0 - 3.5s   hold at full
3.5 - 5.4s   rise, quadratic, far enough that the exhaust clears the frame too
```

Ease the thrust rather than ramping it linearly — a linear ramp reads as a slider being dragged.
Stop the shake once it moves: the shake is the character fighting its own brakes, and there is
nothing left to fight once it is away.

The pattern that makes it look right: **borrow the game's drawing, not its physics.** The character
controller exists to turn input into motion; an opener's motion is a fixed timeline. Instantiating
the controller means fighting it.

Draw the character **3–4x its gameplay scale**, filling about a quarter to a third of the frame
height, and shake it in proportion to its effort. Both are load-bearing and both are easy to skip:
in play the character is sized to fit between obstacles, and at that size alone on a 1920-wide frame
it is a speck in an empty sky. `ShipArt.draw_plume(canvas, thrust, lean, t, SCALE)` and
`ShipArt.draw_into(canvas, SCALE, ...)` both take the scale — pass the opener's, not the game's.

## Unity — not verified

**Capture** without any package, which is the Unity equivalent of Godot's movie writer:

```csharp
// Fixes the simulation step: Time.deltaTime becomes exactly 1/60 regardless of how long the frame
// took to render or write. The game advances in lockstep, so the footage is correct-speed even
// though it records below real time.
Time.captureFramerate = 60;
...
ScreenCapture.CaptureScreenshot($"{dir}/frame_{Time.frameCount:D5}.png");
```

Then assemble:

```bash
ffmpeg -framerate 60 -i "frames/frame_%05d.png" -c:v libx264 -crf 18 -pix_fmt yuv420p out.mp4
```

`Time.captureFramerate` is the load-bearing line. Without it you get a screen recording with
whatever frame times the machine happened to produce; with it, every frame is a fixed step.

The cost is a PNG per frame — 40 seconds at 60fps is 2400 files and several GB at 1080p. Write to a
scratch directory, assemble, delete. The Unity Recorder package (`com.unity.recorder`) writes MP4
directly and avoids that, but it is a dependency to add to someone's project; prefer the above
unless they already have it.

**Film mode**: a flag read from `System.Environment.GetCommandLineArgs()`, gating the HUD's draw
calls — in an IMGUI project, the `OnGUI` branches that draw control legends and buttons.

**Opener**: a scene with the character's own prefab on a Timeline, or a script driving a transform
on a fixed clock. The same two rules apply as for Godot: borrow the drawing rather than the
controller, and scale the character up 3-4x from gameplay size.

## Unreal — not verified

Movie Render Queue renders to image sequences or video, driven from the command line with
`-MoviePipelineConfig`. Sequencer is the natural home for an opener.

## Web / canvas — not verified

`MediaRecorder` over `canvas.captureStream(60)` records from inside the page, which keeps it
deterministic-ish and needs no screen permission. Headless Chrome with CDP `Page.startScreencast` is
the automatable version.

## Fallback: screen recording

When an engine cannot write video itself. **Worse in every way** — variable frame rate, dropped
frames under load, whatever else is on screen, and a permission prompt — so reach for it last.

```bash
# macOS: list devices first, the screen index changes between machines
ffmpeg -f avfoundation -list_devices true -i ""
ffmpeg -f avfoundation -framerate 60 -i "<index>" -t 40 out.mp4

# Windows
ffmpeg -f gdigrab -framerate 60 -i title="<window title>" -t 40 out.mp4

# Linux
ffmpeg -f x11grab -framerate 60 -video_size 1920x1080 -i :0.0 -t 40 out.mp4
```

Tell the user to close everything else and turn off notifications. A Slack toast in the middle of a
store listing is not recoverable in the edit.

## Fallback: no opener

If the project cannot render one and the user does not want to add one, do not fake a launch from a
still image. It will be the only shot that is not the game, and it is the first thing a viewer sees.

Better options, in order:

1. **Open on the game's own title screen**, held for 2–3 seconds. It is real, it is already built,
   and it carries the name.
2. **Open on gameplay directly**, with a longer fade up from black. Shorter, and honest.
3. **A title card** — the game's name on its own background colour, 1.5s, then gameplay.

Say which was used and why, so the user can decide whether the opener is worth building.
