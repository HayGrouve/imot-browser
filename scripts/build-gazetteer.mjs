#!/usr/bin/env node
// Builds lib/gazetteer-bg.json from the GeoNames Bulgaria dump (CC BY 4.0).
// Usage: node scripts/build-gazetteer.mjs
// Only populated places (feature class P) are kept, with their Bulgarian
// (Cyrillic) names so imot.bg locations can be matched offline.

import { writeFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SRC = 'https://download.geonames.org/export/dump/BG.zip';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'gazetteer-bg.json');

// Bulgarian Cyrillic only — filters out Russian/Ukrainian/Serbian spellings.
const BG_CYRILLIC = /^[А-Яа-я0-9 .\-'"()]+$/;
const NON_BG_LETTERS = /[ЁёЫыЭэЄєІіЇїЈјЉљЊњЋћЏџЂђЃѓЌќЎў]/;

function unzipFirst(buf, wanted) {
  // Find End Of Central Directory record.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file');
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < entries; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Bad central directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name === wanted) {
      const lNameLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + csize);
      return method === 0 ? data : inflateRawSync(data);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${wanted} not found in zip`);
}

const res = await fetch(SRC);
if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
const zip = Buffer.from(await res.arrayBuffer());
const text = unzipFirst(zip, 'BG.txt').toString('utf8');

const rows = [];
for (const line of text.split('\n')) {
  const f = line.split('\t');
  if (f.length < 15 || f[6] !== 'P') continue;
  const [id, name, , alt, lat, lon, , code, , , admin1, admin2, , , pop] = f;
  const bg = [...new Set([name, ...(alt || '').split(',')].map((s) => s.trim())
    .filter((s) => s && BG_CYRILLIC.test(s) && !NON_BG_LETTERS.test(s)))];
  rows.push([Number(id), name, bg, Number(Number(lat).toFixed(5)), Number(Number(lon).toFixed(5)),
    admin1, admin2, code, Number(pop) || 0]);
}

const out = {
  source: SRC,
  attribution: 'GeoNames (https://www.geonames.org), CC BY 4.0',
  generated: new Date().toISOString().slice(0, 10),
  fields: ['id', 'name', 'bg', 'lat', 'lon', 'admin1', 'admin2', 'code', 'pop'],
  rows,
};
await writeFile(OUT, JSON.stringify(out));
console.log(`Wrote ${rows.length} populated places to ${path.relative(process.cwd(), OUT)}`);
