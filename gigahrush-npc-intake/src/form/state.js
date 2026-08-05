import {
  parseInventoryLines,
  parsePerkRefs,
  parseSocialLinks,
  splitList,
  textLines,
  toInt,
} from './schema.js';

function value(form, name) {
  return form.elements[name]?.value ?? '';
}

function checked(form, name) {
  return Boolean(form.elements[name]?.checked);
}

export function formToDraft(form) {
  const placementTags = splitList(value(form, 'placementTags'));
  const contentProposalType = value(form, 'contentProposalType') || 'none';
  const contentProposalText = value(form, 'contentProposalText');
  return {
    version: 1,
    id: value(form, 'id'),
    kind: value(form, 'kind'),
    identity: {
      nickname: value(form, 'nickname'),
      displayName: value(form, 'displayName'),
    },
    bio: {
      publicLine: value(form, 'publicLine'),
      origin: value(form, 'origin'),
      work: value(form, 'work'),
      wants: textLines(value(form, 'wants')),
      fears: textLines(value(form, 'fears')),
      habits: textLines(value(form, 'habits')),
      secrets: textLines(value(form, 'secrets')),
      markovTags: splitList(value(form, 'roleTags')),
    },
    demographics: {
      sex: value(form, 'sex'),
      age: toInt(value(form, 'age'), 25),
    },
    affiliation: {
      faction: value(form, 'faction'),
      occupation: value(form, 'occupation'),
      roleId: splitList(value(form, 'roleTags'))[0],
    },
    rpg: {
      level: toInt(value(form, 'level'), 1),
      str: toInt(value(form, 'str'), 5),
      agi: toInt(value(form, 'agi'), 5),
      int: toInt(value(form, 'int'), 5),
      perks: parsePerkRefs(value(form, 'perks')),
    },
    wealth: {
      cashRubles: toInt(value(form, 'cashRubles'), 0),
      accountRubles: toInt(value(form, 'accountRubles'), 0),
      debtRubles: toInt(value(form, 'debtRubles'), 0),
      assetTags: splitList(value(form, 'assetTags')),
    },
    loadout: {
      weapon: value(form, 'weapon'),
      tool: value(form, 'tool'),
      inventory: parseInventoryLines(value(form, 'inventory')),
    },
    social: {
      playerRelation: toInt(value(form, 'playerRelation'), 0),
      karma: toInt(value(form, 'karma'), 0),
      links: parseSocialLinks(value(form, 'links')),
    },
    visual: {
      sprite: value(form, 'sprite'),
      npcVisualId: value(form, 'npcVisualId'),
      spriteSeed: toInt(value(form, 'spriteSeed'), 1),
      portraitHint: value(form, 'portraitHint'),
    },
    placement: {
      homeFloorKey: value(form, 'homeFloorKey'),
      presence: value(form, 'presence'),
      mobility: value(form, 'mobility'),
      roomId: value(form, 'roomId'),
      roomTags: placementTags,
      spawnTags: placementTags,
    },
    speech: {
      voiceTags: splitList(value(form, 'voiceTags')),
      forbiddenTopics: splitList(value(form, 'forbiddenTopics')),
      talkLines: textLines(value(form, 'talkLines')),
      talkLinesPost: textLines(value(form, 'talkLinesPost')),
      catchphrases: textLines(value(form, 'catchphrases')),
      demosPostHints: textLines(value(form, 'demosPostHints')),
    },
    editor: {
      publicCredit: value(form, 'publicCredit'),
      intake: {
        contentProposal: {
          type: contentProposalType,
          text: contentProposalText,
        },
      },
    },
    tags: ['community', 'intake', ...splitList(value(form, 'roleTags'))],
    consent: {
      accepted: checked(form, 'consent'),
      publicCredit: value(form, 'publicCredit'),
      privateContact: value(form, 'privateContact'),
    },
  };
}

export function consentFromDraft(draft) {
  return {
    schema: 'gigahrush.npc-intake.consent',
    version: 1,
    accepted: Boolean(draft?.consent?.accepted),
    publicCredit: String(draft?.consent?.publicCredit ?? '').trim(),
    privateContactProvided: Boolean(String(draft?.consent?.privateContact ?? '').trim()),
    terms: 'Author allows TENEVIK GAMES to review, edit and use this NPC package in GIGAHRUSH. Private contact is not part of npc.json.',
    createdAt: new Date().toISOString(),
  };
}

export function populateLookupControls(root, lookupHints) {
  for (const select of root.querySelectorAll('select[data-lookup]')) {
    const key = select.dataset.lookup;
    const values = key === 'floorKeys' && Array.isArray(lookupHints.floorOptions)
      ? lookupHints.floorOptions
      : (lookupHints[key] ?? []);
    select.innerHTML = '';
    const appendOption = (parent, value) => {
      const id = typeof value === 'string' ? value : value.id;
      const label = typeof value === 'string'
        ? value
        : (key === 'floorKeys' ? value.label : `${value.id} - ${value.label}`);
      const option = document.createElement('option');
      option.value = id;
      option.textContent = label;
      parent.append(option);
    };
    if (key === 'floorKeys' && values.some(value => typeof value !== 'string' && value.group)) {
      const groups = [
        ['route', 'Story/design route stops z+50..z-50'],
        ['procedural', 'Procedural fallback stops z+49..z-49'],
      ];
      for (const [groupId, label] of groups) {
        const groupValues = values.filter(value => typeof value !== 'string' && value.group === groupId);
        if (groupValues.length === 0) continue;
        const optgroup = document.createElement('optgroup');
        optgroup.label = label;
        for (const value of groupValues) appendOption(optgroup, value);
        select.append(optgroup);
      }
      for (const value of values.filter(value => typeof value === 'string' || !value.group)) appendOption(select, value);
    } else {
      for (const value of values) appendOption(select, value);
    }
  }
  const items = root.querySelector('#itemIds');
  if (items) {
    items.innerHTML = '';
    for (const id of lookupHints.itemIds ?? []) {
      const option = document.createElement('option');
      option.value = id;
      items.append(option);
    }
  }
  const visuals = root.querySelector('#visualIds');
  if (visuals) {
    visuals.innerHTML = '';
    for (const id of lookupHints.visualIds ?? []) {
      const option = document.createElement('option');
      option.value = id;
      visuals.append(option);
    }
  }
}
