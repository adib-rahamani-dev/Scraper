import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';

export const extensionFiles=['manifest.json','background.js','page-reader.js','login.js','content.js','panel-bridge.js','popup.html','popup.css','popup.js','options.html','options.js','update-check.js','INSTALL.txt'];
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
export function extensionZip(entries){
  const local=[];const central=[];let offset=0;
  for(const {name,data} of entries){
    const filename=Buffer.from(name);const packed=deflateRawSync(data);const crc=crc32(data);
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(8,8);header.writeUInt16LE(33,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(packed.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(filename.length,26);
    local.push(header,filename,packed);
    const dir=Buffer.alloc(46);dir.writeUInt32LE(0x02014b50);dir.writeUInt16LE(20,4);dir.writeUInt16LE(20,6);dir.writeUInt16LE(0x800,8);dir.writeUInt16LE(8,10);dir.writeUInt16LE(33,14);dir.writeUInt32LE(crc,16);dir.writeUInt32LE(packed.length,20);dir.writeUInt32LE(data.length,24);dir.writeUInt16LE(filename.length,28);dir.writeUInt32LE(offset,42);central.push(dir,filename);offset+=header.length+filename.length+packed.length;
  }
  const directory=Buffer.concat(central);const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
export async function packageExtension(root=resolve(dirname(fileURLToPath(import.meta.url)),'..')){
  const entries=await Promise.all(extensionFiles.map(async name=>({name,data:Buffer.from((await readFile(resolve(root,'extension',name),'utf8')).replace(/\r\n/g,'\n'))})));
  const manifest=JSON.parse(entries.find(entry=>entry.name==='manifest.json').data.toString());
  if(!/^\d+(?:\.\d+){1,3}$/.test(manifest.version))throw new Error('Invalid extension version');
  const hash=createHash('sha256');for(const entry of entries)hash.update(entry.name+'\0').update(entry.data).update('\0');
  const build=hash.digest('hex');const info={version:manifest.version,build};
  const zip=extensionZip([...entries,{name:'build-info.json',data:Buffer.from(JSON.stringify(info,null,2)+'\n')}]);
  const release={...info,sha256:createHash('sha256').update(zip).digest('hex'),bytes:zip.length};
  const target=resolve(root,'src/web/public');await mkdir(target,{recursive:true});
  await writeFile(resolve(target,'lead-radar-extension.zip'),zip);
  await writeFile(resolve(target,'lead-radar-extension.json'),JSON.stringify(release,null,2)+'\n');
  // Also identifies a developer install loaded directly from this repository.
  await writeFile(resolve(root,'extension/build-info.json'),JSON.stringify(info,null,2)+'\n');
  return release;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const release=await packageExtension(process.argv[2]?resolve(process.argv[2]):undefined);console.log(`Extension ${release.version} packaged (${release.build.slice(0,12)}, ${release.bytes} bytes)`);}
