const encoder = new TextEncoder();

function crc32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = crc32Table();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function write16(out, value) {
  out.push(value & 0xff, (value >>> 8) & 0xff);
}

function write32(out, value) {
  out.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

async function fileBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof Blob !== 'undefined' && data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  return encoder.encode(String(data ?? ''));
}

function dosTime(date = new Date()) {
  return ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | Math.floor(date.getSeconds() / 2);
}

function dosDate(date = new Date()) {
  return (((date.getFullYear() - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31);
}

export async function createZip(files) {
  const local = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const time = dosTime(now);
  const date = dosDate(now);

  for (const file of files) {
    const nameBytes = encoder.encode(file.path.replace(/^\/+/, ''));
    const bytes = await fileBytes(file.data);
    const crc = crc32(bytes);
    const localOffset = offset;
    const header = [];
    write32(header, 0x04034b50);
    write16(header, 20);
    write16(header, 0);
    write16(header, 0);
    write16(header, time);
    write16(header, date);
    write32(header, crc);
    write32(header, bytes.length);
    write32(header, bytes.length);
    write16(header, nameBytes.length);
    write16(header, 0);
    local.push(Uint8Array.from(header), nameBytes, bytes);
    offset += header.length + nameBytes.length + bytes.length;

    const cent = [];
    write32(cent, 0x02014b50);
    write16(cent, 20);
    write16(cent, 20);
    write16(cent, 0);
    write16(cent, 0);
    write16(cent, time);
    write16(cent, date);
    write32(cent, crc);
    write32(cent, bytes.length);
    write32(cent, bytes.length);
    write16(cent, nameBytes.length);
    write16(cent, 0);
    write16(cent, 0);
    write16(cent, 0);
    write16(cent, 0);
    write32(cent, 0);
    write32(cent, localOffset);
    central.push(Uint8Array.from(cent), nameBytes);
  }

  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = [];
  write32(end, 0x06054b50);
  write16(end, 0);
  write16(end, 0);
  write16(end, files.length);
  write16(end, files.length);
  write32(end, centralSize);
  write32(end, offset);
  write16(end, 0);

  const all = [...local, ...central, Uint8Array.from(end)];
  const total = all.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of all) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}

export function downloadBytes(bytes, filename, type = 'application/zip') {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
