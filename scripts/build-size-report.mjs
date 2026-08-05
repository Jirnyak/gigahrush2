#!/usr/bin/env node
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const distHtml = path.resolve(root, 'dist', 'index.html');
const itchZip = path.resolve(root, 'itch', 'gigahrush-itch.zip');
const manifestPath = path.resolve(root, 'dist', 'build-size-manifest.json');
const reportPath = path.resolve(root, 'dist', 'build-size-report.json');
const badAppleDecoderPath = path.resolve(root, 'src', 'data', 'bad_apple_frames.ts');
const badAppleFramePackPath = path.resolve(root, 'src', 'data', 'bad_apple_frame_pack.ts');
const badAppleAudioPath = path.resolve(root, 'src', 'data', 'bad_apple_theme_lofi.ts');

const budgets = {
  htmlBytes: 9_500_000,
  htmlGzipBytes: 4_500_000,
  itchZipBytes: 4_500_000,
};

const bucketDefs = [
  {
    id: 'generated_frames',
    label: 'dormant Bad Apple frame source',
    match: id => id === 'src/data/bad_apple_frames.ts' || id === 'src/data/bad_apple_frame_pack.ts',
  },
  {
    id: 'bad_apple_audio',
    label: 'dormant Bad Apple audio source',
    match: id => id === 'src/data/bad_apple_theme_lofi.ts',
  },
  {
    id: 'sprite_code',
    label: 'sprite code',
    match: id => id === 'src/render/sprites.ts'
      || id === 'src/render/art_sprites.ts'
      || id === 'src/render/sprite_index.ts'
      || id === 'src/entities/procedural_visuals.ts'
      || /^src\/entities\/[^/]+\.ts$/.test(id),
  },
  {
    id: 'texture_code',
    label: 'texture code',
    match: id => id === 'src/render/textures.ts' || id === 'src/gen/procedural_screens.ts',
  },
];

function rel(file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function formatBytes(bytes) {
  const sign = bytes < 0 ? '-' : '';
  const abs = Math.abs(bytes);
  return `${sign}${(abs / 1_000_000).toFixed(2)} MB`;
}

function formatMiB(bytes) {
  const sign = bytes < 0 ? '-' : '';
  const abs = Math.abs(bytes);
  return `${sign}${(abs / 1024 / 1024).toFixed(2)} MiB`;
}

function formatBoth(bytes) {
  return `${formatBytes(bytes)} (${formatMiB(bytes)})`;
}

function budgetState(value, limit) {
  const delta = limit - value;
  return {
    ok: value <= limit,
    limit,
    delta,
  };
}

function budgetText(value, limit) {
  const state = budgetState(value, limit);
  if (state.ok) return `ok, ${formatBytes(state.delta)} headroom to ${formatBytes(limit)} warning`;
  return `WARN, ${formatBytes(-state.delta)} over ${formatBytes(limit)} warning`;
}

async function readMaybe(file) {
  try {
    return await readFile(file);
  } catch (error) {
    if (error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function statMaybe(file) {
  try {
    return await stat(file);
  } catch (error) {
    if (error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function readJsonMaybe(file) {
  const data = await readMaybe(file);
  if (!data) return undefined;
  return JSON.parse(data.toString('utf8'));
}

async function collectSourceFiles(dir, prefix = '') {
  const files = [];
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const id = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(abs, id));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push({ id: `src/${id}`, abs });
    }
  }
  return files;
}

function parseNumberConst(source, name) {
  const match = source.match(new RegExp(`export const ${name} = ([\\d.]+);`));
  return match ? Number(match[1]) : undefined;
}

function sumRendered(modules, match) {
  return modules
    .filter(module => match(module.id))
    .reduce((sum, module) => sum + (module.renderedLength ?? 0), 0);
}

async function sourceBucket(files, match) {
  let bytes = 0;
  let gzipBytes = 0;
  let count = 0;
  for (const file of files) {
    if (!match(file.id)) continue;
    const data = await readFile(file.abs);
    bytes += data.length;
    gzipBytes += gzipSync(data, { level: 9 }).length;
    count++;
  }
  return { bytes, gzipBytes, count };
}

function addWarning(warnings, label, value, limit) {
  if (value > limit) warnings.push(`${label}: ${formatBytes(value)} exceeds warning ${formatBytes(limit)}`);
}

const htmlData = await readMaybe(distHtml);
if (!htmlData) {
  console.error('Missing dist/index.html. Run npm run build before running the size report.');
  process.exit(1);
}

const htmlStat = await stat(distHtml);
const htmlGzipBytes = gzipSync(htmlData, { level: 9 }).length;
const itchStat = await statMaybe(itchZip);
const itchStale = itchStat ? itchStat.mtimeMs + 1000 < htmlStat.mtimeMs : false;
const manifest = await readJsonMaybe(manifestPath);
const modules = Array.isArray(manifest?.modules) ? manifest.modules : [];
const sourceFiles = await collectSourceFiles(path.resolve(root, 'src'));
const badAppleDecoderData = await readFile(badAppleDecoderPath);
const badAppleFramePackData = await readFile(badAppleFramePackPath);
const badAppleFrameData = Buffer.concat([badAppleDecoderData, badAppleFramePackData]);
const badAppleSource = badAppleDecoderData.toString('utf8');
const badAppleGzipBytes = gzipSync(badAppleFrameData, { level: 9 }).length;
const badAppleAudioData = await readFile(badAppleAudioPath);
const badAppleAudioSource = badAppleAudioData.toString('utf8');
const badAppleAudioGzipBytes = gzipSync(badAppleAudioData, { level: 9 }).length;

const buckets = [];
for (const def of bucketDefs) {
  const source = await sourceBucket(sourceFiles, def.match);
  buckets.push({
    id: def.id,
    label: def.label,
    sourceBytes: source.bytes,
    sourceGzipBytes: source.gzipBytes,
    sourceFiles: source.count,
    renderedBytes: sumRendered(modules, def.match),
  });
}

const warnings = [];
addWarning(warnings, 'single-file HTML', htmlData.length, budgets.htmlBytes);
addWarning(warnings, 'single-file HTML gzip', htmlGzipBytes, budgets.htmlGzipBytes);
if (itchStat && !itchStale) addWarning(warnings, 'itch upload ZIP', itchStat.size, budgets.itchZipBytes);

const topModules = modules
  .filter(module => (module.renderedLength ?? 0) > 0)
  .sort((a, b) => (b.renderedLength ?? 0) - (a.renderedLength ?? 0))
  .slice(0, 10)
  .map(module => ({
    id: module.id,
    renderedBytes: module.renderedLength ?? 0,
    originalLength: module.originalLength ?? 0,
  }));

const badApple = {
  width: parseNumberConst(badAppleSource, 'BAD_APPLE_WIDTH'),
  height: parseNumberConst(badAppleSource, 'BAD_APPLE_HEIGHT'),
  frames: parseNumberConst(badAppleSource, 'BAD_APPLE_FRAME_COUNT'),
  sourceFirst: parseNumberConst(badAppleSource, 'BAD_APPLE_SOURCE_FRAME_FIRST'),
  sourceLast: parseNumberConst(badAppleSource, 'BAD_APPLE_SOURCE_FRAME_LAST'),
  sourceStep: parseNumberConst(badAppleSource, 'BAD_APPLE_SOURCE_FRAME_STEP'),
  keyframeInterval: parseNumberConst(badAppleSource, 'BAD_APPLE_KEYFRAME_INTERVAL'),
  rleRuns: parseNumberConst(badAppleSource, 'BAD_APPLE_RLE_TOTAL_RUNS'),
  rleMaxRuns: parseNumberConst(badAppleSource, 'BAD_APPLE_RLE_MAX_RUNS'),
};

const report = {
  budgets,
  outputs: {
    htmlBytes: htmlData.length,
    htmlGzipBytes,
    itchZipBytes: itchStat?.size,
    itchZipStale: itchStale,
  },
  badApple: {
    ...badApple,
    shippedInMainBuilds: false,
    sourceBytes: badAppleFrameData.length,
    gzipBytes: badAppleGzipBytes,
    decoderBytes: badAppleDecoderData.length,
    framePackBytes: badAppleFramePackData.length,
    audioSourceBytes: badAppleAudioData.length,
    audioGzipBytes: badAppleAudioGzipBytes,
    audioDurationSeconds: parseNumberConst(badAppleAudioSource, 'BAD_APPLE_THEME_DURATION_SECONDS'),
  },
  buckets,
  topModules,
  warnings,
};

const lines = [];
lines.push('Build Size Report');
lines.push('');
lines.push('Outputs');
lines.push(`- ${rel(distHtml)}: ${formatBoth(htmlData.length)} raw; ${formatBoth(htmlGzipBytes)} gzip (${budgetText(htmlGzipBytes, budgets.htmlGzipBytes)})`);
lines.push(`  HTML raw budget: ${budgetText(htmlData.length, budgets.htmlBytes)}`);
if (itchStat) {
  const staleText = itchStale ? 'stale, run npm run itch:build for current upload weight' : budgetText(itchStat.size, budgets.itchZipBytes);
  lines.push(`- ${rel(itchZip)}: ${formatBoth(itchStat.size)} ZIP upload (${staleText})`);
} else {
  lines.push('- itch/gigahrush-itch.zip: not found; run npm run itch:build for upload weight');
}
lines.push('');
lines.push('Dormant Bad Apple Experiment Source');
lines.push(`- src/data/bad_apple_frames.ts + src/data/bad_apple_frame_pack.ts: ${formatBoth(badAppleFrameData.length)} raw; ${formatBoth(badAppleGzipBytes)} gzip`);
lines.push(`- Bad Apple frames: ${badApple.frames ?? '?'} at ${badApple.width ?? '?'}x${badApple.height ?? '?'}, source ${badApple.sourceFirst ?? '?'}..${badApple.sourceLast ?? '?'} step ${badApple.sourceStep ?? '?'}`);
lines.push(`- Keyframe interval: ${badApple.keyframeInterval ?? '?'}; RLE runs: ${badApple.rleRuns ?? '?'} total, ${badApple.rleMaxRuns ?? '?'} max per frame`);
lines.push(`- Bad Apple low-fi audio: ${formatBoth(badAppleAudioData.length)} raw; ${formatBoth(badAppleAudioGzipBytes)} gzip; duration ${parseNumberConst(badAppleAudioSource, 'BAD_APPLE_THEME_DURATION_SECONDS') ?? '?'}s`);
lines.push('- Status: retained in source as an engine experiment, excluded from ordinary HTML/itch/Pikabu/Cloudflare build paths.');
lines.push('');
lines.push('Source And Rendered Buckets');
for (const bucket of buckets) {
  const rendered = modules.length ? formatBoth(bucket.renderedBytes) : 'no manifest';
  lines.push(`- ${bucket.label}: ${bucket.sourceFiles} source files, ${formatBoth(bucket.sourceBytes)} raw, ${formatBoth(bucket.sourceGzipBytes)} gzip, ${rendered} rendered before singlefile inline`);
}
if (!modules.length) {
  lines.push(`  Missing ${rel(manifestPath)}; run npm run build to refresh rendered module buckets.`);
}
lines.push('');
lines.push('Top Rendered Modules');
if (topModules.length) {
  for (const module of topModules) {
    lines.push(`- ${module.id}: ${formatBoth(module.renderedBytes)}`);
  }
} else {
  lines.push('- no rendered module manifest available');
}
lines.push('');
if (warnings.length) {
  lines.push('Warnings');
  for (const warning of warnings) lines.push(`- ${warning}`);
  lines.push('- Warning-only pass: size warnings do not fail this script yet.');
} else {
  lines.push('Warnings');
  lines.push('- none');
}

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
lines.push('');
lines.push(`Wrote ${rel(reportPath)}`);

console.log(lines.join('\n'));
