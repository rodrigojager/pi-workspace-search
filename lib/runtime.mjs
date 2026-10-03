import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { rgPath as bundledRgPath } from '@vscode/ripgrep';

export const defaults = Object.freeze({ remoteRoots: [], model: 'jev-latest', threshold: 0.72, maxChunks: 60, maxInputChars: 120000, maxOutputChars: 8000, maxHits: 7, concurrency: 3, timeoutMs: 30000, cacheHours: 4 });
export const homeFor = agentDir => path.join(agentDir, 'workspace-search');
export function run(command, args, { cwd, signal, timeoutMs = 30000, maxBytes = 2000000, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    let child, timer, size = 0, stdout = '', stderr = '', settled = false;
    const finish = (err, code) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); err ? reject(err) : resolve({ code, stdout, stderr }); };
    const stop = message => { child?.kill(); finish(new Error(message)); };
    const abort = () => stop('Cancelled');
    if (signal?.aborted) return finish(new Error('Cancelled'));
    try { child = spawn(command, args, { cwd, env, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return finish(e); }
    timer = setTimeout(() => stop(`Process timed out after ${timeoutMs}ms`), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    for (const [stream, name] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) {
      stream.setEncoding('utf8'); stream.on('data', chunk => { size += Buffer.byteLength(chunk); if (size > maxBytes) return stop('Process output exceeded limit'); if (name === 'stdout') stdout += chunk; else stderr += chunk; });
    }
    child.on('error', e => finish(e)); child.on('close', code => finish(null, code));
  });
}
export async function readConfig(home) {
  let saved;
  try { saved = JSON.parse(await readFile(path.join(home, 'settings.json'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw new Error('Invalid workspace-search settings.json'); }
  const c = { ...defaults, ...saved };
  for (const [k, min, max] of [['threshold', 0, 1], ['maxChunks', 1, 500], ['maxInputChars', 1000, 2000000], ['maxOutputChars', 1000, 20000], ['maxHits', 1, 20], ['concurrency', 1, 6], ['timeoutMs', 1000, 120000], ['cacheHours', 0, 24]]) {
    if (!Number.isFinite(c[k]) || c[k] < min || c[k] > max) throw new Error(`Invalid setting: ${k}`);
    if (!['threshold','cacheHours'].includes(k) && !Number.isInteger(c[k])) throw new Error(`Invalid integer setting: ${k}`);
  }
  if (!Array.isArray(c.remoteRoots) || !c.remoteRoots.every(x => typeof x === 'string')) throw new Error('Invalid remoteRoots');
  if (typeof c.model !== 'string' || !c.model.length) throw new Error('Invalid model');
  return c;
}
export async function saveConfig(home, config) {
  await mkdir(home, { recursive: true });
  const temp = path.join(home, `settings-${process.pid}-${Date.now()}.tmp`);
  await writeFile(temp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  await rename(temp, path.join(home, 'settings.json'));
}
const require = createRequire(import.meta.url);
export function rgPath() { return bundledRgPath; }
export function zvecEntry(home) {
  const prefixes = [path.join(home, 'runtime'), path.resolve(path.dirname(process.execPath), '..'), process.env.APPDATA && path.join(process.env.APPDATA, 'npm'), path.join(os.homedir(), '.npm-global')].filter(Boolean);
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) if (dir) prefixes.push(dir, path.resolve(dir, '..'));
  for (const prefix of prefixes) {
    const entry = path.join(prefix, 'node_modules', '@zvec', 'zvec-grep', 'dist', 'index.js');
    if (existsSync(entry)) return entry;
  }
  try { return require.resolve('@zvec/zvec-grep'); } catch { return undefined; }
}
export async function zvecCall(entry, request, options = {}) {
  if (!entry) throw new Error('zvec-grep not found (optional, recommended)');
  const r = await run(process.execPath, ['--liftoff-only', fileURLToPath(new URL('./zvec-worker.mjs', import.meta.url)), entry, JSON.stringify(request)], { ...options, maxBytes: 500000 });
  if (r.code !== 0) throw new Error('zvec-grep could not run on this platform or workspace');
  let data; try { data = JSON.parse(r.stdout); } catch { throw new Error('Invalid zvec-grep response'); }
  if (data.error) throw new Error(data.error);
  return data;
}
export async function installZvec(home, signal) {
  const runtime = path.join(home, 'runtime'); await mkdir(runtime, { recursive: true });
  // Execute npm's JavaScript entry directly; never build a shell command from paths.
  const candidates = [path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), process.env.APPDATA && path.join(process.env.APPDATA, 'npm/node_modules/npm/bin/npm-cli.js')].filter(Boolean);
  const npm = candidates.find(existsSync);
  if (!npm) throw new Error('npm not found; install Node.js with npm, then run setup again');
  const result = await run(process.execPath, [npm, 'install', '--prefix', runtime, '--no-audit', '--no-fund', '--no-save', '@zvec/zvec-grep@0.2.2'], { timeoutMs: 600000, maxBytes: 1000000, signal });
  if (result.code !== 0) throw new Error('Optional zvec installation failed. Search remains available with ripgrep and Jev.');
  return zvecEntry(home);
}
