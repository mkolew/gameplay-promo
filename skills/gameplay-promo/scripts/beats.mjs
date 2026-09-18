#!/usr/bin/env node
/**
 * Finds the beat grid of a music track, using nothing but ffmpeg.
 *
 *   node beats.mjs <track> [--seconds 60] [--json out.json]
 *
 * Prints JSON: tempo, the phase offset, and the grid of beat times to cut on.
 *
 * Why not a beat-detection library: the usual answer is librosa, which wants Python 3.11+, numpy,
 * scipy and a package manager this machine does not have. ffmpeg is already a dependency of the
 * skill for capture and encode, and it can produce the one signal beat tracking actually needs.
 *
 * The method, in three steps:
 *
 *   1. ffmpeg reports the RMS level of the bass band (below 150 Hz) every few milliseconds. On
 *      music with drums that envelope is mostly the kick, which is what a cut wants to land on.
 *   2. Rising edges of that envelope are onsets. Level alone is not enough — a sustained bass note
 *      is loud for its whole length, while a kick is a step up — so only the increase counts.
 *   3. A comb filter finds the tempo: score every plausible period against the onsets, at every
 *      phase, and keep the pair that collects the most energy.
 *
 * Step 3 is the part that matters. Deriving tempo from the median gap between peaks was tried
 * first and gave 214 and 234 BPM on tracks that are plainly half that, because a missed or doubled
 * peak moves the median. The comb filter cannot make that mistake: it is scored against every
 * onset at once, so one bad peak is one bad sample out of hundreds.
 */

import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Tempo search range. Folded into this window, since a comb filter scores 2x as well as 1x. */
const BPM_MIN = 80;
const BPM_MAX = 160;

/**
 * Envelope resolution, 5ms.
 *
 * Not a free choice. astats reports one reading per input frame, and a frame is whatever the
 * decoder hands it — measured at 2.7ms for an .ogg and 93ms for a .wav from the same filter chain.
 * At 93ms the phase of the grid cannot be placed closer than ±46ms, which is audible as a cut
 * landing beside the beat rather than on it; the click-track test failed by exactly that margin.
 * asetnsamples fixes the window regardless of source, and aresample fixes the rate it is counted
 * against, so 256 samples is 5.8ms for every input.
 */
const HZ = 200;
const WINDOW_SAMPLES = 256;

/**
 * The bass-band RMS envelope, in dB, sampled evenly.
 *
 * astats resets per frame so each reading covers a few milliseconds rather than the whole file.
 * Output goes to stdout through ametadata's `file=-`, which keeps this to one process and no
 * temporary files.
 *
 * @param {string} track
 * @param {number} seconds
 * @returns {Promise<{ dt: number, levels: number[] }>}
 */
async function envelope(track, seconds) {
  const filter = [
    "aresample=44100",
    `asetnsamples=n=${WINDOW_SAMPLES}:p=0`,
    "lowpass=f=150",
    "astats=metadata=1:reset=1",
    "ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
  ].join(",");

  const { stdout } = await run(
    "ffmpeg",
    [
      "-v",
      "error",
      "-t",
      String(seconds),
      "-i",
      track,
      "-af",
      filter,
      "-f",
      "null",
      "-",
    ],
    { maxBuffer: 1 << 28 },
  );

  const times = [];
  const levels = [];
  let at = 0;

  for (const line of stdout.split("\n")) {
    const stamp = line.match(/pts_time:([0-9.]+)/);
    if (stamp) {
      at = Number(stamp[1]);
      continue;
    }
    const level = line.match(/RMS_level=(-?[0-9.]+|-inf)/);
    if (level) {
      times.push(at);
      // Silence reads as -inf, which would poison every average it touches.
      levels.push(level[1] === "-inf" ? -90 : Number(level[1]));
    }
  }

  if (levels.length < 2) {
    throw new Error(`no audio levels came back for ${track}`);
  }

  return resample(times, levels, HZ);
}

/**
 * The envelope on an even time grid, so later steps can index by time rather than search.
 *
 * ffmpeg's frames are evenly spaced in samples, not in seconds, and the spacing changes with the
 * file's sample rate — so this cannot be assumed.
 *
 * @param {number[]} times
 * @param {number[]} levels
 * @param {number} hz
 * @returns {{ dt: number, levels: number[] }}
 */
function resample(times, levels, hz) {
  const dt = 1 / hz;
  const span = times[times.length - 1];
  const out = new Array(Math.max(1, Math.floor(span / dt))).fill(-90);

  let cursor = 0;
  for (let i = 0; i < out.length; i++) {
    const want = i * dt;
    while (cursor + 1 < times.length && times[cursor + 1] <= want) {
      cursor++;
    }
    out[i] = levels[cursor];
  }

  return { dt, levels: out };
}

/**
 * Onset strength: how much louder the bass just got, never how loud it is.
 *
 * Half-wave rectified, because only the rise is an onset — the decay after a kick is not a second
 * event. Normalised to 0..1 so the comb scores below are comparable between tracks.
 *
 * @param {number[]} levels
 * @returns {number[]}
 */
function onsets(levels) {
  const out = new Array(levels.length).fill(0);
  for (let i = 1; i < levels.length; i++) {
    out[i] = Math.max(0, levels[i] - levels[i - 1]);
  }

  const peak = Math.max(...out);
  return peak > 0 ? out.map((v) => v / peak) : out;
}

/**
 * The tempo and phase whose beat grid collects the most onset energy.
 *
 * Every candidate period is scored at every phase within it, which is the whole reason this is
 * robust: the winner is the grid that agrees with the most onsets, not the one that agrees with
 * the loudest few.
 *
 * @param {number[]} strength
 * @param {number} dt
 * @returns {{ bpm: number, offset: number, score: number, confidence: number }}
 */
function comb(strength, dt) {
  const span = strength.length * dt;
  let best = { bpm: 0, offset: 0, score: -1 };

  const scores = [];

  for (let bpm = BPM_MIN; bpm <= BPM_MAX; bpm += 0.25) {
    const period = 60 / bpm;
    // One phase per envelope sample: the grid can then land as precisely as the signal allows,
    // and no finer, which is the only honest resolution to search at.
    const steps = Math.max(8, Math.round(period / dt));
    for (let step = 0; step < steps; step++) {
      const offset = (period * step) / steps;
      let score = 0;
      let beats = 0;

      for (let t = offset; t < span; t += period) {
        const i = Math.round(t / dt);
        if (i < strength.length) {
          // The neighbours count too: a kick lands a few milliseconds off the mathematical grid.
          score +=
            strength[i] +
            0.5 * (strength[i - 1] ?? 0) +
            0.5 * (strength[i + 1] ?? 0);
          beats++;
        }
      }

      // Per beat, or slow tempos win by having fewer, richer beats to sum.
      const mean = beats > 0 ? score / beats : 0;
      scores.push(mean);
      if (mean > best.score) {
        best = { bpm, offset, score: mean };
      }
    }
  }

  /*
   * Confidence is how far the winner stands above the field, not its raw score.
   *
   * The raw score was tried first and is worthless: onset strength is normalised per track, so
   * music with no beat at all has its noise floor stretched to full scale and scores HIGHER than a
   * clean click track. A steady tone measured 0.47 against the click track's 0.21.
   *
   * Peakiness cannot be fooled that way. If a track has a beat, one grid fits far better than the
   * rest; if it does not, every grid fits equally badly and the ratio sits near 1.
   */
  const average =
    scores.reduce((sum, v) => sum + v, 0) / Math.max(1, scores.length);
  return { ...best, confidence: average > 0 ? best.score / average : 0 };
}

/**
 * Every beat time on the winning grid, plus the ones carrying the most onset energy.
 *
 * `strong` is what a cut list should prefer: any beat will do rhythmically, but landing a reveal on
 * a beat the music also emphasises is what makes an edit feel deliberate.
 *
 * @param {{ bpm: number, offset: number }} tempo
 * @param {number[]} strength
 * @param {number} dt
 * @returns {{ grid: number[], strong: number[] }}
 */
function grid(tempo, strength, dt) {
  const period = 60 / tempo.bpm;
  const span = strength.length * dt;
  const beats = [];

  for (let t = tempo.offset; t < span; t += period) {
    const i = Math.round(t / dt);
    beats.push({
      at: Number(t.toFixed(3)),
      energy:
        (strength[i] ?? 0) +
        0.5 * (strength[i - 1] ?? 0) +
        0.5 * (strength[i + 1] ?? 0),
    });
  }

  const ranked = [...beats].sort((a, b) => b.energy - a.energy).slice(0, 12);
  return {
    grid: beats.map((b) => b.at),
    strong: ranked.map((b) => b.at).sort((a, b) => a - b),
  };
}

/**
 * The nearest beat to `at`, for snapping a planned cut onto the grid.
 *
 * Exported because the edit step plans cuts in round seconds and then moves each one to the beat
 * beside it; the alternative is every caller reimplementing a nearest search over the same array.
 *
 * @param {number[]} beats
 * @param {number} at
 * @returns {number}
 */
export function snap(beats, at) {
  if (beats.length === 0) {
    return at;
  }
  return beats.reduce(
    (best, b) => (Math.abs(b - at) < Math.abs(best - at) ? b : best),
    beats[0],
  );
}

/**
 * Analyses one track and returns its grid.
 *
 * @param {string} track
 * @param {number} seconds
 * @returns {Promise<object>}
 */
export async function analyse(track, seconds = 60) {
  const { dt, levels } = await envelope(track, seconds);
  const strength = onsets(levels);
  const tempo = comb(strength, dt);
  const { grid: beats, strong } = grid(tempo, strength, dt);

  return {
    track,
    analysedSeconds: Number((levels.length * dt).toFixed(2)),
    bpm: Number(tempo.bpm.toFixed(2)),
    offset: Number(tempo.offset.toFixed(3)),
    confidence: Number(tempo.confidence.toFixed(3)),
    beatCount: beats.length,
    beats,
    strong,
  };
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
  const track = argv.find((a) => !a.startsWith("--"));
  if (!track) {
    console.error(
      "usage: node beats.mjs <track> [--seconds 60] [--json out.json]",
    );
    process.exit(2);
  }

  const seconds = Number(argv[argv.indexOf("--seconds") + 1]) || 60;
  const result = await analyse(track, seconds);

  const jsonAt = argv.indexOf("--json");
  if (jsonAt >= 0 && argv[jsonAt + 1]) {
    writeFileSync(argv[jsonAt + 1], JSON.stringify(result, null, 2));
  }
  console.log(JSON.stringify(result, null, 2));
}
