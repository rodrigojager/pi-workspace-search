import { pathToFileURL } from 'node:url';
// Isolated process: native module failures and stuck embedding loaders cannot block Pi.
let service;
try {
  const [entry, raw] = process.argv.slice(2); const request = JSON.parse(raw);
  const { createZvecGrep } = await import(pathToFileURL(entry).href);
  service = await createZvecGrep({ root: request.root, ...(request.action === 'index' ? { embedding: 'local/potion-code-16m-v2' } : {}) });
  const info = await service.info({ root: request.root });
  const embedding = info.workspaceIndex?.embedding;
  const provider = typeof embedding === 'string' ? embedding.split('/')[0] : embedding?.provider;
  if (provider && provider !== 'local') throw new Error('Existing index uses remote embeddings; only local embeddings are allowed');
  if (request.action === 'status') {
    process.stdout.write(JSON.stringify({ indexed: info.indexed, local: !provider || provider === 'local' }));
  } else if (request.action === 'index') {
    if (info.indexed) throw new Error('Index already exists. Manage rebuilds explicitly with zg; this command never rebuilds.');
    const result = await service.index({ root: request.root, follow: false });
    process.stdout.write(JSON.stringify({ indexed: true, result }));
  } else {
    if (!info.indexed) throw new Error('No existing zvec index for this workspace');
    const result = await service.context({ root: request.root, query: request.query, limit: request.limit, autoUpdate: false, includePaths: [request.scope ?? request.root] });
    process.stdout.write(JSON.stringify(result));
  }
} catch (e) {
  process.stdout.write(JSON.stringify({ error: e.message }));
} finally { await service?.close(); }
