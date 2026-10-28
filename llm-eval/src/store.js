// Tiny JSON-file persistence layer. No database: everything the tool knows about
// providers, prompts, and runs lives in ./data as plain JSON so results stay
// portable and diff-friendly.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// DATA_DIR defaults to ./data but can be redirected (e.g. for tests or to keep
// several independent eval workspaces) via the LLM_EVAL_DATA_DIR env var.
export const DATA_DIR = process.env.LLM_EVAL_DATA_DIR
  ? path.resolve(process.env.LLM_EVAL_DATA_DIR)
  : path.resolve(here, '..', 'data');
export const RUNS_DIR = path.join(DATA_DIR, 'runs');
export const PUBLIC_DIR = path.resolve(here, '..', 'public');

export async function ensureDirs() {
  await fs.mkdir(RUNS_DIR, { recursive: true });
}

/** Read a JSON file, returning `fallback` when it does not exist. */
export async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

/** Write JSON atomically (write to temp, then rename) to avoid half-written files. */
export async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  await fs.rename(tmp, file);
}

export function newId(prefix = '') {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}${Date.now().toString(36)}${rand}`;
}
