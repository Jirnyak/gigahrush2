#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const archiveRoot = path.resolve(root, '..', 'gatbage');
const freshDistRel = '../gatbage/tmp/artifact-verify/dist';
const freshRoot = path.resolve(archiveRoot, 'tmp', 'artifact-verify');
const freshDist = path.resolve(root, freshDistRel);
const trackedDist = path.resolve(root, 'dist');
const itchHtml = path.resolve(root, 'itch', 'index.html');
const itchZip = path.resolve(root, 'itch', 'gigahrush-itch.zip');
const requiredReleaseFiles = [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
];
const optionalDistOnlyFiles = new Set([
  'build-size-report.json',
]);

function repoPath(abs) {
  return path.relative(root, abs).replaceAll(path.sep, '/');
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

async function collectFiles(dir, prefix = '') {
  const entries = [];
  const items = await readdir(dir, { withFileTypes: true });
  items.sort((a, b) => a.name.localeCompare(b.name));
  for (const item of items) {
    const abs = path.join(dir, item.name);
    const rel = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) {
      entries.push(...await collectFiles(abs, rel));
    } else if (item.isFile()) {
      entries.push({ abs, rel });
    }
  }
  return entries;
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function shortHash(hash) {
  return hash.slice(0, 16);
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function formatDos(date, time) {
  const year = 1980 + ((date >> 9) & 0x7f);
  const month = (date >> 5) & 0xf;
  const day = date & 0x1f;
  const hour = (time >> 11) & 0x1f;
  const minute = (time >> 5) & 0x3f;
  const second = (time & 0x1f) * 2;
  const pad = value => String(value).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

function manifestHash(files) {
  const hash = createHash('sha256');
  for (const rel of [...files.keys()].sort()) {
    hash.update(rel);
    hash.update('\0');
    hash.update(files.get(rel).hash);
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function readFileMap(dir) {
  const files = new Map();
  for (const entry of await collectFiles(dir)) {
    const data = await readFile(entry.abs);
    const meta = await stat(entry.abs);
    files.set(entry.rel, {
      abs: entry.abs,
      data,
      hash: sha256(data),
      meta,
    });
  }
  return files;
}

function compareListing(label, expected, actual, errors) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  for (const rel of expected) {
    if (!actualSet.has(rel)) errors.push(`${label} is missing ${rel}`);
  }
  for (const rel of actual) {
    if (!expectedSet.has(rel)) errors.push(`${label} has stale extra file ${rel}`);
  }
}

function releaseFileNames(files) {
  return [...files.keys()].filter(rel => !optionalDistOnlyFiles.has(rel)).sort();
}

function findEndOfCentralDirectory(data) {
  const min = Math.max(0, data.length - 0xffff - 22);
  for (let offset = data.length - 22; offset >= min; offset--) {
    if (data.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error('ZIP end-of-central-directory record not found');
}

function readZipEntries(data) {
  const eocd = findEndOfCentralDirectory(data);
  const totalEntries = data.readUInt16LE(eocd + 10);
  const centralSize = data.readUInt32LE(eocd + 12);
  const centralOffset = data.readUInt32LE(eocd + 16);
  if (centralOffset + centralSize > data.length) throw new Error('ZIP central directory points past end of file');

  let offset = centralOffset;
  const entries = [];
  const names = new Set();
  for (let i = 0; i < totalEntries; i++) {
    if (data.readUInt32LE(offset) !== 0x02014b50) throw new Error(`ZIP central directory entry ${i + 1} has an invalid signature`);
    const method = data.readUInt16LE(offset + 10);
    const time = data.readUInt16LE(offset + 12);
    const date = data.readUInt16LE(offset + 14);
    const compressedSize = data.readUInt32LE(offset + 20);
    const uncompressedSize = data.readUInt32LE(offset + 24);
    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    const localOffset = data.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const name = data.toString('utf8', nameStart, nameStart + nameLength);
    if (names.has(name)) throw new Error(`ZIP has duplicate entry ${name}`);
    names.add(name);

    if (data.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`ZIP local header for ${name} has an invalid signature`);
    const localNameLength = data.readUInt16LE(localOffset + 26);
    const localExtraLength = data.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = data.subarray(dataStart, dataStart + compressedSize);
    let contents;
    if (method === 0) contents = Buffer.from(compressed);
    else if (method === 8) contents = inflateRawSync(compressed);
    else throw new Error(`ZIP entry ${name} uses unsupported compression method ${method}`);
    if (contents.length !== uncompressedSize) {
      throw new Error(`ZIP entry ${name} size mismatch: expected ${uncompressedSize}, inflated ${contents.length}`);
    }

    entries.push({ name, data: contents, hash: sha256(contents), date, time });
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  if (offset !== centralOffset + centralSize) throw new Error('ZIP central directory size mismatch');
  return entries;
}

async function readZipMap(file) {
  const entries = readZipEntries(await readFile(file));
  const map = new Map();
  for (const entry of entries) map.set(entry.name, entry);
  return { entries, map };
}

async function main() {
  const errors = [];
  await rm(freshRoot, { recursive: true, force: true });
  await mkdir(freshRoot, { recursive: true });

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  await run(npm, ['run', 'build', '--', '--outDir', freshDistRel, '--emptyOutDir']);

  const freshFiles = await readFileMap(freshDist);
  const trackedFiles = await readFileMap(trackedDist);
  const expectedFiles = releaseFileNames(freshFiles);
  const trackedNames = releaseFileNames(trackedFiles);

  compareListing('dist/', expectedFiles, trackedNames, errors);
  for (const rel of expectedFiles) {
    const fresh = freshFiles.get(rel);
    const tracked = trackedFiles.get(rel);
    if (tracked && fresh.hash !== tracked.hash) {
      errors.push(`dist/${rel} hash differs from current build: current ${shortHash(fresh.hash)}, tracked ${shortHash(tracked.hash)}`);
    }
  }

  for (const rel of requiredReleaseFiles) {
    if (!freshFiles.has(rel)) errors.push(`current build is missing required release file ${rel}`);
    if (!trackedFiles.has(rel)) errors.push(`dist/ is missing required release file ${rel}`);
  }

  const freshIndex = freshFiles.get('index.html');
  const trackedIndex = trackedFiles.get('index.html');
  if (freshIndex) {
    const itchIndexData = await readFile(itchHtml);
    const itchIndexHash = sha256(itchIndexData);
    if (itchIndexHash !== freshIndex.hash) {
      errors.push(`itch/index.html hash differs from current build: current ${shortHash(freshIndex.hash)}, itch ${shortHash(itchIndexHash)}`);
    }
  }
  if (trackedIndex) {
    const itchIndexMeta = await stat(itchHtml);
    if (itchIndexMeta.mtimeMs + 2000 < trackedIndex.meta.mtimeMs) {
      errors.push(`itch/index.html timestamp is older than dist/index.html: ${itchIndexMeta.mtime.toISOString()} < ${trackedIndex.meta.mtime.toISOString()}`);
    }
  }

  const zip = await readZipMap(itchZip);
  const zipNames = zip.entries.map(entry => entry.name).sort();
  compareListing('itch/gigahrush-itch.zip', expectedFiles, zipNames, errors);
  for (const name of zipNames) {
    if (name.includes('/')) errors.push(`itch/gigahrush-itch.zip entry is not at archive root: ${name}`);
  }
  for (const rel of requiredReleaseFiles) {
    if (!zip.map.has(rel)) errors.push(`itch/gigahrush-itch.zip is missing required root entry ${rel}`);
  }
  for (const rel of expectedFiles) {
    const fresh = freshFiles.get(rel);
    const tracked = trackedFiles.get(rel);
    const zipped = zip.map.get(rel);
    if (!zipped) continue;
    if (fresh.hash !== zipped.hash) {
      errors.push(`itch/gigahrush-itch.zip:${rel} hash differs from current build: current ${shortHash(fresh.hash)}, zip ${shortHash(zipped.hash)}`);
    }
    if (tracked) {
      const expectedStamp = dosDateTime(tracked.meta.mtime);
      if (expectedStamp.date !== zipped.date || expectedStamp.time !== zipped.time) {
        errors.push(`itch/gigahrush-itch.zip:${rel} timestamp differs from dist/${rel}: dist ${formatDos(expectedStamp.date, expectedStamp.time)}, zip ${formatDos(zipped.date, zipped.time)}`);
      }
    }
  }

  if (errors.length) {
    console.error('Artifact verification failed:');
    for (const error of errors) console.error(`- ${error}`);
    console.error(`Fresh build output left at ${repoPath(freshDist)} for comparison.`);
    process.exitCode = 1;
    return;
  }

  console.log('Artifact verification passed:');
  console.log(`- current build manifest: ${freshFiles.size} files, sha256 ${shortHash(manifestHash(freshFiles))}`);
  console.log('- dist/: file list and hashes match current build');
  console.log('- itch/index.html: hash and timestamp match current dist/index.html');
  console.log('- itch/gigahrush-itch.zip: root listing, hashes and dist timestamps match');
}

main().catch(err => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
