/**
 * Tests the beat detector against click tracks whose tempo is known exactly.
 *
 *   node --test skills/gameplay-promo/scripts/
 *
 * Real music has no ground truth to test against — "does 140 BPM sound right for this track" is
 * not an assertion. So ffmpeg synthesises the input: a 60 Hz thump every N seconds is a kick drum
 * with a tempo known to the millisecond, and the detector either reports that tempo or it is
 * broken.
 *
 * This is what caught the first implementation, which derived tempo from the median gap between
 * peaks and confidently reported double time.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";

import { analyse, snap } from "./beats.mjs";

const run = promisify(execFile);
const workspace = mkdtempSync(join(tmpdir(), "beats-"));

after(() => rmSync(workspace, { recursive: true, force: true }));

/**
 * Writes a click track: one decaying 60 Hz thump per beat, which is what a kick looks like to a
 * low-pass filter.
 *
 * @param {number} bpm
 * @param {number} seconds
 * @returns {Promise<string>}
 */
async function clickTrack(bpm, seconds) {
  const period = 60 / bpm;
  const path = join(workspace, `click-${bpm}.wav`);
  const expression = `0.9*sin(2*PI*60*t)*exp(-14*mod(t\\,${period}))`;

  await run("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `aevalsrc='${expression}':d=${seconds}:s=44100`,
    path,
  ]);

  return path;
}

test("reports the tempo of a click track", async () => {
  for (const bpm of [96, 120, 144]) {
    const track = await clickTrack(bpm, 20);
    const result = await analyse(track, 20);

    // Arrange / Act above; assert within a quarter BPM, the resolution of the search itself.
    assert.ok(
      Math.abs(result.bpm - bpm) <= 0.5,
      `expected ~${bpm} BPM, got ${result.bpm}`,
    );
  }
});

test("does not report double or half time", async () => {
  // The failure the median-gap implementation had: 108 BPM music read as 214.
  const track = await clickTrack(100, 20);
  const result = await analyse(track, 20);

  assert.ok(Math.abs(result.bpm - 200) > 1, "reported double time");
  assert.ok(Math.abs(result.bpm - 50) > 1, "reported half time");
});

test("puts beats where the clicks are", async () => {
  const track = await clickTrack(120, 20);
  const result = await analyse(track, 20);

  // 120 BPM is a click every 0.5s, so every beat should sit within 60ms of a multiple of it.
  for (const at of result.beats.slice(1, 20)) {
    const offset = Math.abs((at % 0.5) - 0.25) - 0.25;
    assert.ok(
      Math.abs(offset) < 0.06,
      `beat at ${at}s is not on the half-second`,
    );
  }
});

test("snaps a planned cut to the nearest beat", () => {
  const beats = [0, 0.5, 1, 1.5, 2];

  assert.equal(snap(beats, 1.2), 1);
  assert.equal(snap(beats, 1.4), 1.5);
  // Nothing to snap to is not an error: the edit still needs a cut point.
  assert.equal(snap([], 1.4), 1.4);
});

test("scores a track with no beat lower than one with a beat", async () => {
  // A steady tone has no onsets at all, so any grid fits it equally badly. The edit step reads this
  // to decide between beat-locked cuts and plain fades, so the two must be separable.
  const flat = join(workspace, "tone.wav");
  await run("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "aevalsrc='0.5*sin(2*PI*60*t)':d=20:s=44100",
    flat,
  ]);

  const tone = await analyse(flat, 20);
  const clicks = await analyse(await clickTrack(120, 20), 20);

  assert.ok(
    clicks.confidence > tone.confidence * 2,
    `a click track (${clicks.confidence}) should score far above a flat tone (${tone.confidence})`,
  );
});
