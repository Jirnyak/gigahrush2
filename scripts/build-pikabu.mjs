import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const distDir = path.resolve(root, 'dist');
const outDir = path.resolve(root, 'pikabu');
const outHtml = path.resolve(outDir, 'index.html');
const outZip = path.resolve(outDir, 'gigahrush-pikabu.zip');
const outNotes = path.resolve(outDir, 'PIKABU_UPLOAD_NOTES.txt');

const projectId = process.env.GAMEPUSH_PROJECT_ID || process.env.GP_PROJECT_ID;
const publicToken = process.env.GAMEPUSH_PUBLIC_TOKEN || process.env.GP_PUBLIC_TOKEN;

if (!projectId || !publicToken) {
  throw new Error('GAMEPUSH_PROJECT_ID and GAMEPUSH_PUBLIC_TOKEN environment variables are required.');
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}`));
    });
  });
}

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function portalMetaBlock() {
  const lines = ['<meta name="gigahrush-portal" content="pikabu">'];
  if (projectId && publicToken) {
    lines.push(`<meta name="gamepush-project-id" content="${escapeAttr(projectId)}">`);
    lines.push(`<meta name="gamepush-public-token" content="${escapeAttr(publicToken)}">`);
  }
  return `<!-- GIGAH|RUSH Pikabu/GamePush portal mode: injected by npm run pikabu:build -->\n${lines.join('\n')}`;
}

async function injectPortalMetadata() {
  const html = await readFile(outHtml, 'utf8');
  if (html.includes('name="gigahrush-portal"')) return;
  const block = portalMetaBlock();
  const next = html.includes('</head>')
    ? html.replace('</head>', `${block}\n</head>`)
    : `${block}\n${html}`;
  await writeFile(outHtml, next);
}

async function collectFiles(dir, prefix = '') {
  const entries = [];
  const items = await readdir(dir, { withFileTypes: true });
  items.sort((a, b) => a.name.localeCompare(b.name));
  for (const item of items) {
    const abs = path.join(dir, item.name);
    const rel = prefix ? `${prefix}/${item.name}` : item.name;
    if (abs === outZip || abs === outNotes) continue;
    if (item.isDirectory()) entries.push(...await collectFiles(abs, rel));
    else if (item.isFile()) entries.push({ abs, rel });
  }
  return entries;
}

const crcTable = new Uint32Array(256);
for (let i = 0; i < crcTable.length; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[i] = c >>> 0;
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function header(size) {
  return Buffer.alloc(size);
}

async function zipFiles(entries, target) {
  const chunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const entry of entries) {
    const data = await readFile(entry.abs);
    const meta = await stat(entry.abs);
    const compressed = deflateRawSync(data, { level: 9 });
    const name = Buffer.from(entry.rel, 'utf8');
    const crc = crc32(data);
    const { time, date } = dosDateTime(meta.mtime);
    const flags = 0x0800;
    const method = 8;

    const local = header(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const central = header(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);

    chunks.push(local, name, compressed);
    centralChunks.push(central, name);
    offset += local.length + name.length + compressed.length;
  }

  const centralOffset = offset;
  const centralSize = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = header(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  await writeFile(target, Buffer.concat([...chunks, ...centralChunks, end]));
}

function uploadNotes() {
  return `Pikabu Games / GamePush upload notes

Generated by: npm run pikabu:build
Upload archive: pikabu/gigahrush-pikabu.zip

The archive root contains index.html. The injected meta tag enables strict portal mode without changing the canonical dist/ build.

GamePush credentials:
- ${projectId && publicToken ? 'Embedded from GAMEPUSH_PROJECT_ID/GP_PROJECT_ID and GAMEPUSH_PUBLIC_TOKEN/GP_PUBLIC_TOKEN environment variables.' : 'Not embedded. Rebuild with GAMEPUSH_PROJECT_ID and GAMEPUSH_PUBLIC_TOKEN, or inject equivalent private meta tags before uploading.'}

Before final submit:
- Create the GamePush player field named progress.
- Run npm run check and npm run check:browser.
- Test the uploaded GamePush/Pikabu iframe with cloud save/load, pause/resume, audio pause, mobile scaling and portal content gates.
- Do not click final submit until owner legal/payment setup is complete.
`;
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
await run(npm, ['run', 'build']);
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await cp(distDir, outDir, { recursive: true });
await injectPortalMetadata();
await writeFile(outNotes, uploadNotes());
await zipFiles(await collectFiles(outDir), outZip);

const htmlSize = (await stat(outHtml)).size;
const zipSize = (await stat(outZip)).size;
console.log('Pikabu/GamePush build ready:');
console.log(`- ${path.relative(root, outHtml)} (${htmlSize} bytes)`);
console.log(`- ${path.relative(root, outZip)} (${zipSize} bytes, upload this ZIP)`);
console.log(`- ${path.relative(root, outNotes)} (private setup notes)`);
console.log(`- GamePush credentials embedded: ${projectId && publicToken ? 'yes' : 'no'}`);
