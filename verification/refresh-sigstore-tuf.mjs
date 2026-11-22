#!/usr/bin/env node
// Explicit updater; audit scans never fetch. State must live in reviewer-controlled storage.
import fs from 'node:fs/promises';import path from 'node:path';import {createRequire} from 'node:module';import crypto from 'node:crypto';import {fetchRepository} from './tuf-source.mjs';
const require=createRequire(import.meta.url),tuf=require('./sigstore-tuf.cjs'),{sha256}=require('../analysis/execution-evidence.js');
const mirrors=new Set(['https://tuf-repo-cdn.sigstore.dev']);
async function read(file,max) {const h=await fs.open(file,require('node:fs').constants.O_RDONLY|require('node:fs').constants.O_NOFOLLOW);try {const stat=await h.stat();if(!stat.isFile() || stat.size>max) throw Error('file');return new TextDecoder('utf-8',{fatal:true}).decode(await h.readFile());}finally{await h.close();}}
async function main() {
 if(process.argv.length===3 && process.argv[2]==='--help'){process.stdout.write('Usage: node verification/refresh-sigstore-tuf.mjs --state PATH --bootstrap-sha256 sha256:HASH (--mirror https://tuf-repo-cdn.sigstore.dev | --repository PATH.json) [--initialize --bootstrap ROOT.json]\n');return;}
 const args={};for(let i=2;i<process.argv.length;i++){const name=process.argv[i];if(name==='--initialize'){args.initialize=true;continue;}if(!['--state','--bootstrap','--bootstrap-sha256','--repository','--mirror'].includes(name) || !process.argv[i+1] || args[name]!==undefined)throw Error('arguments');args[name]=process.argv[++i];}
 const statePath=path.resolve(args['--state']||''),pin=args['--bootstrap-sha256'];if(!args['--state'] || !/^sha256:[a-f0-9]{64}$/.test(pin||'') || Boolean(args['--repository'])===Boolean(args['--mirror']) || args['--mirror'] && !mirrors.has(args['--mirror']))throw Error('arguments');
 if(args['--bootstrap'] && !args.initialize)throw Error('bootstrap is initialization only');
 // O_EXCL serializes updates. Never remove a preexisting lock or reset missing state implicitly.
 const lockPath=statePath+'.lock',lock=await fs.open(lockPath,'wx',0o600);let previous,bootstrap,pending,temp;
 try {
  if(args.initialize) {try{await fs.lstat(statePath);throw Error('already initialized');}catch(e){if(e.code!=='ENOENT')throw e;}if(!args['--bootstrap'])throw Error('bootstrap');bootstrap=await read(args['--bootstrap'],500000);}
  else {previous=tuf.strict(await read(statePath,4500000),4500000);if(previous.bootstrapRootDigest!==pin || previous.schemaVersion!=='1')throw Error('state');bootstrap=previous.repository?.bootstrapRoot;}
  if(sha256(bootstrap)!==pin)throw Error('pin');
  const persist=async state=>{temp=statePath+'.tmp-'+crypto.randomBytes(8).toString('hex');const h=await fs.open(temp,'wx',0o600);try{await h.writeFile(JSON.stringify(state,null,2)+'\n');await h.sync();}finally{await h.close();}await fs.rename(temp,statePath);temp=null;};
  try {
   const repository=args['--repository']?tuf.strict(await read(args['--repository'],4000000),4000000):await fetchRepository(args['--mirror'],previous,bootstrap,pin);
   if(repository.bootstrapRoot!==bootstrap)throw Error('bootstrap changed');
   const result=tuf.verifyRepository(repository,pin,Date.now(),previous?.floor);
   pending={schemaVersion:'1',bootstrapRootDigest:pin,...tuf.applyProgress(previous,repository,result),lastAttempt:{status:result.status,reason:result.reason,checkedAt:new Date().toISOString()}};
   await persist(pending);process.stdout.write(JSON.stringify({status:result.status,reason:result.reason,...(result.proof?{tuf:result.proof}:{})})+'\n');if(result.status!=='verified')process.exitCode=2;
  }catch(error) {if(error.repository){const partial=tuf.verifyRepository({...error.repository,target:null},pin,Date.now(),previous?.floor);pending={schemaVersion:'1',bootstrapRootDigest:pin,...tuf.applyProgress(previous,error.repository,partial)};}if(previous||pending)await persist({...pending||previous,lastAttempt:{status:'rejected',reason:'sigstore-tuf-refresh-failed',checkedAt:new Date().toISOString()}});throw Error('refresh');}
 }finally {if(temp)await fs.rm(temp,{force:true});await lock.close();await fs.unlink(lockPath);}
}
main().catch(()=>{process.stderr.write('TUF refresh rejected. Check explicit anchor, metadata, state/lock and permissions; no cached success fallback.\n');process.exitCode=2;});
