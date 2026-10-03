import { Type } from '@earendil-works/pi-ai';
import { defineTool, getAgentDir, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { realpath } from 'node:fs/promises';
import { homeFor, readConfig, saveConfig, zvecEntry, zvecCall, installZvec } from '../lib/runtime.mjs';
import { search, expand } from '../lib/search.mjs';

export default function workspaceSearch(pi: ExtensionAPI) {
  const home = homeFor(getAgentDir());
  async function dependencies(ctx: ExtensionContext) {
    const config = await readConfig(home);
    const model = ctx.modelRegistry.findOfType('classifier', 'typesafe', config.model);
    const authenticated = ctx.modelRegistry.getProviderAuthStatus('typesafe').configured;
    return { config, home, localSearch: undefined, classify: model && authenticated ? (request: any, options: any) => ctx.modelRegistry.classify(model, request, options) : undefined };
  }
  function output(result: any) { return { content: [{ type: 'text' as const, text: result.text }], details: result.data }; }
  async function status(ctx: ExtensionContext) {
    const { config } = await dependencies(ctx); const root = await realpath(ctx.cwd); const entry = zvecEntry(home);
    const auth = ctx.modelRegistry.getProviderAuthStatus('typesafe');
    return { root, zvec: entry ? 'installed; existing local index required' : 'not found; optional and recommended', jev: { model: config.model, catalogAvailable: !!ctx.modelRegistry.findOfType('classifier', 'typesafe', config.model), auth, remoteEnabledForWorkspace: config.remoteRoots.includes(root) }, limits: { maxChunks: config.maxChunks, maxInputChars: config.maxInputChars, maxOutputChars: config.maxOutputChars, maxHits: config.maxHits }, settingsDirectory: home };
  }
  pi.registerTool(defineTool({
    name: 'workspace_search', label: 'Workspace search',
    description: 'Find bounded original workspace evidence. Exact/regex uses ripgrep. Semantic uses an existing local zvec index, then Jev classification when enabled. No generative subagent. Ranked/partial results never prove absence.',
    promptSnippet: 'Bounded workspace evidence using ripgrep, optional local zvec, then Jev.',
    promptGuidelines: ['Before reading many workspace files, use workspace_search. Select exact for literals and regex for patterns; select semantic for unknown wording or relationships.', 'Treat sufficient snippets as already read. Use workspace_expand only for missing detail. Refine scope or backend="jev" if local ranking is insufficient. Use native exploration only when retrieval cannot establish the required evidence.'],
    parameters: Type.Object({ query: Type.String({ minLength: 1, maxLength: 1000 }), mode: Type.Optional(Type.Union([Type.Literal('exact'), Type.Literal('regex'), Type.Literal('semantic')])), scope: Type.Optional(Type.String({ description: 'File or directory relative to current workspace; narrow scope when coverage is partial.' })), backend: Type.Optional(Type.Union([Type.Literal('auto'), Type.Literal('zvec'), Type.Literal('jev')])), offset: Type.Optional(Type.Integer({ minimum: 0, description: 'Jev chunk offset for continuation; use nextOffset with identical query and scope. Each page has its own budget.' })) }),
    async execute(_id, params, signal, _update, ctx) {
      return output(await search({ root: ctx.cwd, ...params, signal }, await dependencies(ctx)));
    }
  }));
  pi.registerTool(defineTool({
    name: 'workspace_expand', label: 'Expand workspace evidence', description: 'Read 1-200 lines of a specific workspace file with a bounded output. Current source, no classifier calls.',
    parameters: Type.Object({ file: Type.String(), startLine: Type.Optional(Type.Integer({ minimum: 1 })), endLine: Type.Optional(Type.Integer({ minimum: 1 })) }),
    async execute(_id, params, _signal, _update, ctx) { return output(await expand({ root: await realpath(ctx.cwd), ...params }, (await dependencies(ctx)).config)); }
  }));
  pi.registerCommand('search-status', { description: 'Show search backends, authentication status and budgets (no inference)', handler: async (_args, ctx) => {
    ctx.ui.notify(JSON.stringify(await status(ctx), null, 2), 'info');
  } });
  pi.registerCommand('search-setup', { description: 'Configure Jev within Pi and optionally install zvec-grep', handler: async (_args, ctx) => {
    if (!ctx.hasUI || ctx.mode !== 'tui') { ctx.ui.notify('Run /search-setup in interactive Pi. Native /login typesafe configures the key; TYPESAFE_API_KEY is supported for headless use.', 'info'); return; }
    const root = await realpath(ctx.cwd); const config = await readConfig(home);
    const action = await ctx.ui.select('Workspace search setup', ['Configure Jev API key', config.remoteRoots.includes(root) ? 'Disable Jev for this workspace' : 'Enable Jev for this workspace', 'Install optional zvec-grep', 'Status']);
    if (action === 'Configure Jev API key') {
      // Native Pi login owns credential persistence, secret UI and provider validation.
      ctx.ui.setEditorText('/login typesafe');
      ctx.ui.notify('Press Enter to open native Pi TypeSafe login. Afterwards run /search-setup to enable Jev for this workspace.', 'info');
    } else if (action?.includes('Jev for this workspace')) {
      if (action.startsWith('Enable') && !(await ctx.ui.confirm('Enable Jev?', `Selected source snippets from ${root} will be sent to TypeSafe for classification. Files excluded by ignore rules and the default sensitive-path filter are skipped. This filter cannot detect every embedded secret. Enable?`))) return;
      config.remoteRoots = action.startsWith('Enable') ? [...new Set([...config.remoteRoots, root])] : config.remoteRoots.filter((r: string) => r !== root);
      await saveConfig(home, config); await updateIndicator(ctx);
      ctx.ui.notify(action.startsWith('Enable') ? 'Jev enabled for this workspace. Use /search-test to verify.' : 'Jev disabled for this workspace.', 'info');
    } else if (action === 'Install optional zvec-grep') {
      if (zvecEntry(home)) { ctx.ui.notify('zvec-grep already found. Use /search-index to create a local index explicitly.', 'info'); return; }
      if (!(await ctx.ui.confirm('Install optional zvec-grep?', 'Download zvec-grep 0.2.2 and its dependencies into the extension-managed Pi runtime? Native support depends on the platform. Search continues without it if installation fails.'))) return;
      ctx.ui.notify('Installing optional zvec-grep. This may take a few minutes.', 'info');
      try { await installZvec(home); await updateIndicator(ctx); ctx.ui.notify('zvec installed. Use /search-index explicitly to create a local index.', 'info'); }
      catch (e: any) { ctx.ui.notify(e.message, 'warning'); }
    } else if (action === 'Status') ctx.ui.notify(JSON.stringify(await status(ctx), null, 2), 'info');
  } });
  pi.registerCommand('search-index', { description: 'Explicitly create a new local zvec index for the current workspace; never rebuild', handler: async (_args, ctx) => {
    if (!ctx.hasUI || ctx.mode !== 'tui') { ctx.ui.notify('Index creation requires interactive /search-index.', 'warning'); return; }
    const root = await realpath(ctx.cwd); const entry = zvecEntry(home);
    if (!entry) { ctx.ui.notify('zvec is optional and not installed. /search-setup offers installation; Jev works without it.', 'warning'); return; }
    if (!(await ctx.ui.confirm('Create local index?', `Create a persistent local-embedding index for ${root}? This may download a local model. No existing index will be rebuilt.`))) return;
    ctx.ui.notify('Creating local index...', 'info');
    try { await zvecCall(entry, { action: 'index', root }, { timeoutMs: 600000 }); ctx.ui.notify('Local index created.', 'info'); }
    catch (e: any) { ctx.ui.notify(e.message, 'warning'); }
  } });
  pi.registerCommand('search-settings', { description: 'Change search budgets and relevance threshold', handler: async (_args, ctx) => {
    if (!ctx.hasUI || ctx.mode !== 'tui') { ctx.ui.notify(`Settings: ${home}/settings.json`, 'info'); return; }
    const config = await readConfig(home);
    const key = await ctx.ui.select('Search setting', ['maxChunks', 'maxInputChars', 'maxOutputChars', 'maxHits', 'threshold']);
    if (!key) return; const value = await ctx.ui.input(key, String(config[key])); if (!value) return;
    const next = { ...config, [key]: Number(value) };
    // Same validation as disk config, without overwriting valid settings on bad input.
    const bounds: Record<string, [number, number]> = { maxChunks: [1,500], maxInputChars: [1000,2000000], maxOutputChars: [1000,20000], maxHits: [1,20], threshold: [0,1] };
    const [min,max] = bounds[key]; if (!Number.isFinite(next[key]) || next[key] < min || next[key] > max || (key !== 'threshold' && !Number.isInteger(next[key]))) { ctx.ui.notify(`Use ${key === 'threshold' ? 'a number' : 'an integer'} between ${min} and ${max}.`, 'warning'); return; }
    await saveConfig(home, next); ctx.ui.notify('Search setting saved.', 'info');
  } });
  pi.registerCommand('search-test', { description: 'Make one synthetic Jev call; never upload workspace files', handler: async (_args, ctx) => {
    const deps = await dependencies(ctx); if (!deps.classify) { ctx.ui.notify('Jev needs the TypeSafe classifier in this Pi catalog and an API key. Configure with /search-setup or native /login typesafe.', 'warning'); return; }
    ctx.ui.notify('Testing Jev using synthetic source...', 'info');
    const response = await deps.classify({ state: { query: 'retry failed HTTP requests', source: 'async function fetchWithRetry() { for (let i=0;i<3;i++) { try { return await fetch(url); } catch {} } }' }, questions: { relevant: { type: 'bool', instructions: 'Does the source implement retrying HTTP requests?', criteria: { true: 'Implements HTTP retry.', false: 'Does not implement HTTP retry.' } } } }, { signal: AbortSignal.timeout(deps.config.timeoutMs) });
    if (response.stopReason !== 'stop') ctx.ui.notify('Jev test failed. Check native /login typesafe, connectivity and account access.', 'warning');
    else {
      const answer = response.answers.relevant;
      if (answer?.type !== 'bool' || !Number.isFinite(answer.probability)) ctx.ui.notify('Jev test returned an invalid classifier answer.', 'warning');
      else ctx.ui.notify(`Jev test succeeded. Relevance probability: ${answer.probability}`, 'info');
    }
  } });
  pi.registerCommand('search', { description: 'Search directly without a generative model: /search [--exact|--regex] query', handler: async (args, ctx) => {
    const match = args.match(/^--(exact|regex)\s+/); const mode = match?.[1] ?? 'semantic'; const query = match ? args.slice(match[0].length) : args;
    if (!query.trim()) { ctx.ui.notify('Usage: /search [--exact|--regex] query', 'info'); return; }
    ctx.ui.notify((await search({ root: ctx.cwd, query, mode, signal: undefined }, await dependencies(ctx))).text, 'info');
  } });
  async function updateIndicator(ctx: ExtensionContext) {
    const config = await readConfig(home); const root = await realpath(ctx.cwd);
    ctx.ui.setStatus('workspace-search', `search: ${zvecEntry(home) ? 'zvec' : 'zvec optional: missing'} · Jev ${config.remoteRoots.includes(root) ? 'enabled' : 'off'}`);
  }
  pi.on('session_start', async (_event, ctx) => { try { await updateIndicator(ctx); } catch { ctx.ui.notify('Invalid workspace-search configuration. Check /search-status settings path.', 'warning'); } });
}
