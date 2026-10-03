import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,realpath,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {defaults} from '../lib/runtime.mjs';
import {search} from '../lib/search.mjs';
test('continuation reaches evidence beyond the first budget window',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'pi-search-pages-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const root=await realpath(dir);const home=path.join(dir,'.state');await mkdir(home);
  await writeFile(path.join(root,'source.js'),'early\n'.repeat(100)+'LATE_RETRY_IMPLEMENTATION\n');
  const deps={home,config:{...defaults,maxChunks:1,concurrency:1,remoteRoots:[root]},classify:async req=>({stopReason:'stop',answers:{relevant:{type:'bool',probability:req.state.source.includes('LATE_RETRY')?0.99:0.01}}})};
  let offset=0,result;
  for(let page=0;page<6;page++){
    result=await search({root,query:'retry',backend:'jev',scope:'source.js',offset},deps);
    if(result.data.hits.length)break;
    assert.ok(result.data.nextOffset>offset);offset=result.data.nextOffset;
  }
  assert.match(result.text,/LATE_RETRY_IMPLEMENTATION/); assert.ok(offset>0);
});
