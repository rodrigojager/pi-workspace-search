import { pathToFileURL } from 'node:url';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
// Public SDK only. Isolated settings and an in-memory session: no user auth writes or inference.
const host = process.argv[2]; if (!host) throw new Error('Usage: node tools/verify-pi.mjs /path/to/pi-coding-agent [package-directory]');
const { DefaultResourceLoader, SettingsManager, SessionManager, createAgentSession } = await import(pathToFileURL(path.join(host,'dist/index.js')).href);
const packageDir = path.resolve(process.argv[3] ?? '.');
const temp = await mkdtemp(path.join(os.tmpdir(),'pi-search-sdk-')); let session;
try {
  const cwd=path.join(temp,'workspace'), agentDir=path.join(temp,'agent'); await mkdir(cwd); await mkdir(agentDir);
  await writeFile(path.join(cwd,'fixture.js'),'function retryHttp() { return fetch("example"); }\n');
  const settingsManager=SettingsManager.inMemory({packages:[],defaultProjectTrust:'always'});
  const resourceLoader=new DefaultResourceLoader({cwd,agentDir,settingsManager,additionalExtensionPaths:[path.join(packageDir,'extensions/index.ts')],additionalSkillPaths:[path.join(packageDir,'skills')],noPromptTemplates:true,noThemes:true});
  await resourceLoader.reload();
  const loaded=resourceLoader.getExtensions(); assert.deepEqual(loaded.errors,[], 'extension load errors');
  const created=await createAgentSession({cwd,agentDir,settingsManager,resourceLoader,sessionManager:SessionManager.inMemory(cwd),sessionStartEvent:false}); session=created.session;
  const tools=session.getAllTools();
  for(const name of ['workspace_search','workspace_expand']) assert.ok(tools.some(t=>t.name===name),`missing ${name}`);
  const active=session.agent.state.tools;
  const search=active.find(t=>t.name==='workspace_search'); assert.ok(search,'tool not active');
  const result=await search.execute('sdk-smoke',{query:'retryHttp',mode:'exact'},new AbortController().signal);
  assert.match(result.content[0].text,/fixture.js/); assert.equal(result.details.backend,'ripgrep');
  const expanded=await active.find(t=>t.name==='workspace_expand').execute('sdk-expand',{file:'fixture.js',startLine:1,endLine:1},new AbortController().signal);
  assert.match(expanded.content[0].text,/retryHttp/);
  assert.ok(resourceLoader.getSkills().skills.some(s=>s.name==='workspace-search'));
  const runner=session.extensionRunner;
  const names=['search','search-setup','search-status','search-settings','search-index','search-test'];
  for(const name of names) assert.ok(runner.getCommand(name),`missing command ${name}`);
  const notifications=[];const editor=[];
  const ui={...runner.getUIContext(),notify:(text,type)=>notifications.push({text,type}),setEditorText:text=>editor.push(text),select:async()=> 'Configure Jev API key'};
  runner.setUIContext(ui,'tui');
  await runner.getCommand('search-status').handler('',runner.createCommandContext());assert.match(notifications.at(-1).text,/remoteEnabledForWorkspace/);
  await runner.getCommand('search-setup').handler('',runner.createCommandContext());assert.equal(editor.at(-1),'/login typesafe');
  await runner.getCommand('search').handler('--exact retryHttp',runner.createCommandContext());assert.match(notifications.at(-1).text,/fixture.js/);
  console.log(JSON.stringify({piSdk:'passed',tools:['workspace_search','workspace_expand'],commands:names,skill:'workspace-search',nativeLoginHandoff:'passed',networkInference:false}));
} finally { session?.dispose(); await rm(temp,{recursive:true,force:true}); }
