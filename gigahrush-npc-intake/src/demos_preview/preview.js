import { displayNpcName } from '../form/schema.js';

const FACTION_LABELS = {
  citizen: 'граждане',
  liquidator: 'ликвидаторы',
  cultist: 'культисты',
  scientist: 'учёные',
  wild: 'дикие',
  player: 'игрок',
};

const OCCUPATION_LABELS = {
  housewife: 'быт',
  locksmith: 'слесарь',
  secretary: 'секретарь',
  electrician: 'электрик',
  cook: 'повар',
  doctor: 'врач',
  turner: 'токарь',
  mechanic: 'механик',
  storekeeper: 'кладовщик',
  alcoholic: 'курилка',
  scientist: 'учёный',
  child: 'поручения',
  director: 'директор',
  traveler: 'путник',
  pilgrim: 'паломник',
  hunter: 'охотник',
  priest: 'батюшка',
};

const FACTION_NUMERIC_LABELS = ['граждане', 'ликвидаторы', 'культисты', 'учёные', 'дикие', 'игрок'];
const OCCUPATION_NUMERIC_LABELS = [
  'быт', 'слесарь', 'секретарь', 'электрик', 'повар', 'врач', 'токарь', 'механик',
  'кладовщик', 'курилка', 'учёный', 'поручения', 'директор', 'путник', 'паломник',
  'охотник', 'батюшка',
];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);
}

export function relationBand(score) {
  if (score <= -64) return { label: 'враг', color: '#ff715c' };
  if (score < -16) return { label: 'холодно', color: '#d8a05f' };
  if (score < 32) return { label: 'нейтрально', color: '#d8d0a0' };
  if (score < 64) return { label: 'приятель', color: '#8fd47a' };
  return { label: 'свой', color: '#77e6a4' };
}

export function capitalLabel(pack) {
  const cash = pack.wealth?.cashRubles ?? 0;
  const account = pack.wealth?.accountRubles ?? 0;
  const debt = pack.wealth?.debtRubles ?? 0;
  return `${cash + account - debt} руб.`;
}

export function deterministicDemosPost(pack) {
  const name = displayNpcName(pack.identity);
  const place = pack.placement?.homeFloorKey ?? 'living';
  const occupation = pack.affiliation?.occupation;
  const work = pack.bio?.work || OCCUPATION_LABELS[occupation] || OCCUPATION_NUMERIC_LABELS[occupation] || 'смена';
  const hint = pack.speech?.demosPostHints?.[0] || pack.speech?.catchphrases?.[0];
  if (hint) return `${name}: ${hint}`;
  if (pack.wealth?.debtRubles > 0) return `${name}: долг не исчезает от молчания. Кто видел старшего по ${place}, отметьтесь.`;
  if (pack.social?.karma < -32) return `${name}: опять списали на меня чужую смену. Бумагу несите, крики у гермы не принимаю.`;
  return `${name}: ${work}. Если зовёте в ${place}, пишите дело, цену и где ждать.`;
}

export function ambientTalkLine(pack) {
  return pack.speech?.talkLines?.[0]
    || pack.speech?.catchphrases?.[0]
    || 'Не стой в проходе. Тут люди с водой идут.';
}

export function renderDemosPreview(container, { pack, portraitUrl, validation }) {
  const relation = relationBand(pack.social?.playerRelation ?? 0);
  const sex = pack.demographics?.sex === 'female' ? 'жен.' : 'муж.';
  const faction = pack.affiliation?.faction;
  const occupation = pack.affiliation?.occupation;
  const visualId = pack.visual?.npcVisualId;
  const links = pack.social?.links ?? [];
  const socialRows = [
    `<li><strong>player</strong> - ${pack.social?.playerRelation ?? 0} / ${relation.label}</li>`,
    ...links.map(link => `<li><strong>${escapeHtml(link.targetNpcId)}</strong> - ${escapeHtml(link.relation)} / ${escapeHtml(link.role)}</li>`),
  ].join('');
  const errorLine = validation.errors.length
    ? `<p class="error">${validation.errors.length} error(s), export blocked</p>`
    : '<p class="ok">package validates</p>';
  const portrait = portraitUrl
    ? `<img class="portrait" src="${escapeHtml(portraitUrl)}" alt="">`
    : visualId
      ? `<div class="portrait preset-portrait"><span>game visual</span><strong>${escapeHtml(visualId)}</strong></div>`
      : '<div class="portrait"></div>';
  container.innerHTML = `
    <div class="demos-head">
      ${portrait}
      <div>
        <div class="demos-name">${escapeHtml(displayNpcName(pack.identity))}</div>
        <div class="demos-meta">${escapeHtml(pack.demographics?.age)} / ${sex} / ${escapeHtml(FACTION_LABELS[faction] ?? FACTION_NUMERIC_LABELS[faction] ?? faction)} / ${escapeHtml(OCCUPATION_LABELS[occupation] ?? OCCUPATION_NUMERIC_LABELS[occupation] ?? occupation)}</div>
        <div class="demos-line">${escapeHtml(pack.bio?.publicLine || 'Публичная строка не заполнена.')}</div>
      </div>
    </div>
    <div class="demos-stats">
      <div class="stat">floor<strong>${escapeHtml(pack.placement?.homeFloorKey)}</strong></div>
      <div class="stat">capital<strong>${escapeHtml(capitalLabel(pack))}</strong></div>
      <div class="stat">karma<strong>${escapeHtml(pack.social?.karma ?? 0)}</strong></div>
      <div class="stat">relation<strong style="color:${relation.color}">${escapeHtml(relation.label)}</strong></div>
    </div>
    ${visualId ? `<div class="demos-post"><strong>visual</strong><br>${escapeHtml(visualId)}</div>` : ''}
    <div class="social-list"><strong>10-link panel</strong><ul>${socialRows}</ul></div>
    <div class="demos-post"><strong>post</strong><br>${escapeHtml(deterministicDemosPost(pack))}</div>
    <div class="demos-post"><strong>talk</strong><br>${escapeHtml(ambientTalkLine(pack))}</div>
    ${errorLine}
  `;
}

export async function renderPreviewPng(pack, portraitBlob) {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 540;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#10120e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#5f6757';
  ctx.strokeRect(24, 24, canvas.width - 48, canvas.height - 48);
  ctx.fillStyle = '#d7c06a';
  ctx.font = '24px monospace';
  ctx.fillText('ИНФОСЕТЬ ДЕМОС / NPC PREVIEW', 48, 64);
  if (portraitBlob) {
    const url = URL.createObjectURL(portraitBlob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 48, 92, 128, 128);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  ctx.fillStyle = '#e6ead9';
  ctx.font = '22px monospace';
  ctx.fillText(displayNpcName(pack.identity).slice(0, 44), 200, 116);
  ctx.font = '16px monospace';
  const relation = relationBand(pack.social?.playerRelation ?? 0);
  const lines = [
    `${pack.demographics?.age} / ${pack.demographics?.sex} / ${pack.affiliation?.faction} / ${pack.affiliation?.occupation}`,
    `floor: ${pack.placement?.homeFloorKey}   capital: ${capitalLabel(pack)}   karma: ${pack.social?.karma ?? 0}`,
    `player relation: ${pack.social?.playerRelation ?? 0} (${relation.label})`,
    pack.bio?.publicLine ?? '',
    `post: ${deterministicDemosPost(pack)}`,
    `talk: ${ambientTalkLine(pack)}`,
  ];
  let y = 148;
  for (const line of lines) {
    ctx.fillStyle = line.startsWith('post:') || line.startsWith('talk:') ? '#aeb7a0' : '#e6ead9';
    ctx.fillText(String(line).slice(0, 96), 200, y);
    y += 34;
  }
  return new Promise(resolve => canvas.toBlob(blob => resolve(blob), 'image/png'));
}
