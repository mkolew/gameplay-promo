#!/usr/bin/env node
/**
 * Finds the music already in a project, so the user can pick one instead of hunting for a path.
 *
 *   node find-music.mjs [dir] [--beats] [--json out.json]
 *
 * Prints every audio file it finds with its duration, longest first, and with `--beats` the tempo
 * and how confidently it was found.
 *
 * Length is the useful sort. A game's audio folder is mostly effects — a coin, a hit, a menu blip —
 * and the handful of files over half a minute are the music. Sorting by duration puts the tracks at
 * the top without needing to guess from filenames, which are named for the game's own vocabulary
 * and not for us.
 *
 * This only lists. Choosing is the user's, and the skill is explicit that it must ask.
 */

import { execFile } from "node:child_process";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { analyse } from "./beats.mjs";

const run = promisify(execFile);

/** Container formats worth considering. Anything ffprobe can open, in practice. */
const AUDIO = new Set([
  ".ogg",
  ".mp3",
  ".wav",
  ".flac",
  ".m4a",
  ".aac",
  ".opus",
  ".wma",
]);

/** Directories that never hold a project's own music, and cost minutes to walk. */
const SKIP = new Set([
  "node_modules",
  ".git",
  "build",
  "dist",
  "out",
  "target",
  "Library",
  "Temp",
  "obj",
  "bin",
  ".godot",
  ".wrangler",
  ".next",
  "vendor",
  "Pods",
  "venv",
  ".venv",
  "__pycache__",
]);

/** Shorter than this is a sound effect, not a soundtrack. Still listed, just flagged. */
const TRACK_S = 30;

/**
 * Every audio file under `dir`, depth-limited so a stray deep tree cannot stall the search.
 *
 * @param {string} dir
 * @param {number} depth
 * @returns {string[]}
 */
function walk(dir, depth = 6) {
  if (depth < 0) {
    return [];
  }

  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // Unreadable directories are normal — permissions, broken symlinks — and never fatal here.
    return [];
  }

  const found = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".") {
      continue;
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) {
        found.push(...walk(path, depth - 1));
      }
    } else if (AUDIO.has(extname(entry.name).toLowerCase())) {
      found.push(path);
    }
  }

  return found;
}

/**
 * Duration in seconds, or 0 when ffprobe cannot read the file.
 *
 * @param {string} path
 * @returns {Promise<number>}
 */
async function seconds(path) {
  try {
    const { stdout } = await run("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=nw=1:nk=1",
      path,
    ]);
    return Number(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

/**
 * The music in a project, longest first.
 *
 * @param {string} dir
 * @param {boolean} withBeats
 * @returns {Promise<Array<object>>}
 */
export async function findMusic(dir, withBeats = false) {
  const files = walk(dir);
  const tracks = [];

  for (const path of files) {
    const length = await seconds(path);
    if (length <= 0) {
      continue;
    }
    tracks.push({
      path: relative(dir, path),
      seconds: Number(length.toFixed(1)),
      bytes: statSync(path).size,
      likelyTrack: length >= TRACK_S,
    });
  }

  tracks.sort((a, b) => b.seconds - a.seconds);
  const unique = dedupe(tracks);

  if (withBeats) {
    // Only the plausible tracks: analysing every short effect costs seconds each and tells nobody
    // anything, since an effect has no tempo to find.
    for (const track of unique.filter((t) => t.likelyTrack)) {
      try {
        const music = await analyse(join(dir, track.path), 45);
        track.bpm = music.bpm;
        track.confidence = music.confidence;
      } catch {
        // A file ffprobe opens but the analyser chokes on is still worth listing.
      }
    }
  }

  return unique;
}

/**
 * Collapses copies of the same file to the one worth naming.
 *
 * Game repos routinely hold the same audio several times over: a canonical folder plus a synced
 * copy inside each engine's own tree, because engines can only load from their own project
 * directory. Listing all of them turns three tracks into nine choices that differ only by path, and
 * the user has to work out which is which.
 *
 * Same name and same byte count is enough — a real collision would need two different tracks that
 * agree on both, which does not happen with music. The copy kept is the shallowest, because a
 * synced file lives deeper than the source it was synced from.
 *
 * @param {Array<{ path: string, bytes: number }>} tracks
 * @returns {Array<object>}
 */
function dedupe(tracks) {
  const best = new Map();

  for (const track of tracks) {
    const key = `${basename(track.path)}:${track.bytes}`;
    const depth = track.path.split(sep).length;
    const held = best.get(key);

    if (!held || depth < held.depth) {
      best.set(key, { ...track, depth, copies: (held?.copies ?? 0) + 1 });
    } else {
      held.copies += 1;
    }
  }

  return [...best.values()]
    .map(({ depth, ...track }) => track)
    .sort((a, b) => b.seconds - a.seconds);
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
  const dir = argv.find((a) => !a.startsWith("--")) ?? ".";
  const tracks = await findMusic(dir, argv.includes("--beats"));

  const jsonAt = argv.indexOf("--json");
  if (jsonAt >= 0 && argv[jsonAt + 1]) {
    writeFileSync(argv[jsonAt + 1], JSON.stringify(tracks, null, 2));
  }

  if (tracks.length === 0) {
    console.log("no audio files found — ask the user for a path");
  } else {
    const music = tracks.filter((t) => t.likelyTrack);
    console.log(
      `${tracks.length} distinct audio file(s), ${music.length} long enough to be music:\n`,
    );
    for (const track of tracks) {
      const mark = track.likelyTrack ? "♪" : " ";
      const beat = track.bpm
        ? `  ${String(track.bpm).padStart(6)} BPM (conf ${track.confidence})`
        : "";
      const copies = track.copies > 1 ? `  (${track.copies} copies)` : "";
      console.log(
        `  ${mark} ${String(Math.round(track.seconds)).padStart(4)}s  ${track.path}${beat}${copies}`,
      );
    }
  }
}
