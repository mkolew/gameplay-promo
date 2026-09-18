#!/usr/bin/env node
/**
 * Runs a promo's shot commands and verifies what came back.
 *
 *   node film.mjs <plan.json> [--out-dir promo-output]
 *
 * The plan lists shots; each shot is a command the project supplies. This runs them one at a time,
 * then checks every output before anything downstream touches it.
 *
 * The checking is the point. A capture that fails silently — a window that never opened, a scene
 * that errored on frame one, a flag the engine ignored — produces a file that exists, has the right
 * duration, and is entirely black. Editing that costs a full render before anyone notices, so each
 * clip is measured here instead: resolution, frame rate, duration, and whether the middle of it has
 * any light in it at all.
 */

import { execFile, spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Anything darker than this, averaged over a frame, is a capture that did not draw. */
const BLACK_LUMA = 6;

/** An interactive take shorter than this is someone quitting, not someone playing. */
const MIN_INTERACTIVE_S = 4;

/**
 * Tells the player what is about to happen, and waits for them to be ready.
 *
 * Interactive shots open a window the user then plays. Launching that unannounced is startling, and
 * the take is usually wasted because they are still reading rather than flying.
 *
 * @param {{ name: string, seconds: number }} shot
 * @returns {Promise<void>}
 */
function readyPrompt(shot) {
  process.stdout.write(
    `\n  shot "${shot.name}" is yours to play.\n` +
      `  A window will open and recording starts immediately.\n` +
      `  Play for about ${shot.seconds}s, then quit the game to end the take.\n\n` +
      `  Note the game will feel slower than usual while recording — every frame is\n` +
      `  encoded as it is drawn. The finished video plays at full speed.\n\n` +
      `  Press Enter when ready. `,
  );

  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => {
      process.stdin.pause();
      resolve();
    });
  });
}

/**
 * Runs one shot command, writing to `out`.
 *
 * `{{out}}` and `{{frames}}` are substituted if present; otherwise the contract's flags are
 * appended. Projects differ enough that forcing one shape would exclude the simple cases.
 *
 * Inherits stdio so an engine's own errors reach the operator as they happen rather than being
 * swallowed and reported as "capture failed".
 *
 * @param {{ name: string, command: string, seconds: number, fps?: number }} shot
 * @param {string} out
 * @returns {Promise<void>}
 */
function capture(shot, out) {
  const fps = shot.fps ?? 60;
  const frames = Math.round(shot.seconds * fps);

  let command = shot.command;
  if (command.includes("{{out}}")) {
    command = command
      .replaceAll("{{out}}", out)
      .replaceAll("{{frames}}", String(frames));
  } else {
    command = `${command} --out ${JSON.stringify(out)} --seconds ${shot.seconds}`;
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`shot "${shot.name}" exited ${code}`)),
    );
  });
}

/**
 * What ffprobe says about a clip.
 *
 * @param {string} path
 * @returns {Promise<{ width: number, height: number, fps: number, seconds: number }>}
 */
async function probe(path) {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,r_frame_rate",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    path,
  ]);

  const data = JSON.parse(stdout);
  const stream = data.streams?.[0] ?? {};
  const [num, den] = String(stream.r_frame_rate ?? "0/1")
    .split("/")
    .map(Number);

  return {
    width: Number(stream.width ?? 0),
    height: Number(stream.height ?? 0),
    fps: den ? num / den : 0,
    seconds: Number(data.format?.duration ?? 0),
  };
}

/**
 * Average luma of one frame, via ffmpeg's own signalstats.
 *
 * Sampled from the middle rather than the start: the first frames of a capture are legitimately
 * dark in most games — a fade-in, a splash, an empty sky — and judging on frame zero would reject
 * good footage while passing a clip that dies after its opening shot.
 *
 * @param {string} path
 * @param {number} at
 * @returns {Promise<number>}
 */
async function luma(path, at) {
  const { stderr } = await run("ffmpeg", [
    "-v",
    "info",
    "-ss",
    String(at),
    "-i",
    path,
    "-frames:v",
    "1",
    "-vf",
    "signalstats,metadata=print:key=lavfi.signalstats.YAVG",
    "-f",
    "null",
    "-",
  ]);

  const found = stderr.match(/YAVG=([0-9.]+)/);
  return found ? Number(found[1]) : 0;
}

/**
 * Captures every shot and returns the verified clips.
 *
 * Throws on the first bad clip rather than collecting failures: the shots are usually variations of
 * one command, so the second failure is nearly always the first one again.
 *
 * @param {object} plan
 * @param {string} outDir
 * @returns {Promise<Array<{ name: string, path: string, seconds: number }>>}
 */
export async function film(plan, outDir) {
  const clipDir = join(outDir, "clips");
  mkdirSync(clipDir, { recursive: true });

  const clips = [];
  for (const shot of plan.shots) {
    const path = join(clipDir, `${shot.name}.avi`);

    if (shot.interactive) {
      await readyPrompt(shot);
      process.stdout.write(`shot ${shot.name}: recording until you quit\n`);
    } else {
      process.stdout.write(`shot ${shot.name}: capturing ${shot.seconds}s\n`);
    }

    await capture(shot, path);

    const info = await probe(path);
    const middle = await luma(path, info.seconds / 2);

    const problems = [];
    if (info.width < 640 || info.height < 360) {
      problems.push(
        `resolution ${info.width}x${info.height} is too small to publish`,
      );
    }
    /*
     * A played take is however long the player made it, so there is no target to fall short of —
     * only a floor that catches the window being closed before anything happened.
     */
    if (shot.interactive) {
      if (info.seconds < MIN_INTERACTIVE_S) {
        problems.push(
          `only ${info.seconds.toFixed(2)}s recorded — was the game quit straight away?`,
        );
      }
    } else if (info.seconds < shot.seconds * 0.5) {
      problems.push(
        `only ${info.seconds.toFixed(2)}s of the ${shot.seconds}s asked for`,
      );
    }
    if (middle < BLACK_LUMA) {
      problems.push(
        `the middle frame is black (average luma ${middle.toFixed(1)}) — did it draw?`,
      );
    }
    if (problems.length > 0) {
      throw new Error(
        `shot "${shot.name}" is unusable:\n  - ${problems.join("\n  - ")}`,
      );
    }

    process.stdout.write(
      `  ok ${info.width}x${info.height} @ ${info.fps.toFixed(0)}fps, ` +
        `${info.seconds.toFixed(2)}s, luma ${middle.toFixed(0)}\n`,
    );
    clips.push({ name: shot.name, path, seconds: info.seconds });
  }

  return clips;
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
    console.error("usage: node film.mjs <plan.json> [--out-dir promo-output]");
    process.exit(2);
  }

  const outAt = argv.indexOf("--out-dir");
  const outDir = outAt >= 0 ? argv[outAt + 1] : "promo-output";
  const plan = JSON.parse(readFileSync(planPath, "utf8"));

  const clips = await film(plan, outDir);
  console.log(`\n${clips.length} clip(s) ready in ${join(outDir, "clips")}`);
  for (const clip of clips) {
    console.log(`  ${basename(clip.path)}  ${clip.seconds.toFixed(2)}s`);
  }
}
