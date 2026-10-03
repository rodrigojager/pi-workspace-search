import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, realpath, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { search, expand, chunksOf, formatResult, safePath } from '../lib/search.mjs';
import { defaults, readConfig, saveConfig, run } from '../lib/runtime.mjs';

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pi-search-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const root = path.join(dir,'workspace'); const home = path.join(dir,'state'); await mkdir(root); await mkdir(home);
  await writeFile(path.join(root, 'retry.js'), 'async function fetchWithRetry(url) {\n  for (let i = 0; i < 3; i++) {\n    try { return await fetch(url); } catch {}\n  }\n}\n');
  await writeFile(path.join(root, 'unrelated.md'), 'Colors and typography.');
  await writeFile(path.join(root,'.env'), 'API_SECRET=hidden');
  await writeFile(path.join(root,'.gitignore'), 'ignored.js\n'); await writeFile(path.join(root,'ignored.js'),'API_SECRET=hidden');
  return { root: await realpath(root), home, config: { ...defaults, remoteRoots: [await realpath(root)] }, localSearch: async () => { throw new Error('optional zvec absent'); } };
}
const relevant = probability => ({ stopReason: 'stop', answers: { relevant: { type: 'bool', probability } } });
test('exact lookup is local and ignores sensitive and ignored files', async t => {
  const f = await fixture(t); let calls = 0; f.classify = async () => { calls++; throw new Error('unexpected'); };
  const r = await search({ root:f.root, query:'fetchWithRetry', mode:'exact' },f);
  assert.equal(r.data.backend,'ripgrep'); assert.equal(calls,0); assert.equal(r.data.hits[0].file,'retry.js');
  const empty = await search({ root:f.root, query:'API_SECRET', mode:'exact' }, f); assert.deepEqual(empty.data.hits,[]);
});
test('usable local index evidence stops before Jev', async t => {
  const f = await fixture(t); f.localSearch = async () => ({ items:[{ file:{relativePath:'retry.js'}, range:{kind:'text',startLine:1,endLine:5},status:'fresh',score:0.9 }] });
  f.classify = async () => { throw new Error('must not call'); };
  const r = await search({root:f.root,query:'retry HTTP'},f); assert.equal(r.data.backend,'zvec'); assert.match(r.data.hits[0].content,/fetchWithRetry/);
});
test('missing zvec falls back to Jev, caches classification and invalidates changed source', async t => {
  const f = await fixture(t); let calls=0;
  f.classify = async req => { calls++; assert.ok(!req.state.source.includes('API_SECRET')); return relevant(req.state.source.includes('fetchWithRetry') ? 0.95 : 0.1); };
  const first = await search({ root:f.root,query:'retry HTTP' },f); assert.equal(first.data.backend,'jev'); assert.equal(first.data.hits.length,1); const count=calls;
  const second = await search({ root:f.root,query:'retry HTTP' },f); assert.equal(calls,count); assert.ok(second.data.stats.cacheHits>0);
  await writeFile(path.join(f.root,'retry.js'),'function fetchWithRetry() { return fetch(url); }');
  await search({ root:f.root,query:'retry HTTP' },f); assert.equal(calls,count+1);
});
test('Jev cannot upload any source before project opt-in', async t => {
  const f = await fixture(t); f.config.remoteRoots=[]; f.classify=async()=> { throw new Error('must not call'); };
  const r=await search({root:f.root,query:'retry HTTP'},f); assert.equal(r.data.stats.inputChars,0); assert.match(r.text,/disabled/);
});
test('budget stops remote requests and reports partial coverage', async t => {
  const f=await fixture(t); f.config.maxChunks=1; let calls=0; f.classify=async()=>{calls++;return relevant(0.9);};
  const r=await search({root:f.root,query:'retry HTTP'},f); assert.equal(calls,1); assert.equal(r.data.partial,true); assert.ok(r.data.stats.inputChars<=f.config.maxInputChars);
});
test('invalid classifier answer is an explicit failure, never a cached no-match', async t => {
  const f=await fixture(t); f.config.concurrency=1; f.classify=async()=>({stopReason:'error',answers:{}});
  const r=await search({root:f.root,query:'retry HTTP'},f); assert.equal(r.data.partial,true); assert.match(r.text,/classification failed/); assert.equal(r.data.stats.classified,1);
});
test('stale and out-of-scope local rankings trigger fallback',async t=>{
  const f=await fixture(t); f.classify=async()=>relevant(0.95);
  f.localSearch=async()=>({items:[{file:{relativePath:'retry.js'},range:{kind:'text',startLine:1,endLine:5},status:'possibly_stale'}]});
  const r=await search({root:f.root,query:'retry'},f); assert.equal(r.data.backend,'jev');
});
test('ancestor index paths are scoped and an invalid hit does not discard valid evidence',async t=>{
  const f=await fixture(t);
  f.localSearch=async()=>({root:path.dirname(f.root),items:[
    {file:{absolutePath:path.join(f.home,'missing.js')},range:{kind:'text',startLine:1,endLine:2},status:'fresh'},
    {file:{absolutePath:path.join(f.root,'retry.js'),relativePath:'workspace/retry.js'},range:{kind:'text',startLine:1,endLine:5},status:'fresh'}]});
  f.classify=async()=>{throw new Error('must not call');};
  const r=await search({root:f.root,query:'retry'},f);assert.equal(r.data.backend,'zvec');assert.equal(r.data.hits[0].file,'retry.js');
});
test('expand reads current bounded ranges and rejects escapes and secret paths',async t=>{
  const f=await fixture(t); const r=await expand({root:f.root,file:'retry.js',startLine:2,endLine:3},f.config); assert.equal(r.data.hits[0].startLine,2); assert.match(r.text,/fetch/);
  await assert.rejects(expand({root:f.root,file:'.env'},f.config),/Excluded/);
  await assert.rejects(safePath(f.root,'../state'),/inside/);
  await assert.rejects(expand({root:f.root,file:'retry.js',startLine:1,endLine:300},f.config),/1-200/);
  try { await symlink(f.home,path.join(f.root,'outside'),'junction'); } catch (e) { if(e.code==='EPERM') return; throw e; }
  await assert.rejects(safePath(f.root,'outside'),/outside/);
});
test('chunk windows cover long source lines without silently dropping their suffix',()=>{
  const source='a'.repeat(10000)+'SUFFIX\nnext'; const chunks=chunksOf(source,'long.txt'); assert.ok(chunks.some(c=>c.content.includes('SUFFIX'))); assert.ok(chunks.every(c=>c.content.length<=3500));
});
test('serialized output respects character budget even with JSON escaping',()=>{
  const r=formatResult({hits:Array.from({length:20},()=>({file:'a',content:'"\\\n'.repeat(3000)}))},{...defaults,maxOutputChars:1000}); assert.ok(r.text.length<=1000); assert.equal(r.data.outputTruncated,true);
});
test('settings roundtrip validates rather than accepting invalid budgets',async t=>{
  const f=await fixture(t); await saveConfig(f.home,f.config); assert.deepEqual(await readConfig(f.home),f.config);
  await saveConfig(f.home,{...f.config,maxChunks:-1}); await assert.rejects(readConfig(f.home),/Invalid/);
});
test('child process timeout and output cap settle with explicit errors',async()=>{
  await assert.rejects(run(process.execPath,['-e','setInterval(()=>{},1000)'],{timeoutMs:40}),/timed out/);
  await assert.rejects(run(process.execPath,['-e','process.stdout.write("a".repeat(10000))'],{maxBytes:10}),/exceeded/);
});
