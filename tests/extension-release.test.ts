import { mkdtempSync,mkdirSync,copyFileSync,readFileSync,writeFileSync,rmSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { expect,it,vi } from 'vitest';
const files=['manifest.json','background.js','page-reader.js','login.js','content.js','panel-bridge.js','popup.html','popup.js','options.html','options.js','update-check.js','INSTALL.txt'];
function unzip(zip:Buffer){const entries=new Map<string,Buffer>();let offset=0;while(zip.readUInt32LE(offset)===0x04034b50){const size=zip.readUInt32LE(offset+18),nameLength=zip.readUInt16LE(offset+26),extra=zip.readUInt16LE(offset+28),start=offset+30+nameLength+extra;expect(zip.readUInt16LE(offset+8)).toBe(8);const name=zip.subarray(offset+30,offset+30+nameLength).toString();const data=inflateRawSync(zip.subarray(start,start+size));expect(data.length).toBe(zip.readUInt32LE(offset+22));entries.set(name,data);offset=start+size;}expect(zip.readUInt32LE(offset)).toBe(0x02014b50);expect(zip.readUInt32LE(zip.length-22)).toBe(0x06054b50);return entries;}
it('packages exactly the extension allowlist, is deterministic and detects edits without a version bump',()=>{
  const root=mkdtempSync(join(tmpdir(),'lead-radar-release-'));
  try{
    mkdirSync(join(root,'extension'));for(const name of files)copyFileSync(resolve('extension',name),join(root,'extension',name));
    writeFileSync(join(root,'extension','secret.env'),'must-not-package');
    const run=()=>execFileSync(process.execPath,[resolve('scripts/package-extension.mjs'),root]);run();
    const zipPath=join(root,'src/web/public/lead-radar-extension.zip');const jsonPath=join(root,'src/web/public/lead-radar-extension.json');
    const first=readFileSync(zipPath),info=JSON.parse(readFileSync(jsonPath,'utf8')),entries=unzip(first);
    expect([...entries.keys()]).toEqual([...files,'build-info.json']);expect(info.sha256).toBe(createHash('sha256').update(first).digest('hex'));expect(info.bytes).toBe(first.length);
    expect(JSON.parse(entries.get('build-info.json')!.toString())).toEqual({version:info.version,build:info.build});
    run();expect(readFileSync(zipPath)).toEqual(first);
    writeFileSync(join(root,'extension/popup.js'),readFileSync(join(root,'extension/popup.js'),'utf8')+'\n// changed fixture\n');run();
    const next=JSON.parse(readFileSync(jsonPath,'utf8'));expect(next.version).toBe(info.version);expect(next.build).not.toBe(info.build);expect(next.sha256).not.toBe(info.sha256);
  }finally{rmSync(root,{recursive:true,force:true});}
});
function updateFixture(latest:unknown,endpoint='https://lead-radar-jade.vercel.app'){
  const elements:any[]=[];const requests:any[]=[];
  const document={createElement:(tag:string)=>{const element={tag,style:{},textContent:'',setAttribute:vi.fn(),append:vi.fn(),addEventListener:vi.fn(),href:undefined};elements.push(element);return element;},querySelector:()=>({after:vi.fn()})};
  const installed={version:'2.6.0',build:'a'.repeat(64)};
  const fetch=async(url:string,options:unknown)=>{requests.push({url,options});return {ok:true,json:async()=>url.startsWith('chrome-extension:')?installed:latest};};
  const chrome={runtime:{getURL:(name:string)=>'chrome-extension://fixture/'+name},storage:{local:{get:async()=>({leadRadarEndpoint:endpoint})}}};
  runInNewContext(readFileSync('extension/update-check.js','utf8'),{document,fetch,chrome,AbortSignal});
  return {elements,requests,settle:async()=>{await new Promise(resolve=>setTimeout(resolve,0));}};
}
it('checks the chosen trusted endpoint without credentials and offers only a fixed download URL',async()=>{
  const fixture=updateFixture({version:'2.6.0',build:'b'.repeat(64),downloadUrl:'https://evil.example'},'http://127.0.0.1:4300');await fixture.settle();
  expect(fixture.elements.find(e=>e.tag==='a')?.href).toBe('http://127.0.0.1:4300/lead-radar-extension.zip?build='+'b'.repeat(64));
  expect(fixture.requests.every(r=>r.options.credentials==='omit')).toBe(true);expect(fixture.requests.map(r=>r.url).some(url=>url.includes('evil'))).toBe(false);
});
it('does not show a download for the current build or for malformed release metadata',async()=>{
  const current=updateFixture({version:'2.6.0',build:'a'.repeat(64)});await current.settle();expect(current.elements.find(e=>e.tag==='div')?.textContent).toContain('به‌روز');expect(current.elements.find(e=>e.tag==='a')?.style.display).toBe('none');
  const invalid=updateFixture({version:'<script>',build:'bad'},'https://evil.example');await invalid.settle();expect(invalid.elements.find(e=>e.tag==='a')?.href).toBeUndefined();expect(invalid.elements.find(e=>e.tag==='div')?.textContent).toContain('نامعتبر');expect(invalid.requests.some(r=>r.url==='https://lead-radar-jade.vercel.app/lead-radar-extension.json')).toBe(true);
});
