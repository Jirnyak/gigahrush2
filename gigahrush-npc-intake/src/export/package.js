import { renderPreviewPng } from '../demos_preview/preview.js';
import { validateSpritePayload } from '../sprite_lab/sprite.js';
import { createZip } from './zip.js';

function json(data) {
  return `${JSON.stringify(data, null, 2)}\n`;
}

export function stripSpriteForRuntime(spritePayload) {
  if (!spritePayload) return undefined;
  return {
    format: spritePayload.format,
    width: spritePayload.width,
    height: spritePayload.height,
    palette: spritePayload.palette,
    rle: spritePayload.rle,
    anchor: spritePayload.anchor,
    portraitCrop: spritePayload.portraitCrop,
  };
}

export function validateExportReadiness({ validation, spritePayload, consent }) {
  const errors = [...(validation?.errors ?? [])];
  const warnings = [...(validation?.warnings ?? [])];
  if (!consent?.accepted) errors.push('consent is required before export');
  if (!spritePayload) errors.push('sprite is required before export');
  if (spritePayload) {
    const spriteValidation = validateSpritePayload(stripSpriteForRuntime(spritePayload));
    errors.push(...spriteValidation.errors);
    warnings.push(...spriteValidation.warnings);
  }
  return { ready: errors.length === 0, errors, warnings };
}

export async function buildNpcPackageZip({ pack, validation, spritePayload, portraitBlob, sourceBlob, consent }) {
  const sprite = stripSpriteForRuntime(spritePayload);
  const readiness = validateExportReadiness({ validation, spritePayload: sprite, consent });
  const previewBlob = await renderPreviewPng(pack, portraitBlob);
  const root = pack.id;
  const files = [
    { path: `${root}/npc.json`, data: json(pack) },
    { path: `${root}/sprite.rle.json`, data: json(sprite ?? { invalid: true }) },
    { path: `${root}/portrait.png`, data: portraitBlob ?? new Blob([]) },
    { path: `${root}/preview.png`, data: previewBlob ?? new Blob([]) },
    { path: `${root}/consent.json`, data: json(consent) },
    {
      path: `${root}/README.md`,
      data: [
        `# ${pack.id}`,
        '',
        'Exported by gigahrush-npc-intake.',
        '',
        `Validation: ${readiness.ready ? 'valid' : 'invalid'}`,
        readiness.errors.length ? `Errors:\n${readiness.errors.map(err => `- ${err}`).join('\n')}` : 'Errors: none',
        readiness.warnings.length ? `Warnings:\n${readiness.warnings.map(warn => `- ${warn}`).join('\n')}` : 'Warnings: none',
        '',
        'Runtime consumes npc.json and sprite.rle.json after TENEVIK review.',
      ].join('\n'),
    },
  ];
  if (sourceBlob) files.push({ path: `${root}/source.png`, data: sourceBlob });
  return createZip(files);
}
