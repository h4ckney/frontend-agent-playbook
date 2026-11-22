#!/usr/bin/env node
// Pin a separately obtained/reviewed root. A digest alone does not establish its origin.
import fs from 'node:fs/promises';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),parser=require('../analysis/lockfile-graph.js'),{rootDigest}=require('./sigstore-keyless.cjs');
try {
 if(process.argv.length!==3) throw Error('usage: node verification/sigstore-root-digest.mjs TRUSTED_ROOT.json');
 const bytes=await fs.readFile(process.argv[2]);if(bytes.length>200000) throw Error('trusted root exceeds 200000 bytes');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),root=parser.parseJSONC(text);JSON.parse(text);
 if(!root || typeof root!=='object' || Array.isArray(root)) throw Error('trusted root must be a strict JSON object');
 process.stdout.write(rootDigest(root)+'\n');
}catch {process.stderr.write('Invalid or unavailable trusted root; provide one strict JSON object up to 200000 bytes.\n');process.exitCode=2;}
