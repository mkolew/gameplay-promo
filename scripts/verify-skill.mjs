#!/usr/bin/env node
/**
 * Validate this repository's one skill and the manifests that publish it:
 *  - skills/gameplay-promo/SKILL.md has frontmatter whose `name` matches the directory,
 *    a description within the 1024-char limit installers enforce, and a real body
 *  - every reference and script SKILL.md points at exists
 *  - .claude-plugin/plugin.json and marketplace.json parse, and agree on the name
 *  - every relative link and image in README.md resolves
 * Exit code 1 on any failure (CI-friendly).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SKILL = 'gameplay-promo';
const SKILL_DIR = join(ROOT, 'skills', SKILL);

const problems = [];

/**
 * Read a JSON file, recording a problem rather than throwing when it is missing or malformed.
 *
 * @param {string} path repo-relative path to the file.
 * @returns {object | null} the parsed value, or null when it could not be read.
 */
function readJson(path) {
  if (!existsSync(join(ROOT, path))) {
    problems.push(`${path}: missing`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
  } catch (err) {
    problems.push(`${path}: invalid JSON (${err.message})`);
    return null;
  }
}

// SKILL.md — the only file the agent is guaranteed to read.
const skillFile = join(SKILL_DIR, 'SKILL.md');
let skillBody = '';
if (!existsSync(skillFile)) {
  problems.push(`skills/${SKILL}/SKILL.md: missing`);
} else {
  const content = readFileSync(skillFile, 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(content);
  if (!match) {
    problems.push(`skills/${SKILL}/SKILL.md: missing frontmatter block`);
  } else {
    const fields = {};
    for (const line of match[1].split('\n')) {
      const kv = /^([A-Za-z][\w-]*):(.*)$/.exec(line);
      if (kv) fields[kv[1]] = kv[2].trim();
    }
    skillBody = match[2];

    if (fields.name !== SKILL) {
      problems.push(
        `skills/${SKILL}/SKILL.md: name "${fields.name}" does not match directory "${SKILL}"`,
      );
    }
    if (!fields.description) {
      problems.push(`skills/${SKILL}/SKILL.md: missing "description"`);
    } else if (fields.description.length > 1024) {
      problems.push(
        `skills/${SKILL}/SKILL.md: description exceeds 1024 characters (${fields.description.length})`,
      );
    }
    if (skillBody.trim().length < 100) {
      problems.push(`skills/${SKILL}/SKILL.md: body looks empty`);
    }
  }
}

// Files SKILL.md sends the agent to. A reference that moved is invisible until an agent
// follows the link mid-run and finds nothing there.
for (const [, path] of skillBody.matchAll(
  /\b((?:references|scripts)\/[\w.-]+\.(?:md|mjs))/g,
)) {
  if (!existsSync(join(SKILL_DIR, path))) {
    problems.push(
      `skills/${SKILL}/SKILL.md: points at "${path}", which does not exist`,
    );
  }
}

// Every reference file should be reachable from SKILL.md, or nothing will ever open it.
const referencesDir = join(SKILL_DIR, 'references');
if (existsSync(referencesDir)) {
  for (const file of readdirSync(referencesDir)) {
    if (!skillBody.includes(`references/${file}`)) {
      problems.push(
        `skills/${SKILL}/references/${file}: never referenced from SKILL.md`,
      );
    }
  }
}

// The manifests: one malformed field breaks every install, and breaks it silently.
const plugin = readJson('.claude-plugin/plugin.json');
if (plugin) {
  if (plugin.name !== SKILL)
    problems.push(`.claude-plugin/plugin.json: "name" must be "${SKILL}"`);
  if (!plugin.description)
    problems.push('.claude-plugin/plugin.json: missing "description"');
  if (!plugin.version)
    problems.push('.claude-plugin/plugin.json: missing "version"');
  if (!plugin.author?.name)
    problems.push('.claude-plugin/plugin.json: missing "author.name"');
}

const marketplace = readJson('.claude-plugin/marketplace.json');
if (marketplace) {
  if (!marketplace.owner?.name)
    problems.push('.claude-plugin/marketplace.json: missing "owner.name"');
  const entries = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
  const entry = entries.find((candidate) => candidate.name === SKILL);
  if (!entry) {
    problems.push(
      `.claude-plugin/marketplace.json: no plugin entry named "${SKILL}"`,
    );
  } else if (entry.source !== './') {
    problems.push(
      `.claude-plugin/marketplace.json: plugin "${SKILL}" source must be "./" (this repo is the plugin)`,
    );
  }
}

// README links. The images are the whole point of the README, and a moved asset shows as
// a broken-image icon that nobody notices until someone else opens the page.
if (existsSync(join(ROOT, 'README.md'))) {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const targets = [
    ...[...readme.matchAll(/]\(([^)]+)\)/g)].map(([, target]) => target),
    ...[...readme.matchAll(/src="([^"]+)"/g)].map(([, target]) => target),
  ];
  for (const target of targets) {
    if (/^(https?:|#|mailto:)/.test(target)) continue;
    if (!existsSync(join(ROOT, target.split('#')[0]))) {
      problems.push(`README.md: link "${target}" does not resolve`);
    }
  }
}

if (problems.length > 0) {
  console.error('Skill verification failed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(
  `Skill "${SKILL}" valid: SKILL.md, references, scripts, manifests, README links.`,
);
