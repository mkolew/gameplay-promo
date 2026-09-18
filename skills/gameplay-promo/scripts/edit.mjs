#!/usr/bin/env node
/**
 * Cuts captured clips into a finished promo.
 *
 *   node edit.mjs <plan.json> [--out-dir promo-output]
 *
 * Takes what film.mjs captured, samples segments out of long takes, joins them with a dip through
 * black, lays audio underneath, and encodes one H.264 file.
 *
 * Two things make this more than a concat:
 *
 *   1. A long played take is sampled, not trimmed. One continuous slice of a three-minute session
 *      shows one difficulty, one galaxy, one kind of moment. Several short windows spread across it
 *      show the game getting harder, which is the thing worth advertising.
 *   2. Cuts land on the beat, so the edit reads as deliberate.
 *
 * The captured audio is deliberately discarded. A recording carries whatever the game happened to
 * be doing — a track fading between difficulty tiers, an explosion over the cut, silence in a menu —
 * which is honest but does not survive being chopped into six-second windows. The soundtrack is one
 * track the user picked, laid under the whole film.
 */

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { analyse, snap } from "./beats.mjs";

const run = promisify(execFile);

/**
 * The dip through black between segments, each side.
 *
 * Short on purpose. Long enough that a viewer registers a jump in time rather than a glitch, short
 * enough that it never feels like the video stopped. Game trailers use this constantly — it is the
 * standard way to say "later, same game" without a caption.
 */
const DIP = 0.18;

/** How long the whole film fades up at the head and down at the tail. */
const HEAD_FADE = 0.6;
const TAIL_FADE = 0.8;

/** Below this, the tempo found is not trusted and the edit falls back to unsynced cuts. */
const MIN_CONFIDENCE = 1.25;

/** Default music level when an external track is supplied. */
const MUSIC_GAIN = 0.85;

/**
 * Default segment length when a take is sampled.
 *
 * Six seconds is the shape store trailers settle on: long enough to read a situation and see it
 * resolve — a gap approached, threaded, and survived — and short enough that nothing outstays its
 * welcome. Below about four it reads as a montage of fragments; past about ten a single segment
 * starts to feel like the whole video.
 */
const SEGMENT_S = 6;

/**
 * How long a clip actually is, in seconds.
 *
 * @param {string} path
 * @returns {Promise<number>}
 */
async function duration(path) {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    path,
  ]);
  return Number(stdout.trim());
}

/**
 * Turns shots into the windows that will actually be cut.
 *
 * A shot with `sample` becomes several windows spread across the take: the first at the start of
 * play, the rest evenly through what remains. The first window matters most — it is the only one a
 * viewer is guaranteed to watch — and it is deliberately the beginning of the run rather than a
 * random moment, so the video opens where the player opens.
 *
 * @param {object} plan
 * @param {string} outDir
 * @returns {Promise<Array<{ name: string, path: string, start: number, seconds: number }>>}
 */
async function windows(plan, outDir) {
  const out = [];

  for (const shot of plan.shots) {
    const path = join(outDir, "clips", `${shot.name}.avi`);
    const length = await duration(path);
    const skip = shot.skip ?? 0;
    const available = Math.max(0, length - skip);

    if (!shot.sample) {
      const seconds = shot.use ? Math.min(shot.use, available) : available;
      out.push({ name: shot.name, path, start: skip, seconds });
      continue;
    }

    const each = shot.sample.seconds ?? SEGMENT_S;
    const count = Math.max(1, shot.sample.count ?? 4);

    /*
     * Spread across the take rather than bunched: the last window should end near the end of the
     * session, because that is where the game is hardest and the play is best. If the take is too
     * short to hold them all, fewer windows is the right answer — overlapping them would show the
     * same seconds twice.
     */
    const fits = Math.max(1, Math.min(count, Math.floor(available / each)));
    const spare = available - fits * each;
    const gap = fits > 1 ? spare / (fits - 1) : 0;

    for (let i = 0; i < fits; i++) {
      out.push({
        name: fits > 1 ? `${shot.name}#${i + 1}` : shot.name,
        path,
        start: Number((skip + i * (each + gap)).toFixed(3)),
        seconds: each,
      });
    }

    if (fits < count) {
      process.stdout.write(
        `  note: ${shot.name} holds ${fits} segment(s) of ${each}s, not ${count} — ` +
          `the take is ${length.toFixed(1)}s\n`,
      );
    }
  }

  return out;
}

/**
 * Trims each window so its boundary falls on a beat.
 *
 * Only ever shortens. Stretching to reach the next beat would freeze a frame or slow the footage,
 * and gameplay running slow looks like a performance problem rather than an edit.
 *
 * @param {Array<{ seconds: number }>} shots
 * @param {number[]} beats
 * @returns {Array<{ seconds: number, cutAt: number }>}
 */
function alignToBeats(shots, beats) {
  let running = 0;
  return shots.map((shot) => {
    const wanted = running + shot.seconds;
    const landed = beats.length > 0 ? snap(beats, wanted) : wanted;
    const seconds = Math.max(1.0, Math.min(shot.seconds, landed - running));
    running += seconds;
    return {
      ...shot,
      seconds: Number(seconds.toFixed(3)),
      cutAt: Number(running.toFixed(3)),
    };
  });
}

/**
 * The filter graph.
 *
 * Segments are concatenated, not cross-faded, with each one dipping out to black and the next
 * dipping in. That is deliberate on two counts: it reads as a jump in time rather than a blend of
 * two unrelated moments, and — unlike xfade, which overlaps its inputs — the total length is simply
 * the sum, so the audio built the same way lines up frame for frame instead of drifting.
 *
 * @param {Array<{ path: string, start: number, seconds: number }>} shots
 * @param {number} fps
 * @returns {{ filter: string, total: number }}
 */
function graph(shots, fps) {
  const parts = [];
  const total = shots.reduce((sum, s) => sum + s.seconds, 0);

  shots.forEach((shot, i) => {
    /*
     * `duration` on ffmpeg's trim is the length of the OUTPUT, measured from `start` — not a
     * timestamp in the source. Passing start+seconds asked for far too much and let the whole tail
     * of a take through; a 22s window came out 68s long.
     */
    const out = Math.max(0.1, shot.seconds - DIP);
    parts.push(
      `[${i}:v]trim=start=${shot.start}:duration=${shot.seconds},setpts=PTS-STARTPTS,` +
        `fps=${fps},format=yuv420p,` +
        `fade=t=in:st=0:d=${DIP},fade=t=out:st=${out.toFixed(3)}:d=${DIP}[v${i}]`,
    );
  });

  const labels = shots.map((_, i) => `[v${i}]`).join("");
  parts.push(`${labels}concat=n=${shots.length}:v=1:a=0[vc]`);

  parts.push(
    `[vc]fade=t=in:st=0:d=${HEAD_FADE},` +
      `fade=t=out:st=${Math.max(0, total - TAIL_FADE).toFixed(3)}:d=${TAIL_FADE}[vout]`,
  );

  return { filter: parts.join(";"), total };
}

/**
 * Renders the promo.
 *
 * `plan.music` is a path to one track, or absent for a silent film. The game's own captured audio
 * is never used — see the note at the top of this file.
 *
 * @param {object} plan
 * @param {string} outDir
 * @returns {Promise<{ output: string, total: number, bpm: number|null }>}
 */
export async function edit(plan, outDir) {
  const fps = plan.fps ?? 30;
  const output = join(outDir, plan.output ?? "promo.mp4");
  const track = plan.music ?? null;

  let beats = [];
  let bpm = null;
  if (track) {
    const music = await analyse(track, 90);
    if (music.confidence >= MIN_CONFIDENCE) {
      beats = music.beats;
      bpm = music.bpm;
      process.stdout.write(
        `music: ${music.bpm} BPM, confidence ${music.confidence}\n`,
      );
    } else {
      process.stdout.write(
        `music: no reliable beat (confidence ${music.confidence}); cutting without it\n`,
      );
    }
  } else {
    process.stdout.write("music: none given — the film will be silent\n");
  }

  const sampled = await windows(plan, outDir);
  const shots = alignToBeats(sampled, beats);
  for (const shot of shots) {
    process.stdout.write(
      `  ${shot.name}: ${shot.seconds}s from ${shot.start}s, ends at ${shot.cutAt}s\n`,
    );
  }

  const { filter, total } = graph(shots, fps);
  const args = ["-v", "error", "-y"];
  for (const shot of shots) {
    args.push("-i", shot.path);
  }

  let full = filter;
  const maps = ["-map", "[vout]"];

  if (track) {
    args.push("-i", track);
    const index = shots.length;
    full +=
      `;[${index}:a]atrim=duration=${total.toFixed(3)},asetpts=PTS-STARTPTS,` +
      `volume=${plan.musicGain ?? MUSIC_GAIN},afade=t=in:st=0:d=0.5,` +
      `afade=t=out:st=${Math.max(0, total - 1.5).toFixed(3)}:d=1.5[aout]`;
    maps.push("-map", "[aout]", "-c:a", "aac", "-b:a", "192k");
  }

  args.push(
    "-filter_complex",
    full,
    ...maps,
    "-c:v",
    "libx264",
    "-crf",
    "18",
    "-preset",
    "slow",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-r",
    String(fps),
    output,
  );

  await run("ffmpeg", args, { maxBuffer: 1 << 28 });
  return { output, total, bpm };
}

/*
 * Run directly, or imported? `process.argv[1]` is undefined under `node -e`, and reading it blindly
 * made importing this module throw before the importer got a chance to use it.
 */
const argv = process.argv.slice(2);
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const planPath = argv.find((a) => !a.startsWith("--"));
  if (!planPath) {
    console.error("usage: node edit.mjs <plan.json> [--out-dir promo-output]");
    process.exit(2);
  }

  const outAt = argv.indexOf("--out-dir");
  const outDir = outAt >= 0 ? argv[outAt + 1] : "promo-output";
  const plan = JSON.parse(readFileSync(planPath, "utf8"));

  const result = await edit(plan, outDir);
  console.log(`\nwrote ${result.output} — ${result.total.toFixed(1)}s`);
}
