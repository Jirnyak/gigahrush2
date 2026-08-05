import { lookupHints } from './data/lookup_hints.js';
import { ambientTalkLine, deterministicDemosPost, relationBand, renderDemosPreview, renderPreviewPng } from './demos_preview/preview.js';
import { buildNpcPackageZip, stripSpriteForRuntime, validateExportReadiness } from './export/package.js';
import { downloadBytes } from './export/zip.js';
import { consentFromDraft, formToDraft, populateLookupControls } from './form/state.js';
import { displayNpcName, makeNpcId, validateNpcPackage } from './form/schema.js';
import { canvasToBlob, fileToCanvas, normalizeSourceCanvas, validateSpritePayload } from './sprite_lab/sprite.js';
import { localSubmissionInstructions } from './submit/submit.js';

const form = document.querySelector('#npcForm');
const exportButton = document.querySelector('#exportZip');
const submitButton = document.querySelector('#submitPackage');
const lookupStatus = document.querySelector('#lookupStatus');
const validationBox = document.querySelector('#validationBox');
const demosPreview = document.querySelector('#demosPreview');
const spriteFile = document.querySelector('#spriteFile');
const drawCanvas = document.querySelector('#drawCanvas');
const spriteCanvas = document.querySelector('#spriteCanvas');
const spriteStatus = document.querySelector('#spriteStatus');
const pencilButton = document.querySelector('#drawPencil');
const eraseButton = document.querySelector('#drawErase');
const clearButton = document.querySelector('#drawClear');
const questionnaireSearch = document.querySelector('#questionnaireSearch');
const questionnaireList = document.querySelector('#questionnaireList');
const questionnaireDetails = document.querySelector('#questionnaireDetails');

const cropInputs = {
  bodyX: document.querySelector('#bodyX'),
  bodyY: document.querySelector('#bodyY'),
  bodyW: document.querySelector('#bodyW'),
  bodyH: document.querySelector('#bodyH'),
  portraitX: document.querySelector('#portraitX'),
  portraitY: document.querySelector('#portraitY'),
  portraitW: document.querySelector('#portraitW'),
  portraitH: document.querySelector('#portraitH'),
};

const state = {
  drawMode: 'pencil',
  sourceCanvas: drawCanvas,
  sourceBlob: null,
  spritePayload: null,
  spriteBlob: null,
  portraitBlob: null,
  portraitUrl: '',
  lastValidation: null,
  lastConsent: null,
};
const encoder = new TextEncoder();

function submissionEndpoint() {
  return globalThis.GIGAHRUSH_NPC_SUBMIT_ENDPOINT || '/api/npc-intake/submit';
}

async function sha256Hex(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function jsonBytes(value) {
  return encoder.encode(`${JSON.stringify(value, null, 2)}\n`);
}

function readCropInputs() {
  return {
    bodyCrop: {
      x: Number(cropInputs.bodyX.value),
      y: Number(cropInputs.bodyY.value),
      w: Number(cropInputs.bodyW.value),
      h: Number(cropInputs.bodyH.value),
    },
    portraitCrop: {
      x: Number(cropInputs.portraitX.value),
      y: Number(cropInputs.portraitY.value),
      w: Number(cropInputs.portraitW.value),
      h: Number(cropInputs.portraitH.value),
    },
  };
}

function writeCropInputs(normalized) {
  cropInputs.bodyX.value = normalized.bodyCrop.x;
  cropInputs.bodyY.value = normalized.bodyCrop.y;
  cropInputs.bodyW.value = normalized.bodyCrop.w;
  cropInputs.bodyH.value = normalized.bodyCrop.h;
  cropInputs.portraitX.value = normalized.portraitCrop.x;
  cropInputs.portraitY.value = normalized.portraitCrop.y;
  cropInputs.portraitW.value = normalized.portraitCrop.w;
  cropInputs.portraitH.value = normalized.portraitCrop.h;
}

function setPortraitUrl(blob) {
  if (state.portraitUrl) URL.revokeObjectURL(state.portraitUrl);
  state.portraitUrl = blob ? URL.createObjectURL(blob) : '';
}

function clearSpriteState() {
  if (spriteFile) spriteFile.value = '';
  state.sourceCanvas = drawCanvas;
  state.sourceBlob = null;
  state.spritePayload = null;
  state.spriteBlob = null;
  state.portraitBlob = null;
  setPortraitUrl(null);
}

function drawNormalizedSprite(canvas) {
  const ctx = spriteCanvas.getContext('2d');
  ctx.clearRect(0, 0, spriteCanvas.width, spriteCanvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, 0, 0, spriteCanvas.width, spriteCanvas.height);
}

function previewCanvasFromPackedPixels(pixels, size) {
  if (!Array.isArray(pixels) || pixels.length !== size * size) return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const packed = new Uint32Array(image.data.buffer);
  packed.set(Uint32Array.from(pixels, pixel => Number(pixel) >>> 0));
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function drawPresetVisualPreview(pack) {
  const ctx = spriteCanvas.getContext('2d');
  const size = Number(pack?.visualPreviewSize || lookupHints.spritePreviewSize) || 64;
  const spritePreview = pack?.sprite === '' || pack?.sprite === undefined
    ? undefined
    : lookupHints.spritePreviews?.[String(pack.sprite)];
  const canvas = previewCanvasFromPackedPixels(pack?.visualPreview ?? spritePreview, size);
  if (canvas) {
    drawNormalizedSprite(canvas);
    return true;
  }
  ctx.clearRect(0, 0, spriteCanvas.width, spriteCanvas.height);
  ctx.fillStyle = '#0a0b09';
  ctx.fillRect(0, 0, spriteCanvas.width, spriteCanvas.height);
  ctx.strokeStyle = '#d7c06a';
  ctx.strokeRect(0.5, 0.5, spriteCanvas.width - 1, spriteCanvas.height - 1);
  ctx.fillStyle = '#d7c06a';
  ctx.font = '11px monospace';
  ctx.fillText('game visual', 12, 52);
  ctx.fillStyle = '#aeb7a0';
  ctx.fillText(String(pack?.npcVisualId ?? 'preset').slice(0, 18), 12, 72);
  return false;
}

async function normalizeCurrentSource(useExistingCrop = true) {
  if (!state.sourceCanvas) return;
  const options = useExistingCrop ? readCropInputs() : {};
  const normalized = await normalizeSourceCanvas(state.sourceCanvas, options);
  if (!useExistingCrop) writeCropInputs(normalized);
  state.spritePayload = normalized.payload;
  state.spriteBlob = normalized.spriteBlob;
  state.portraitBlob = normalized.portraitBlob;
  state.sourceBlob = await canvasToBlob(state.sourceCanvas);
  setPortraitUrl(normalized.portraitBlob);
  drawNormalizedSprite(normalized.spriteCanvas);
  const spriteValidation = validateSpritePayload(normalized.payload);
  const messages = [
    `format: ${normalized.payload.format}`,
    `size: ${normalized.payload.width}x${normalized.payload.height}`,
    `palette: ${normalized.payload.palette.length}`,
    `opaque pixels: ${normalized.payload.stats.opaquePixels}`,
    ...spriteValidation.errors.map(error => `ERROR: ${error}`),
    ...spriteValidation.warnings.map(warning => `WARN: ${warning}`),
  ];
  spriteStatus.textContent = messages.join('\n');
  updatePreview();
}

function draftWithAutoId() {
  const draft = formToDraft(form);
  if (!draft.id || draft.id === 'npc_draft') {
    draft.id = makeNpcId([displayNpcName(draft.identity), draft.identity.nickname].filter(Boolean).join(' '));
  }
  return draft;
}

function updatePreview() {
  const draft = draftWithAutoId();
  const validation = validateNpcPackage(draft, lookupHints);
  const consent = consentFromDraft(draft);
  const readiness = validateExportReadiness({ validation, spritePayload: state.spritePayload, consent });
  state.lastValidation = validation;
  state.lastConsent = consent;
  renderDemosPreview(demosPreview, { pack: validation.package, portraitUrl: state.portraitUrl, validation });
  validationBox.textContent = [
    readiness.errors.length ? 'Errors:' : 'Errors: none',
    ...readiness.errors.map(error => `- ${error}`),
    readiness.warnings.length ? 'Warnings:' : 'Warnings: none',
    ...readiness.warnings.map(warning => `- ${warning}`),
  ].join('\n');
  exportButton.disabled = !readiness.ready;
  submitButton.disabled = !readiness.ready;
}

function lookupLabel(entries, id) {
  const key = String(id ?? '').toLowerCase();
  const entry = entries.find(candidate => String(candidate.id).toLowerCase() === key || String(candidate.name).toLowerCase() === key);
  return entry?.label || entry?.name || id || 'unknown';
}

function submissionPreview(pack) {
  const relation = relationBand(pack.social?.playerRelation ?? 0);
  return {
    publicLine: pack.bio?.publicLine ?? '',
    floorLabel: pack.placement?.homeFloorKey ?? '',
    faction: lookupLabel(lookupHints.factions, pack.affiliation?.faction),
    occupation: lookupLabel(lookupHints.occupations, pack.affiliation?.occupation),
    sex: pack.demographics?.sex ?? '',
    age: pack.demographics?.age,
    relationBand: relation.label,
    samplePost: deterministicDemosPost(pack),
    sampleTalk: ambientTalkLine(pack),
  };
}

function submissionMetadata({ draft, pack, zipHash, spriteHash }) {
  const publicCredit = String(draft.consent?.publicCredit ?? '').trim();
  return {
    packageId: pack.id,
    authorDisplayName: publicCredit || pack.id,
    authorContactPrivate: String(draft.consent?.privateContact ?? '').trim(),
    publicCreditName: publicCredit || pack.id,
    consentAccepted: Boolean(draft.consent?.accepted),
    consentAcceptedAt: new Date().toISOString(),
    schemaVersion: pack.version ?? 1,
    packageHash: zipHash,
    spriteHash,
    preview: submissionPreview(pack),
  };
}

async function submitPackageToDeveloper() {
  const draft = draftWithAutoId();
  const validation = validateNpcPackage(draft, lookupHints);
  const consent = consentFromDraft(draft);
  const readiness = validateExportReadiness({ validation, spritePayload: state.spritePayload, consent });
  if (!String(draft.consent?.privateContact ?? '').trim()) {
    readiness.errors.push('private contact is required for online submit');
  }
  if (!readiness.ready || readiness.errors.length) {
    spriteStatus.textContent = [
      'Online submit blocked.',
      ...readiness.errors.map(error => `ERROR: ${error}`),
      ...readiness.warnings.map(warning => `WARN: ${warning}`),
    ].join('\n');
    updatePreview();
    return;
  }

  submitButton.disabled = true;
  exportButton.disabled = true;
  spriteStatus.textContent = 'Sending package to TENEVIK review inbox...';

  try {
    const pack = validation.package;
    const sprite = stripSpriteForRuntime(state.spritePayload);
    const zip = await buildNpcPackageZip({
      pack,
      validation,
      spritePayload: state.spritePayload,
      portraitBlob: state.portraitBlob,
      sourceBlob: state.sourceBlob,
      consent,
    });
    const previewBlob = await renderPreviewPng(pack, state.portraitBlob);
    const zipHash = await sha256Hex(zip);
    const spriteHash = await sha256Hex(jsonBytes(sprite));
    const metadata = submissionMetadata({ draft, pack, zipHash, spriteHash });

    const body = new FormData();
    body.set('metadataJson', JSON.stringify(metadata));
    body.set('packageZip', new Blob([zip], { type: 'application/zip' }), `${pack.id}.zip`);
    if (state.sourceBlob) body.set('sourceSprite', state.sourceBlob, `${pack.id}_source.png`);
    if (previewBlob) body.set('previewPng', previewBlob, `${pack.id}_preview.png`);

    const response = await fetch(submissionEndpoint(), { method: 'POST', body });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { error: text.slice(0, 240) };
    }
    if (!response.ok || payload.ok !== true) {
      throw new Error(payload.error || `submit failed: ${response.status}`);
    }
    spriteStatus.textContent = [
      'Submission received by TENEVIK review inbox.',
      `submissionId: ${payload.submissionId}`,
      `packageId: ${payload.packageId}`,
      `status: ${payload.status}`,
      `review export folder: ${payload.exportFolder}`,
    ].join('\n');
  } catch (err) {
    spriteStatus.textContent = [
      'Online submit failed.',
      `ERROR: ${err instanceof Error ? err.message : String(err)}`,
      'Use Export ZIP as fallback and send it through the manual review channel.',
    ].join('\n');
  } finally {
    updatePreview();
  }
}

function setControlValue(name, value) {
  const control = form.elements[name];
  if (!control) return;
  control.value = value ?? '';
}

function templateId(pack) {
  return makeNpcId(`${pack.id}_template`);
}

function applyQuestionnaireTemplate(pack) {
  if (!pack) return;
  form.reset();
  setControlValue('id', templateId(pack));
  setControlValue('kind', pack.kind || 'procedural');
  setControlValue('nickname', '');
  setControlValue('displayName', pack.displayName || '');
  setControlValue('publicLine', pack.publicLine || '');
  setControlValue('sex', pack.sex || 'male');
  setControlValue('age', pack.age || 25);
  setControlValue('faction', pack.faction || lookupHints.factions?.[0]?.id || '');
  setControlValue('occupation', pack.occupation || lookupHints.occupations?.[0]?.id || '');
  setControlValue('npcVisualId', pack.npcVisualId || '');
  setControlValue('sprite', pack.sprite ?? '');
  setControlValue('spriteSeed', pack.spriteSeed ?? 1);
  setControlValue('portraitHint', pack.portraitHint || '');
  setControlValue('homeFloorKey', pack.homeFloorKey || 'story:living');
  setControlValue('presence', pack.presence || (pack.kind === 'procedural' ? 'population' : 'anchor'));
  setControlValue('mobility', pack.kind === 'procedural' ? 'cold_movable' : 'fixed_home');
  setControlValue('roleTags', [pack.kind, pack.id, ...(pack.voiceTags || [])].filter(Boolean).join(', '));
  setControlValue('origin', pack.homeFloorKey || '');
  setControlValue('work', lookupLabel(lookupHints.occupations, pack.occupation));
  setControlValue('talkLines', (pack.talkLines || []).join('\n'));
  setControlValue('talkLinesPost', (pack.talkLinesPost || []).join('\n'));
  setControlValue('voiceTags', (pack.voiceTags || []).join(', '));
  setControlValue('contentProposalType', pack.kind === 'plot' ? 'quest_seed' : 'none');
  setControlValue(
    'contentProposalText',
    `Шаблон из существующей ${pack.kind || 'game'} анкеты ${pack.id}. Источник: ${pack.sourceFile || pack.source || 'game'}${pack.sourceLine ? `:${pack.sourceLine}` : ''}. Перед экспортом поменяйте id и факты.`,
  );
  clearSpriteState();
  drawCanvas.getContext('2d').clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  if (pack.npcVisualId || (pack.sprite !== '' && pack.sprite !== undefined)) {
    const hasPixels = drawPresetVisualPreview(pack);
    spriteStatus.textContent = [
      'Game preset visual from selected template.',
      `npcVisualId: ${pack.npcVisualId || 'occupation/default'}`,
      `sprite: ${pack.sprite === '' || pack.sprite === undefined ? 'occupation/default' : pack.sprite}`,
      `spriteSeed: ${pack.spriteSeed ?? 1}`,
      hasPixels ? 'preview: generated from game visual registry' : 'preview: preset id only; generated pixels unavailable',
      'Upload/draw a sprite only if replacing this preset for export.',
    ].join('\n');
  } else {
    drawNormalizedSprite(drawCanvas);
    spriteStatus.textContent = 'Template uses occupation/default sprite. Draw or upload a sprite to replace it.';
  }
  updatePreview();
}

function questionnaireSearchText(pack) {
  return [
    pack.id,
    pack.displayName,
    pack.publicLine,
    pack.kind,
    pack.faction,
    pack.occupation,
    pack.homeFloorKey,
    pack.npcVisualId,
  ].join(' ').toLowerCase();
}

function renderQuestionnaireDetails(pack) {
  if (!pack) {
    questionnaireDetails.textContent = 'Выберите анкету из списка. Нажатие на карточку заполнит форму как шаблон.';
    return;
  }
  const faction = lookupLabel(lookupHints.factions, pack.faction);
  const occupation = lookupLabel(lookupHints.occupations, pack.occupation);
  questionnaireDetails.textContent = [
    `${pack.displayName} (${pack.id})`,
    `kind: ${pack.kind}`,
    `home: ${pack.homeFloorKey || 'unknown'}`,
    `presence: ${pack.presence || 'unknown'}`,
    `sex/age: ${pack.sex || 'unknown'} / ${pack.age || 'unknown'}`,
    `faction: ${faction}`,
    `occupation: ${occupation}`,
    `visual: ${pack.npcVisualId || 'occupation/default'}${pack.sprite === '' || pack.sprite === undefined ? '' : ` / sprite ${pack.sprite}`}`,
    `source: ${pack.sourceFile || pack.source || 'game'}${pack.sourceLine ? `:${pack.sourceLine}` : ''}`,
    `template id: ${templateId(pack)}`,
    '',
    pack.publicLine || 'Публичная строка не задана.',
    '',
    'Нажмите карточку, чтобы заполнить форму этим шаблоном.',
  ].join('\n');
}

function renderQuestionnaireList() {
  const packs = lookupHints.npcPackageSummaries || [];
  const query = questionnaireSearch.value.trim().toLowerCase();
  const visible = query ? packs.filter(pack => questionnaireSearchText(pack).includes(query)) : packs;
  questionnaireList.innerHTML = '';
  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'questionnaire-empty';
    empty.textContent = packs.length === 0 ? 'Готовые анкеты не сгенерированы.' : 'Ничего не найдено.';
    questionnaireList.appendChild(empty);
    renderQuestionnaireDetails(null);
    return;
  }
  for (const pack of visible) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'questionnaire-card';
    button.dataset.packageId = pack.id;
    const title = document.createElement('strong');
    title.textContent = pack.displayName;
    const meta = document.createElement('span');
    const visual = pack.npcVisualId ? ` · visual ${pack.npcVisualId}` : '';
    meta.textContent = `${pack.kind} · ${pack.id} · ${pack.homeFloorKey || 'unknown'}${visual}`;
    const line = document.createElement('small');
    line.textContent = pack.publicLine || 'Без публичной строки.';
    button.append(title, meta, line);
    questionnaireList.appendChild(button);
  }
  renderQuestionnaireDetails(visible[0]);
}

function setupDrawing() {
  const ctx = drawCanvas.getContext('2d');
  ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  let drawing = false;
  const drawAt = event => {
    const rect = drawCanvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) * drawCanvas.width / rect.width);
    const y = Math.floor((event.clientY - rect.top) * drawCanvas.height / rect.height);
    if (state.drawMode === 'erase') {
      ctx.clearRect(x - 4, y - 4, 8, 8);
    } else {
      ctx.fillStyle = '#c0b8a8';
      ctx.fillRect(x - 3, y - 3, 6, 6);
      ctx.fillStyle = '#453f38';
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }
  };
  drawCanvas.addEventListener('pointerdown', event => {
    drawing = true;
    drawCanvas.setPointerCapture(event.pointerId);
    drawAt(event);
  });
  drawCanvas.addEventListener('pointermove', event => {
    if (drawing) drawAt(event);
  });
  drawCanvas.addEventListener('pointerup', async event => {
    drawing = false;
    drawCanvas.releasePointerCapture(event.pointerId);
    state.sourceCanvas = drawCanvas;
    await normalizeCurrentSource(false);
  });
}

function setDrawMode(mode) {
  state.drawMode = mode;
  pencilButton.classList.toggle('active', mode === 'pencil');
  eraseButton.classList.toggle('active', mode === 'erase');
}

populateLookupControls(document, lookupHints);
if (form.elements.homeFloorKey && lookupHints.floorKeys?.includes('story:living')) {
  form.elements.homeFloorKey.value = 'story:living';
}
lookupStatus.textContent = `lookup: ${lookupHints.itemIds.length} items, ${lookupHints.floorKeys.length} floors, ${(lookupHints.npcPackageSummaries || []).length} NPC анкеты`;
setupDrawing();

form.addEventListener('input', updatePreview);
for (const input of Object.values(cropInputs)) input.addEventListener('input', () => normalizeCurrentSource(true));

for (const name of ['displayName', 'nickname']) {
  form.elements[name].addEventListener('input', () => {
    if (!form.elements.id.value || form.elements.id.value === 'npc_draft') {
      form.elements.id.value = makeNpcId([form.elements.displayName.value, form.elements.nickname.value].filter(Boolean).join(' '));
    }
  });
}

spriteFile.addEventListener('change', async () => {
  const file = spriteFile.files?.[0];
  if (!file) return;
  try {
    const canvas = await fileToCanvas(file);
    state.sourceCanvas = canvas;
    await normalizeCurrentSource(false);
  } catch (err) {
    spriteStatus.textContent = `ERROR: ${err instanceof Error ? err.message : String(err)}`;
  }
});

pencilButton.addEventListener('click', () => setDrawMode('pencil'));
eraseButton.addEventListener('click', () => setDrawMode('erase'));
clearButton.addEventListener('click', async () => {
  drawCanvas.getContext('2d').clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  state.sourceCanvas = drawCanvas;
  state.spritePayload = null;
  state.spriteBlob = null;
  state.portraitBlob = null;
  setPortraitUrl(null);
  drawNormalizedSprite(drawCanvas);
  spriteStatus.textContent = 'Draw or upload a sprite.';
  updatePreview();
});

questionnaireSearch.addEventListener('input', renderQuestionnaireList);
questionnaireList.addEventListener('click', event => {
  if (!(event.target instanceof Element)) return;
  const card = event.target.closest('.questionnaire-card');
  if (!card) return;
  const pack = (lookupHints.npcPackageSummaries || []).find(candidate => candidate.id === card.dataset.packageId);
  applyQuestionnaireTemplate(pack);
  renderQuestionnaireDetails(pack);
  for (const item of questionnaireList.querySelectorAll('.questionnaire-card')) {
    item.classList.toggle('active', item === card);
  }
});

exportButton.addEventListener('click', async () => {
  const draft = draftWithAutoId();
  const validation = validateNpcPackage(draft, lookupHints);
  const consent = consentFromDraft(draft);
  const zip = await buildNpcPackageZip({
    pack: validation.package,
    validation,
    spritePayload: state.spritePayload,
    portraitBlob: state.portraitBlob,
    sourceBlob: state.sourceBlob,
    consent,
  });
  downloadBytes(zip, `${validation.package.id}.zip`);
  spriteStatus.textContent = localSubmissionInstructions(validation.package.id);
});
submitButton.addEventListener('click', submitPackageToDeveloper);

updatePreview();
renderQuestionnaireList();
