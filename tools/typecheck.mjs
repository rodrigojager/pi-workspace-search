import path from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {run} from '../lib/runtime.mjs';
const host=process.argv[2]; if(!host)throw new Error('Pass installed Pi package directory');
await mkdir('.validation',{recursive:true});
const config={compilerOptions:{target:'ES2023',module:'NodeNext',moduleResolution:'NodeNext',strict:true,noEmit:true,allowJs:true,checkJs:false,skipLibCheck:true,paths:{'@earendil-works/pi-coding-agent':[path.join(host,'dist/index.d.ts')],'@earendil-works/pi-ai':[path.join(host,'node_modules/@earendil-works/pi-ai/dist/index.d.ts')]},typeRoots:[path.join(host,'node_modules/@types')]},include:['../extensions/index.ts']};
await writeFile('.validation/tsconfig.json',JSON.stringify(config,null,2));
const r=await run(process.execPath,['node_modules/typescript/bin/tsc','-p','.validation/tsconfig.json'],{maxBytes:100000}); console.log(r.stdout+r.stderr);process.exitCode=r.code;
