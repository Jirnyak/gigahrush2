export const SPRITE_RLE_FORMAT = 'gigahrush_sprite_rle_v1';
export const DEFAULT_SPRITE_SIZE = 64;
export const DEFAULT_PALETTE_LIMIT = 32;

function base64FromBytes(bytes) {
  if (typeof btoa === 'function') {
    let text = '';
    for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
    return btoa(text);
  }
  return Buffer.from(bytes).toString('base64');
}

function bytesFromBase64(text) {
  if (typeof atob === 'function') {
    const raw = atob(text);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(text, 'base64'));
}

function rgbaHex(r, g, b, a = 255) {
  return `#${[r, g, b, a].map(v => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('')}`;
}

function parseHex(hex) {
  const s = String(hex).replace(/^#/, '');
  return [
    Number.parseInt(s.slice(0, 2), 16) || 0,
    Number.parseInt(s.slice(2, 4), 16) || 0,
    Number.parseInt(s.slice(4, 6), 16) || 0,
    s.length >= 8 ? Number.parseInt(s.slice(6, 8), 16) || 0 : 255,
  ];
}

function bucketColor(r, g, b, a) {
  if (a < 24) return '#00000000';
  const qr = Math.round(r / 17) * 17;
  const qg = Math.round(g / 17) * 17;
  const qb = Math.round(b / 17) * 17;
  return rgbaHex(qr, qg, qb, 255);
}

function colorDistance(a, b) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2 + (a[3] - b[3]) ** 2;
}

function nearestPaletteIndex(color, paletteRgba) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 1; i < paletteRgba.length; i++) {
    const dist = colorDistance(color, paletteRgba[i]);
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  }
  return best;
}

export function encodeRleIndexes(indexes) {
  const bytes = [];
  for (let i = 0; i < indexes.length;) {
    const value = indexes[i];
    let count = 1;
    while (i + count < indexes.length && indexes[i + count] === value && count < 255) count++;
    bytes.push(count, value);
    i += count;
  }
  return base64FromBytes(Uint8Array.from(bytes));
}

export function decodeRleIndexes(rle, expectedLength) {
  const bytes = bytesFromBase64(rle);
  const out = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const count = bytes[i];
    const value = bytes[i + 1];
    for (let j = 0; j < count; j++) out.push(value);
  }
  if (expectedLength !== undefined && out.length !== expectedLength) {
    throw new Error(`RLE decoded to ${out.length}, expected ${expectedLength}`);
  }
  return Uint8Array.from(out);
}

export function quantizeRgbaToSpritePayload(rgba, width, height, options = {}) {
  const maxColors = Math.max(2, Math.min(255, options.maxColors ?? DEFAULT_PALETTE_LIMIT));
  const counts = new Map();
  for (let i = 0; i < rgba.length; i += 4) {
    const key = bucketColor(rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]);
    if (key === '#00000000') continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const palette = ['#00000000', ...[...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxColors - 1)
    .map(([key]) => key)];
  const paletteRgba = palette.map(parseHex);
  const paletteIndex = new Map(palette.map((key, index) => [key, index]));
  const indexes = new Uint8Array(width * height);
  let opaque = 0;
  for (let src = 0, dst = 0; src < rgba.length; src += 4, dst++) {
    const a = rgba[src + 3];
    if (a < 24) {
      indexes[dst] = 0;
      continue;
    }
    opaque++;
    const key = bucketColor(rgba[src], rgba[src + 1], rgba[src + 2], a);
    indexes[dst] = paletteIndex.get(key) ?? nearestPaletteIndex([rgba[src], rgba[src + 1], rgba[src + 2], 255], paletteRgba);
  }
  return {
    format: SPRITE_RLE_FORMAT,
    width,
    height,
    palette,
    rle: encodeRleIndexes(indexes),
    anchor: {
      feetX: Math.floor(width / 2),
      feetY: Math.max(0, height - 2),
    },
    portraitCrop: {
      x: Math.floor(width * 0.18),
      y: Math.floor(height * 0.03),
      w: Math.floor(width * 0.64),
      h: Math.floor(height * 0.58),
    },
    stats: {
      opaquePixels: opaque,
      paletteColors: palette.length,
      rleBytes: Math.ceil((encodeRleIndexes(indexes).length * 3) / 4),
    },
  };
}

export function validateSpritePayload(payload, options = {}) {
  const errors = [];
  const warnings = [];
  const maxSize = options.maxSize ?? DEFAULT_SPRITE_SIZE;
  const maxPalette = options.maxPalette ?? DEFAULT_PALETTE_LIMIT;
  if (!payload || typeof payload !== 'object') errors.push('sprite payload missing');
  if (payload?.format !== SPRITE_RLE_FORMAT) errors.push('sprite format must be gigahrush_sprite_rle_v1');
  if (!Number.isInteger(payload?.width) || !Number.isInteger(payload?.height)) errors.push('sprite width/height must be integers');
  if (payload?.width > maxSize || payload?.height > maxSize || payload?.width < 1 || payload?.height < 1) errors.push(`sprite size must be 1..${maxSize}`);
  if (!Array.isArray(payload?.palette) || payload.palette.length < 2 || payload.palette.length > maxPalette) errors.push(`palette must contain 2..${maxPalette} colors`);
  if (typeof payload?.rle !== 'string' || payload.rle.length < 4) errors.push('rle string is required');
  try {
    const indexes = decodeRleIndexes(payload?.rle ?? '', (payload?.width ?? 0) * (payload?.height ?? 0));
    const opaque = indexes.reduce((sum, index) => sum + (index === 0 ? 0 : 1), 0);
    if (opaque <= 0) errors.push('sprite has no opaque pixels');
    else if (opaque < 80) warnings.push('silhouette has very few opaque pixels');
    if (opaque > payload.width * payload.height * 0.88) warnings.push('sprite is almost solid; transparency/readability may be poor');
    if (indexes.some(index => index >= payload.palette.length)) errors.push('rle index exceeds palette length');
  } catch (err) {
    errors.push(err instanceof Error ? err.message : 'bad RLE payload');
  }
  const anchor = payload?.anchor;
  if (!anchor || anchor.feetX < 0 || anchor.feetX >= payload.width || anchor.feetY < 0 || anchor.feetY >= payload.height) {
    errors.push('anchor feetX/feetY must sit inside sprite bounds');
  }
  const crop = payload?.portraitCrop;
  if (!crop || crop.x < 0 || crop.y < 0 || crop.w < 1 || crop.h < 1 || crop.x + crop.w > payload.width || crop.y + crop.h > payload.height) {
    errors.push('portraitCrop must sit inside sprite bounds');
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function findOpaqueBounds(imageData, threshold = 16) {
  const { data, width, height } = imageData;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha <= threshold) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return { x: 0, y: 0, w: width, h: height, empty: true };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, empty: false };
}

export function cropRectWithin(rect, width, height) {
  const x = Math.max(0, Math.min(width - 1, Math.trunc(rect.x ?? 0)));
  const y = Math.max(0, Math.min(height - 1, Math.trunc(rect.y ?? 0)));
  const w = Math.max(1, Math.min(width - x, Math.trunc(rect.w ?? width)));
  const h = Math.max(1, Math.min(height - y, Math.trunc(rect.h ?? height)));
  return { x, y, w, h };
}

export function canvasToBlob(canvas, type = 'image/png') {
  return new Promise(resolve => canvas.toBlob(blob => resolve(blob), type));
}

export async function normalizeSourceCanvas(sourceCanvas, options = {}) {
  const size = options.size ?? DEFAULT_SPRITE_SIZE;
  const sourceCtx = sourceCanvas.getContext('2d');
  const sourceData = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const autoBounds = findOpaqueBounds(sourceData);
  const bodyCrop = cropRectWithin(options.bodyCrop ?? autoBounds, sourceCanvas.width, sourceCanvas.height);

  const spriteCanvas = document.createElement('canvas');
  spriteCanvas.width = size;
  spriteCanvas.height = size;
  const spriteCtx = spriteCanvas.getContext('2d', { willReadFrequently: true });
  spriteCtx.imageSmoothingEnabled = false;
  spriteCtx.clearRect(0, 0, size, size);
  spriteCtx.drawImage(sourceCanvas, bodyCrop.x, bodyCrop.y, bodyCrop.w, bodyCrop.h, 0, 0, size, size);
  const imageData = spriteCtx.getImageData(0, 0, size, size);
  const payload = quantizeRgbaToSpritePayload(imageData.data, size, size, { maxColors: options.maxColors });

  const portraitCrop = cropRectWithin(options.portraitCrop ?? payload.portraitCrop, size, size);
  payload.portraitCrop = portraitCrop;
  const portraitCanvas = document.createElement('canvas');
  portraitCanvas.width = 128;
  portraitCanvas.height = 128;
  const portraitCtx = portraitCanvas.getContext('2d');
  portraitCtx.imageSmoothingEnabled = false;
  portraitCtx.clearRect(0, 0, 128, 128);
  portraitCtx.drawImage(spriteCanvas, portraitCrop.x, portraitCrop.y, portraitCrop.w, portraitCrop.h, 0, 0, 128, 128);

  return {
    payload,
    autoBounds,
    bodyCrop,
    portraitCrop,
    spriteCanvas,
    portraitCanvas,
    spriteBlob: await canvasToBlob(spriteCanvas),
    portraitBlob: await canvasToBlob(portraitCanvas),
  };
}

export async function fileToCanvas(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  return canvas;
}
