import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const packDir = path.resolve(root, 'itch_page_pack');
const distDir = path.resolve(root, 'dist');
const itchDir = path.resolve(root, 'itch');
const manifestPath = path.resolve(packDir, 'upload_manifest.json');
const itchHtml = path.resolve(itchDir, 'index.html');
const itchZip = path.resolve(itchDir, 'gigahrush-itch.zip');
const itchNotes = path.resolve(itchDir, 'ITCH_UPLOAD_NOTES.txt');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const STALE_TOLERANCE_MS = 1000;
const LOCAL_PREVIEW_SHOTS = [
  { image: 'local_preview_desktop.png', html: 'local_preview.html' },
  { image: 'local_preview_mobile.png', html: 'local_preview.html' },
  { image: 'local_preview_desktop_v2.png', html: 'local_preview.html' },
  { image: 'local_preview_mobile_v2.png', html: 'local_preview.html' },
  { image: 'local_preview_desktop_v3.png', html: 'local_preview_v3.html' },
  { image: 'local_preview_mobile_v3.png', html: 'local_preview_v3.html' },
];
const SCREENSHOT_SOURCE_PAIRS = [
  ['enhanced_screenshots/gigahrush_screen_01_combat.png', 'source_screenshots/source_1.png'],
  ['enhanced_screenshots/gigahrush_screen_02_contract.png', 'source_screenshots/source_2.png'],
  ['enhanced_screenshots/gigahrush_screen_03_inventory.png', 'source_screenshots/source_3.png'],
  ['enhanced_screenshots/gigahrush_screen_04_act_hall.png', 'source_screenshots/source_4.png'],
];
const DIST_ONLY_FILES = new Set([
  'build-size-report.json',
]);

const errors = [];
const warnings = [];
const infos = [];

function rel(absPath) {
  return path.relative(root, absPath).split(path.sep).join('/');
}

function addError(message) {
  errors.push(message);
}

function addWarning(message) {
  warnings.push(message);
}

function addInfo(message) {
  infos.push(message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseDimensions(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d+)x(\d+)$/);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

function dimensionsFromFilename(filePath) {
  const match = path.basename(filePath).match(/(?:^|_)(\d{2,5})x(\d{2,5})(?:_|\.|$)/);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

function sameDimensions(a, b) {
  return Boolean(a && b && a.width === b.width && a.height === b.height);
}

function formatDimensions(dimensions) {
  return `${dimensions.width}x${dimensions.height}`;
}

async function pathStat(absPath, required = true) {
  try {
    return await stat(absPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      if (required) addError(`Missing file: ${rel(absPath)}`);
      return null;
    }
    addError(`Cannot stat ${rel(absPath)}: ${error.message}`);
    return null;
  }
}

function resolvePackPath(manifestRelPath, label) {
  if (typeof manifestRelPath !== 'string' || manifestRelPath.length === 0) {
    addError(`${label} must be a non-empty relative path`);
    return null;
  }
  if (path.isAbsolute(manifestRelPath) || manifestRelPath.includes('\\')) {
    addError(`${label} must be a clean POSIX-style relative path: ${manifestRelPath}`);
    return null;
  }
  const absPath = path.resolve(packDir, manifestRelPath);
  if (!absPath.startsWith(`${packDir}${path.sep}`)) {
    addError(`${label} escapes itch_page_pack: ${manifestRelPath}`);
    return null;
  }
  return absPath;
}

async function readText(absPath, label) {
  try {
    return await readFile(absPath, 'utf8');
  } catch (error) {
    addError(`Cannot read ${label}: ${error.message}`);
    return '';
  }
}

async function readJson(absPath, label) {
  const text = await readText(absPath, label);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    addError(`Invalid JSON in ${label}: ${error.message}`);
    return null;
  }
}

async function imageDimensions(absPath) {
  let data;
  try {
    data = await readFile(absPath);
  } catch (error) {
    addError(`Cannot read image ${rel(absPath)}: ${error.message}`);
    return null;
  }

  if (data.length >= 24 && data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return {
      type: 'png',
      width: data.readUInt32BE(16),
      height: data.readUInt32BE(20),
    };
  }

  if (data.length >= 10) {
    const signature = data.subarray(0, 6).toString('ascii');
    if (signature === 'GIF87a' || signature === 'GIF89a') {
      return {
        type: 'gif',
        width: data.readUInt16LE(6),
        height: data.readUInt16LE(8),
      };
    }
  }

  addError(`Unsupported or corrupt image header: ${rel(absPath)}`);
  return null;
}

async function checkImage(absPath, label, expectedDimensions = null, expectedType = null) {
  if (!await pathStat(absPath)) return null;
  const actual = await imageDimensions(absPath);
  if (!actual) return null;

  if (expectedType && actual.type !== expectedType) {
    addError(`${label} has type ${actual.type}; expected ${expectedType}: ${rel(absPath)}`);
  }
  if (expectedDimensions && !sameDimensions(actual, expectedDimensions)) {
    addError(`${label} is ${formatDimensions(actual)}; expected ${formatDimensions(expectedDimensions)}: ${rel(absPath)}`);
  }
  return actual;
}

function extractLocalReferences(html, htmlRelPath) {
  const refs = new Set();
  const patterns = [
    /\b(?:src|href)=["']([^"']+)["']/gi,
    /url\(\s*["']?([^"')]+)["']?\s*\)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const value = match[1].trim();
      if (!value || value.startsWith('#')) continue;
      if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) continue;
      refs.add(path.posix.normalize(path.posix.join(path.posix.dirname(htmlRelPath), value)));
    }
  }
  return [...refs].filter(ref => !ref.startsWith('../'));
}

async function collectFiles(dir, prefix = '') {
  const entries = [];
  let items;
  try {
    items = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') return entries;
    addError(`Cannot list ${rel(dir)}: ${error.message}`);
    return entries;
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  for (const item of items) {
    const absPath = path.join(dir, item.name);
    const relPath = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) {
      entries.push(...await collectFiles(absPath, relPath));
    } else if (item.isFile()) {
      entries.push({ absPath, relPath });
    }
  }
  return entries;
}

function findEndOfCentralDirectory(data) {
  const minOffset = Math.max(0, data.length - 0xffff - 22);
  for (let offset = data.length - 22; offset >= minOffset; offset--) {
    if (data.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

async function listZipEntries(zipPath) {
  let data;
  try {
    data = await readFile(zipPath);
  } catch (error) {
    addError(`Cannot read ZIP ${rel(zipPath)}: ${error.message}`);
    return [];
  }

  const endOffset = findEndOfCentralDirectory(data);
  if (endOffset < 0) {
    addError(`ZIP has no end-of-central-directory record: ${rel(zipPath)}`);
    return [];
  }

  const count = data.readUInt16LE(endOffset + 10);
  const centralSize = data.readUInt32LE(endOffset + 12);
  const centralOffset = data.readUInt32LE(endOffset + 16);
  if (centralOffset + centralSize > endOffset) {
    addError(`ZIP central directory points outside archive: ${rel(zipPath)}`);
    return [];
  }

  const entries = [];
  let offset = centralOffset;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > data.length || data.readUInt32LE(offset) !== 0x02014b50) {
      addError(`ZIP central directory entry ${i + 1} is corrupt: ${rel(zipPath)}`);
      return entries;
    }
    const compressedSize = data.readUInt32LE(offset + 20);
    const uncompressedSize = data.readUInt32LE(offset + 24);
    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > data.length) {
      addError(`ZIP central directory entry ${i + 1} has an invalid name length: ${rel(zipPath)}`);
      return entries;
    }
    entries.push({
      name: data.subarray(nameStart, nameEnd).toString('utf8'),
      compressedSize,
      uncompressedSize,
    });
    offset = nameEnd + extraLength + commentLength;
  }
  return entries;
}

async function checkHtmlCopy(manifest) {
  const defaultDescription = resolvePackPath(manifest.default_description, 'default_description');
  const fallbackDescription = resolvePackPath(manifest.fallback_description, 'fallback_description');
  const css = resolvePackPath(manifest.css, 'css');

  if (defaultDescription) {
    await pathStat(defaultDescription);
    const html = await readText(defaultDescription, rel(defaultDescription));
    if (!html.trim()) addError(`${rel(defaultDescription)} is empty`);
    if (/<(?:!doctype|html|head|body)\b/i.test(html)) {
      addError(`${rel(defaultDescription)} should be an itch description fragment, not a full HTML document`);
    }
    if (/<script\b/i.test(html)) {
      addError(`${rel(defaultDescription)} contains <script>, which should not be pasted into itch copy`);
    }
    if (!/<p\b/i.test(html) || !/<h[1-3]\b/i.test(html)) {
      addError(`${rel(defaultDescription)} is missing expected paragraph/section HTML copy`);
    }
    const title = manifest.core_fields?.title;
    if (typeof title === 'string' && !html.includes(title) && !html.includes('ГИГАХРУЩ')) {
      addError(`${rel(defaultDescription)} does not mention the game title`);
    }
  }

  if (fallbackDescription) {
    await pathStat(fallbackDescription);
    const markdown = await readText(fallbackDescription, rel(fallbackDescription));
    if (!markdown.trim()) addError(`${rel(fallbackDescription)} is empty`);
  }

  if (css) await pathStat(css);
}

async function checkManifestAssets(manifest) {
  if (!Array.isArray(manifest.uploads) || manifest.uploads.length === 0) {
    addError('upload_manifest.json must contain a non-empty uploads array');
  } else {
    for (const upload of manifest.uploads) {
      if (!isObject(upload)) {
        addError('Each uploads entry must be an object');
        continue;
      }
      const absPath = resolvePackPath(upload.path, `uploads.${upload.role ?? '?'}.path`);
      const expectedDimensions = parseDimensions(upload.dimensions);
      if (!expectedDimensions) addError(`Upload ${upload.path ?? upload.role ?? '?'} has invalid dimensions "${upload.dimensions}"`);
      if (!absPath || !expectedDimensions) continue;
      const expectedType = path.extname(absPath).toLowerCase() === '.gif' ? 'gif' : 'png';
      await checkImage(absPath, `upload ${upload.role ?? upload.path}`, expectedDimensions, expectedType);
    }
  }

  if (!Array.isArray(manifest.screenshots) || manifest.screenshots.length === 0) {
    addError('upload_manifest.json must contain a non-empty screenshots array');
  } else {
    const screenshotDimensions = new Map();
    for (const [index, screenshotPath] of manifest.screenshots.entries()) {
      const absPath = resolvePackPath(screenshotPath, `screenshots.${index}`);
      if (!absPath) continue;
      const actual = await checkImage(absPath, `screenshot ${index + 1}`, null, 'png');
      if (!actual) continue;
      const dimensions = formatDimensions(actual);
      screenshotDimensions.set(dimensions, (screenshotDimensions.get(dimensions) ?? 0) + 1);
      const aspect = actual.width / actual.height;
      if (aspect < 1.55 || aspect > 1.85) {
        addError(`Screenshot ${index + 1} has an unusual aspect ratio: ${rel(absPath)} (${dimensions})`);
      }
    }
    if (screenshotDimensions.size > 0) {
      const summary = [...screenshotDimensions.entries()].map(([dimensions, count]) => `${count}x ${dimensions}`).join(', ');
      addInfo(`screenshots: ${manifest.screenshots.length} files (${summary})`);
    }
  }

  if (Array.isArray(manifest.cover_alternatives)) {
    for (const [index, coverPath] of manifest.cover_alternatives.entries()) {
      const absPath = resolvePackPath(coverPath, `cover_alternatives.${index}`);
      if (!absPath) continue;
      const expectedDimensions = dimensionsFromFilename(coverPath) ?? { width: 630, height: 500 };
      await checkImage(absPath, `cover alternative ${index + 1}`, expectedDimensions, 'png');
    }
  }
}

async function checkFilenameDimensions() {
  const files = await collectFiles(packDir);
  for (const entry of files) {
    if (!/\.(png|gif)$/i.test(entry.relPath)) continue;
    const expectedDimensions = dimensionsFromFilename(entry.relPath);
    if (!expectedDimensions) continue;
    const expectedType = entry.relPath.toLowerCase().endsWith('.gif') ? 'gif' : 'png';
    await checkImage(entry.absPath, 'filename dimension asset', expectedDimensions, expectedType);
  }
}

async function checkLocalPreviewReferences(htmlRelPath) {
  const htmlAbsPath = resolvePackPath(htmlRelPath, htmlRelPath);
  if (!htmlAbsPath || !await pathStat(htmlAbsPath)) return [];
  const html = await readText(htmlAbsPath, htmlRelPath);
  const refs = extractLocalReferences(html, htmlRelPath);
  const deps = [htmlAbsPath];
  for (const ref of refs) {
    const absPath = resolvePackPath(ref, `${htmlRelPath} reference`);
    if (!absPath) continue;
    const meta = await pathStat(absPath);
    if (meta) deps.push(absPath);
  }
  return deps;
}

async function checkStaleFile(targetRelPath, dependencyRelPaths, label) {
  const targetPath = resolvePackPath(targetRelPath, label);
  if (!targetPath) return;
  const targetMeta = await pathStat(targetPath, false);
  if (!targetMeta) {
    addWarning(`Missing ${label}: ${targetRelPath}`);
    return;
  }

  let newestDependency = null;
  for (const depRelPath of dependencyRelPaths) {
    const depPath = resolvePackPath(depRelPath, `${label} dependency`);
    if (!depPath) continue;
    const depMeta = await pathStat(depPath, false);
    if (!depMeta) continue;
    if (!newestDependency || depMeta.mtimeMs > newestDependency.mtimeMs) {
      newestDependency = { relPath: depRelPath, mtimeMs: depMeta.mtimeMs };
    }
  }

  if (newestDependency && targetMeta.mtimeMs + STALE_TOLERANCE_MS < newestDependency.mtimeMs) {
    addWarning(`${label} may be stale: ${targetRelPath} is older than ${newestDependency.relPath}`);
  }
}

async function checkStalePreviewsAndScreenshots() {
  const previewDeps = new Map();
  for (const preview of LOCAL_PREVIEW_SHOTS) {
    if (!previewDeps.has(preview.html)) {
      const deps = await checkLocalPreviewReferences(preview.html);
      previewDeps.set(preview.html, deps.map(dep => path.relative(packDir, dep).split(path.sep).join('/')));
    }
    await checkStaleFile(preview.image, previewDeps.get(preview.html), 'local preview screenshot');
  }

  const generatorScripts = [
    'scripts_generate_assets.py',
    'scripts_generate_overkill_assets.py',
    'scripts_generate_v3_assets.py',
  ];
  for (const [screenshot, source] of SCREENSHOT_SOURCE_PAIRS) {
    await checkStaleFile(screenshot, [source, ...generatorScripts], 'enhanced screenshot');
  }
}

async function checkFieldCopyReferences() {
  const fieldsPath = resolvePackPath('itch_fields_ru.md', 'itch_fields_ru.md');
  if (!fieldsPath || !await pathStat(fieldsPath)) return;
  const fields = await readText(fieldsPath, 'itch_fields_ru.md');
  const pathRefs = [...fields.matchAll(/`([^`]+\.(?:png|gif|html|md|css|json))`/gi)].map(match => match[1]);
  for (const ref of pathRefs) {
    const absPath = resolvePackPath(ref, 'itch_fields_ru.md path');
    if (absPath) await pathStat(absPath);
  }
}

async function checkZipStructure() {
  await pathStat(itchHtml);
  await pathStat(itchNotes);
  const zipMeta = await pathStat(itchZip);
  if (!zipMeta) return;

  const entries = await listZipEntries(itchZip);
  if (entries.length === 0) return;

  const names = entries.map(entry => entry.name);
  for (const name of names) {
    if (name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) {
      addError(`ZIP entry is not a clean relative POSIX path: ${name}`);
    }
  }
  if (!names.includes('index.html')) {
    addError('ZIP must contain index.html at the archive root');
  }
  const rootFiles = names.filter(name => !name.includes('/'));
  if (rootFiles.length === 0) {
    addError('ZIP appears to have a wrapper directory; root must contain index.html directly');
  }

  const distFiles = await collectFiles(distDir);
  if (distFiles.length > 0) {
    const expected = distFiles.map(entry => entry.relPath).filter(name => !DIST_ONLY_FILES.has(name)).sort();
    const actual = [...names].sort();
    const missing = expected.filter(name => !actual.includes(name));
    const extra = actual.filter(name => !expected.includes(name));
    for (const name of missing) addError(`ZIP is missing dist file at root: ${name}`);
    for (const name of extra) addError(`ZIP contains unexpected file not present in dist: ${name}`);
  } else {
    addWarning('dist/ is missing or empty; run npm run itch:build before verifying ZIP contents against the build output');
  }

  const htmlMeta = await pathStat(itchHtml, false);
  const distHtmlMeta = await pathStat(path.resolve(distDir, 'index.html'), false);
  if (htmlMeta && distHtmlMeta && htmlMeta.size !== distHtmlMeta.size) {
    addError(`itch/index.html size (${htmlMeta.size}) does not match dist/index.html (${distHtmlMeta.size})`);
  }

  addInfo(`zip: ${entries.length} root-relative files, ${zipMeta.size} bytes`);
}

async function main() {
  const manifest = await readJson(manifestPath, rel(manifestPath));
  if (!isObject(manifest)) {
    addError('upload_manifest.json must be a JSON object');
  } else {
    await checkHtmlCopy(manifest);
    await checkManifestAssets(manifest);
  }

  await checkFieldCopyReferences();
  await checkFilenameDimensions();
  await checkStalePreviewsAndScreenshots();
  await checkZipStructure();

  for (const info of infos) console.log(`OK   ${info}`);
  for (const warning of warnings) console.warn(`WARN ${warning}`);
  for (const error of errors) console.error(`FAIL ${error}`);

  if (errors.length > 0) {
    console.error(`Itch pack verification failed: ${errors.length} error(s), ${warnings.length} warning(s).`);
    process.exitCode = 1;
  } else {
    console.log(`Itch pack verification passed: ${warnings.length} warning(s).`);
  }
}

await main();
