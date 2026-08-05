export const NPC_PACKAGE_SCHEMA = 'gigahrush.npc-package';
export const NPC_PACKAGE_VERSION = 1;

export const PACKAGE_KINDS = new Set(['plot', 'design', 'procedural']);
export const PRESENCE_VALUES = new Set(['population', 'anchor', 'room_content', 'event_only']);
export const MOBILITY_VALUES = new Set(['fixed_home', 'cold_movable', 'caravan_allowed', 'event_locked']);
export const SEX_VALUES = new Set(['male', 'female']);

const SNAKE_ID = /^[a-z][a-z0-9_]*$/;
const TAG_ID = /^[a-z0-9_:.-]+$/;
const REMOTE_URL = /\bhttps?:\/\//i;
const GEOMETRY_LEAK = /\b1024\b|\b1024x1024\b|тороид|toroid|toroidal|координат[аы]?|world\.idx|map dimension/i;
const RUS_TO_LAT = new Map(Object.entries({
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
  ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e',
  ю: 'yu', я: 'ya'
}));

function idsOf(values) {
  return new Set((values ?? []).map(value => typeof value === 'string' ? value : value.id));
}

function valuesOf(values) {
  return new Set((values ?? []).map(value => typeof value === 'string' ? value : value.value).filter(value => value !== undefined));
}

function enumValueFor(input, values, fallback) {
  if (Number.isInteger(input)) return input;
  const text = String(input ?? '').trim().toLowerCase();
  const found = (values ?? []).find(value => {
    if (typeof value === 'string') return value.toLowerCase() === text;
    return value.id?.toLowerCase() === text || value.name?.toLowerCase() === text;
  });
  return found && typeof found !== 'string' && found.value !== undefined ? found.value : fallback;
}

function enumInputKnown(input, values) {
  if (!(values ?? []).length) return true;
  if (Number.isInteger(input)) return valuesOf(values).has(input);
  const text = String(input ?? '').trim().toLowerCase();
  return (values ?? []).some(value => {
    if (typeof value === 'string') return value.toLowerCase() === text;
    return value.id?.toLowerCase() === text || value.name?.toLowerCase() === text;
  });
}

export function splitList(value) {
  if (Array.isArray(value)) return value.map(String).map(v => v.trim()).filter(Boolean);
  return String(value ?? '')
    .split(/[\n,;]/)
    .map(v => v.trim())
    .filter(Boolean);
}

export function textLines(value) {
  if (Array.isArray(value)) return value.map(String).map(v => v.trim()).filter(Boolean);
  return String(value ?? '')
    .split(/\n+/)
    .map(v => v.trim())
    .filter(Boolean);
}

export function toInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function clampInt(value, min, max, fallback = min) {
  return Math.max(min, Math.min(max, toInt(value, fallback)));
}

export function displayNpcName(identity) {
  const exact = String(identity?.displayName ?? '').trim();
  if (exact) return exact;
  const first = String(identity?.firstName ?? '').trim();
  const patronymic = String(identity?.patronymic ?? '').trim();
  const last = String(identity?.lastName ?? '').trim();
  const nick = String(identity?.nickname ?? '').trim();
  const base = [first, patronymic, last].filter(Boolean).join(' ') || 'Без имени';
  return nick ? `${base} ("${nick}")` : base;
}

export function makeNpcId(input) {
  const raw = String(input ?? '').trim().toLowerCase();
  let out = '';
  for (const ch of raw) out += RUS_TO_LAT.get(ch) ?? ch;
  out = out.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_');
  if (!out || /^[0-9]/.test(out)) out = `npc_${out || 'draft'}`;
  return out.slice(0, 64);
}

export function parseInventoryLines(value) {
  return textLines(value).map(line => {
    const match = line.match(/^([a-zA-Z0-9_:.-]+)(?:\s*(?:x|\*|,|\|)\s*([0-9]+))?$/);
    if (!match) return { defId: line, count: 1, malformed: true };
    return { defId: match[1], count: clampInt(match[2] ?? 1, 1, 255) };
  });
}

export function parsePerkRefs(value) {
  return splitList(value).map(raw => {
    const [id, rank] = raw.split(':').map(part => part.trim());
    return rank ? { id, rank: clampInt(rank, 1, 10, 1) } : { id };
  });
}

export function parseSocialLinks(value) {
  return textLines(value).map(line => {
    const [targetNpcId, relation = '0', role = 'acquaintance', flags = '', bidirectional = ''] = line.split('|').map(part => part.trim());
    return {
      targetNpcId,
      relation: clampInt(relation, -127, 127, 0),
      role,
      flags: splitList(flags),
      bidirectional: /^(yes|true|1|bidirectional)$/i.test(bidirectional),
    };
  });
}

function cleanOptionalText(value, cap) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, cap) : undefined;
}

function cleanTagArray(value, cap = 24) {
  return splitList(value)
    .map(tag => tag.toLowerCase().replace(/[^a-z0-9_:.-]+/g, '_').replace(/^_+|_+$/g, ''))
    .filter(Boolean)
    .slice(0, cap);
}

function compactObject(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) continue;
    out[key] = value;
  }
  return out;
}

export function createEmptyNpcPackage(lookupHints = {}) {
  const faction = lookupHints.factions?.[0]?.value ?? 0;
  const occupation = lookupHints.occupations?.[0]?.value ?? 0;
  const homeFloorKey = lookupHints.floorKeys?.includes('story:living') ? 'story:living' : (lookupHints.floorKeys?.[0] ?? 'story:living');
  return {
    version: NPC_PACKAGE_VERSION,
    id: 'npc_draft',
    kind: 'procedural',
    identity: { displayName: '' },
    bio: { publicLine: '' },
    demographics: { sex: 'male', age: 25 },
    affiliation: { faction, occupation },
    rpg: { level: 1, str: 5, agi: 5, int: 5, perks: [] },
    wealth: { cashRubles: 0, accountRubles: 0, debtRubles: 0, assetTags: [] },
    loadout: { inventory: [] },
    social: { playerRelation: 0, karma: 0, links: [] },
    visual: { spriteSeed: 1 },
    placement: { homeFloorKey, presence: 'population', mobility: 'fixed_home', roomTags: [], spawnTags: [] },
    speech: { voiceTags: [], catchphrases: [], forbiddenTopics: [], talkLines: [], talkLinesPost: [], demosPostHints: [] },
    tags: [],
  };
}

export function sanitizeNpcPackage(draft, lookupHints = {}) {
  const base = createEmptyNpcPackage(lookupHints);
  const identity = draft?.identity ?? {};
  const bio = draft?.bio ?? {};
  const affiliation = draft?.affiliation ?? {};
  const demographics = draft?.demographics ?? {};
  const rpg = draft?.rpg ?? {};
  const wealth = draft?.wealth ?? {};
  const loadout = draft?.loadout ?? {};
  const social = draft?.social ?? {};
  const visual = draft?.visual ?? {};
  const placement = draft?.placement ?? {};
  const speech = draft?.speech ?? {};
  const editor = draft?.editor ?? {};

  const gameName = cleanOptionalText(identity.displayName, 80) ??
    cleanOptionalText([identity.firstName, identity.patronymic, identity.lastName].filter(Boolean).join(' '), 80) ??
    '';
  const id = makeNpcId(draft?.id || gameName || displayNpcName(identity));
  const inventory = Array.isArray(loadout.inventory) ? loadout.inventory : parseInventoryLines(loadout.inventory);
  const links = Array.isArray(social.links) ? social.links : parseSocialLinks(social.links);
  const perks = Array.isArray(rpg.perks) ? rpg.perks : parsePerkRefs(rpg.perks);

  const pack = {
    version: NPC_PACKAGE_VERSION,
    id,
    kind: PACKAGE_KINDS.has(draft?.kind) ? draft.kind : base.kind,
    identity: compactObject({
      displayName: gameName,
      nickname: cleanOptionalText(identity.nickname, 48),
      aliases: textLines(identity.aliases).slice(0, 8),
    }),
    bio: compactObject({
      publicLine: cleanOptionalText(bio.publicLine, 180) ?? '',
      short: cleanOptionalText(bio.short, 280),
      origin: cleanOptionalText(bio.origin, 140),
      work: cleanOptionalText(bio.work, 140),
      wants: textLines(bio.wants).slice(0, 8),
      fears: textLines(bio.fears).slice(0, 8),
      habits: textLines(bio.habits).slice(0, 8),
      secrets: textLines(bio.secrets).slice(0, 8),
      markovTags: cleanTagArray(bio.markovTags, 12),
    }),
    demographics: {
      sex: SEX_VALUES.has(demographics.sex) ? demographics.sex : base.demographics.sex,
      age: clampInt(demographics.age, 1, 100, base.demographics.age),
    },
    affiliation: compactObject({
      faction: enumValueFor(affiliation.faction, lookupHints.factions, base.affiliation.faction),
      occupation: enumValueFor(affiliation.occupation, lookupHints.occupations, base.affiliation.occupation),
      roleId: cleanOptionalText(affiliation.roleId, 64),
      familyId: affiliation.familyId === undefined || affiliation.familyId === '' ? undefined : clampInt(affiliation.familyId, 0, 999999, 0),
    }),
    rpg: compactObject({
      level: clampInt(rpg.level, 1, 100, 1),
      str: clampInt(rpg.str, 1, 100, 5),
      agi: clampInt(rpg.agi, 1, 100, 5),
      int: clampInt(rpg.int, 1, 100, 5),
      perks: perks.map(perk => compactObject({
        id: String(perk.id ?? '').trim(),
        rank: perk.rank === undefined ? undefined : clampInt(perk.rank, 1, 10, 1),
        tags: cleanTagArray(perk.tags, 8),
      })).filter(perk => perk.id).slice(0, 16),
    }),
    wealth: compactObject({
      cashRubles: clampInt(wealth.cashRubles, 0, 100000000, 0),
      accountRubles: clampInt(wealth.accountRubles, 0, 100000000, 0),
      debtRubles: clampInt(wealth.debtRubles, 0, 100000000, 0),
      assetTags: cleanTagArray(wealth.assetTags, 16),
    }),
    loadout: compactObject({
      weapon: cleanOptionalText(loadout.weapon, 64),
      tool: cleanOptionalText(loadout.tool, 64),
      inventory: inventory.map(item => ({
        defId: String(item.defId ?? '').trim(),
        count: clampInt(item.count, 1, 255, 1),
      })).filter(item => item.defId).slice(0, lookupHints.limits?.inventorySlots ?? 64),
    }),
    social: compactObject({
      playerRelation: clampInt(social.playerRelation, -100, 100, 0),
      karma: clampInt(social.karma, -127, 127, 0),
      links: links.map(link => compactObject({
        targetNpcId: makeNpcId(link.targetNpcId),
        relation: clampInt(link.relation, -127, 127, 0),
        role: enumValueFor(link.role, lookupHints.demosRelationRoles, 0),
        flags: cleanTagArray(link.flags, 8),
        bidirectional: Boolean(link.bidirectional) || undefined,
      })).filter(link => link.targetNpcId).slice(0, lookupHints.limits?.npcSocialLinks ?? 9),
    }),
    visual: compactObject({
      sprite: visual.sprite === undefined || visual.sprite === '' ? undefined : clampInt(visual.sprite, 0, 4096, 0),
      npcVisualId: cleanOptionalText(visual.npcVisualId, 64),
      spriteSeed: clampInt(visual.spriteSeed, 1, 0xffffffff, 1),
      portraitHint: cleanOptionalText(visual.portraitHint, 120),
    }),
    placement: compactObject({
      homeFloorKey: cleanOptionalText(placement.homeFloorKey, 96) ?? base.placement.homeFloorKey,
      presence: PRESENCE_VALUES.has(placement.presence) ? placement.presence : base.placement.presence,
      mobility: MOBILITY_VALUES.has(placement.mobility) ? placement.mobility : base.placement.mobility,
      roomId: cleanOptionalText(placement.roomId, 64),
      roomTags: cleanTagArray(placement.roomTags, 16),
      anchorId: cleanOptionalText(placement.anchorId, 64),
      spawnTags: cleanTagArray(placement.spawnTags, 16),
    }),
    speech: compactObject({
      voiceTags: cleanTagArray(speech.voiceTags, 12),
      markovDomains: cleanTagArray(speech.markovDomains, 12),
      catchphrases: textLines(speech.catchphrases).slice(0, 10),
      forbiddenTopics: textLines(speech.forbiddenTopics).slice(0, 10),
      talkLines: textLines(speech.talkLines).slice(0, 16),
      talkLinesPost: textLines(speech.talkLinesPost).slice(0, 16),
      talkQuestResponse: Array.isArray(speech.talkQuestResponse)
        ? textLines(speech.talkQuestResponse).slice(0, 8)
        : cleanOptionalText(speech.talkQuestResponse, 180),
      ambientCorpus: textLines(speech.ambientCorpus).slice(0, 24),
      barkCorpus: textLines(speech.barkCorpus).slice(0, 24),
      demosPostHints: textLines(speech.demosPostHints).slice(0, 12),
    }),
    tags: cleanTagArray(draft?.tags, 24),
  };

  const content = compactObject({
    plotNpcId: cleanOptionalText(draft?.content?.plotNpcId, 64),
    dialogueId: cleanOptionalText(draft?.content?.dialogueId, 64),
    questIds: cleanTagArray(draft?.content?.questIds, 12),
    roomContentId: cleanOptionalText(draft?.content?.roomContentId, 64),
    documentIds: cleanTagArray(draft?.content?.documentIds, 12),
    tradeProfileId: cleanOptionalText(draft?.content?.tradeProfileId, 64),
    debugPath: cleanOptionalText(draft?.content?.debugPath, 120),
  });
  if (Object.keys(content).length) pack.content = content;

  const intakeProposal = editor.intake?.contentProposal;
  const editorOut = compactObject({
    author: cleanOptionalText(editor.publicCredit ?? editor.author, 96),
    source: 'community',
    reviewStatus: 'submitted',
    notes: intakeProposal ? cleanOptionalText(`${intakeProposal.type ?? 'none'}: ${intakeProposal.text ?? ''}`, 480) : cleanOptionalText(editor.notes, 480),
  });
  if (Object.keys(editorOut).length) pack.editor = editorOut;

  return pack;
}

function walk(value, visit, path = '$', seen = new Set()) {
  if (value && typeof value === 'object') {
    if (seen.has(value)) return;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) walk(child, visit, `${path}.${key}`, seen);
    return;
  }
  visit(value, path);
}

export function validateNpcPackage(input, lookupHints = {}) {
  const errors = [];
  const warnings = [];
  const pack = sanitizeNpcPackage(input, lookupHints);
  const factionValues = valuesOf(lookupHints.factions);
  const occupationValues = valuesOf(lookupHints.occupations);
  const itemIds = idsOf(lookupHints.itemIds);
  const floorKeys = idsOf(lookupHints.floorKeys);
  const visualIds = idsOf(lookupHints.visualIds);
  const perkIds = idsOf(lookupHints.perkIds);
  const roleValues = valuesOf(lookupHints.demosRelationRoles);
  const flags = idsOf(lookupHints.demosEdgeFlags);

  if (!SNAKE_ID.test(pack.id)) errors.push('id must be stable lowercase snake_case');
  if (input?.version !== undefined && input.version !== NPC_PACKAGE_VERSION) errors.push('version must be 1');
  if (!PACKAGE_KINDS.has(pack.kind)) errors.push(`unknown kind: ${pack.kind}`);
  if (!displayNpcName(pack.identity) || displayNpcName(pack.identity) === 'Без имени') errors.push('identity.displayName is required');
  if (!pack.bio.publicLine) errors.push('bio.publicLine is required');
  if (!SEX_VALUES.has(pack.demographics.sex)) errors.push('demographics.sex must be male or female');
  if (!enumInputKnown(input?.affiliation?.faction, lookupHints.factions)) errors.push(`unknown faction: ${input?.affiliation?.faction}`);
  if (!enumInputKnown(input?.affiliation?.occupation, lookupHints.occupations)) errors.push(`unknown occupation: ${input?.affiliation?.occupation}`);
  if (factionValues.size && !factionValues.has(pack.affiliation.faction)) errors.push(`unknown faction enum value: ${pack.affiliation.faction}`);
  if (occupationValues.size && !occupationValues.has(pack.affiliation.occupation)) errors.push(`unknown occupation enum value: ${pack.affiliation.occupation}`);
  if (floorKeys.size && !floorKeys.has(pack.placement.homeFloorKey)) errors.push(`unknown homeFloorKey: ${pack.placement.homeFloorKey}`);
  if (pack.visual.npcVisualId && visualIds.size && !visualIds.has(pack.visual.npcVisualId)) errors.push(`unknown npcVisualId: ${pack.visual.npcVisualId}`);

  for (const field of ['weapon', 'tool']) {
    const id = pack.loadout[field];
    if (id && itemIds.size && !itemIds.has(id)) errors.push(`unknown ${field} item id: ${id}`);
    if (id && Object.prototype.hasOwnProperty.call(lookupHints.itemSlots ?? {}, id) && lookupHints.itemSlots[id] !== field) {
      errors.push(`${field} item id must reference a ${field}: ${id}`);
    }
  }
  for (const item of pack.loadout.inventory ?? []) {
    if (item.malformed) errors.push(`bad inventory line: ${item.defId}`);
    if (itemIds.size && !itemIds.has(item.defId)) errors.push(`unknown inventory item id: ${item.defId}`);
    if (item.count < 1 || item.count > (lookupHints.limits?.itemStack ?? 255)) errors.push(`bad inventory count for ${item.defId}`);
  }
  if ((pack.loadout.inventory?.length ?? 0) > (lookupHints.limits?.inventorySlots ?? 64)) errors.push('inventory exceeds NPC slot cap');

  for (const perk of pack.rpg.perks ?? []) {
    if (!TAG_ID.test(perk.id)) errors.push(`bad perk id: ${perk.id}`);
    if (perkIds.size && !perkIds.has(perk.id)) errors.push(`unknown perk id: ${perk.id}`);
  }

  const rawLinks = input?.social?.links;
  const rawLinkCount = Array.isArray(rawLinks) ? rawLinks.length : (pack.social.links?.length ?? 0);
  if (rawLinkCount > (lookupHints.limits?.npcSocialLinks ?? 9)) {
    errors.push('social.links exceeds 9 NPC links');
  }
  for (const link of pack.social.links ?? []) {
    if (!SNAKE_ID.test(link.targetNpcId)) errors.push(`bad social target id: ${link.targetNpcId}`);
    const rawRole = Array.isArray(rawLinks) ? rawLinks[pack.social.links.indexOf(link)]?.role : link.role;
    if (!enumInputKnown(rawRole, lookupHints.demosRelationRoles)) errors.push(`unknown Demos relation role: ${rawRole}`);
    if (roleValues.size && !roleValues.has(link.role)) errors.push(`unknown Demos relation role enum value: ${link.role}`);
    for (const flag of link.flags ?? []) {
      if (flags.size && !flags.has(flag)) errors.push(`unknown Demos edge flag: ${flag}`);
    }
  }

  walk(input, (value, path) => {
    if (typeof value === 'function') errors.push(`function value is not allowed at ${path}`);
    if (typeof value !== 'string') return;
    if (REMOTE_URL.test(value)) errors.push(`remote URL is not allowed in package field ${path}`);
    if (GEOMETRY_LEAK.test(value)) errors.push(`implementation geometry leak in ${path}`);
    if (value.length > 1600) errors.push(`text too long at ${path}`);
  });

  for (const key of Object.keys(input ?? {})) {
    if (/^(entityId|liveEntityId|liveId)$/i.test(key)) errors.push(`${key} is runtime-only`);
  }

  if (!pack.speech.talkLines?.length && !pack.speech.demosPostHints?.length && !pack.speech.catchphrases?.length) {
    warnings.push('speech has no talk lines, catchphrases or Demos hints');
  }
  if (!pack.loadout.weapon && !pack.loadout.tool && !(pack.loadout.inventory?.length)) {
    warnings.push('loadout is empty; accepted but harder to review');
  }

  return { valid: errors.length === 0, errors, warnings, package: pack };
}

export function compileNpcPackageForEditor(pack, lookupHints = {}) {
  const validation = validateNpcPackage(pack, lookupHints);
  return {
    schema: NPC_PACKAGE_SCHEMA,
    version: NPC_PACKAGE_VERSION,
    package: validation.package,
    validation: {
      errors: validation.errors,
      warnings: validation.warnings,
    },
    lookupHints,
  };
}
