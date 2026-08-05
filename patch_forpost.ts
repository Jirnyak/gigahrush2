import { readFileSync, writeFileSync } from 'fs';

let content = readFileSync('src/gen/maintenance/forpost.ts', 'utf-8');

const replacement = `
  // Spawn 2 patrollers out of the 6 liquidators (modify the last 2 guard positions to patrol)
  for (let g = 0; g < guardPositions.length; g++) {
    const gx = guardPositions[g][0];
    const gy = guardPositions[g][1];
    const ci = world.idx(gx, gy);
    if (world.cells[ci] !== Cell.FLOOR) continue;
    const rpg = randomRPG(7);
    const maxHp = Math.round(getMaxHp(rpg) * 1.6);
    const nm = randomName(Faction.LIQUIDATOR);
    const wpn = guardWeapons[g % guardWeapons.length];
    const ammo = guardAmmo[wpn] ?? { defId: 'ammo_9mm', count: 12 };

    // Last 2 guards are patrollers
    const isPatroller = g >= 4;
    const goal = isPatroller ? AIGoal.WANDER : AIGoal.IDLE;

    entities.push({
      id: nextId.v++, type: EntityType.NPC,
      x: gx + 0.5, y: gy + 0.5,
      angle: 0, pitch: 0, alive: true, speed: 1.4 + Math.random() * 0.3,
      sprite: Occupation.HUNTER,
      name: nm.name, firstName: nm.firstName, lastName: nm.lastName, isFemale: nm.female,
      needs: freshNeeds(), hp: maxHp, maxHp,
      money: 30 + Math.floor(Math.random() * 50),
      ai: { goal, tx: gx, ty: gy, path: [], pi: 0, stuck: 0, timer: 0 },
      inventory: [
        { defId: wpn, count: 1 },
        { defId: ammo.defId, count: ammo.count },
      ],
      weapon: wpn,
      faction: Faction.LIQUIDATOR, occupation: Occupation.HUNTER,
      isTraveler: false,
      questId: -1,
      rpg,
    });
  }

  // Spawn 5-8 Wild NPCs outside the perimeter
  // We find a clear area a bit further away (distance 40 to 80)
  const wildPos = findClearArea(world, cx, cy, 3, 3, 40, 80);
  if (wildPos) {
    const wildCount = 5 + Math.floor(Math.random() * 4);
    const wildWeapons = ['pipe', 'makarov', 'shotgun', 'knife'];
    for (let w = 0; w < wildCount; w++) {
      const wx = wildPos.x + Math.floor(Math.random() * 3);
      const wy = wildPos.y + Math.floor(Math.random() * 3);
      if (world.cells[world.idx(wx, wy)] !== Cell.FLOOR) continue;

      const rpg = randomRPG(7);
      const maxHp = Math.round(getMaxHp(rpg) * 1.2);
      const nm = randomName(Faction.WILD);
      const wpn = wildWeapons[Math.floor(Math.random() * wildWeapons.length)];

      entities.push({
        id: nextId.v++, type: EntityType.NPC,
        x: wx + 0.5, y: wy + 0.5,
        angle: 0, pitch: 0, alive: true, speed: 1.2 + Math.random() * 0.4,
        sprite: Occupation.HUNTER,
        name: nm.name, firstName: nm.firstName, lastName: nm.lastName, isFemale: nm.female,
        needs: freshNeeds(), hp: maxHp, maxHp,
        money: 10 + Math.floor(Math.random() * 20),
        ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
        inventory: [
          { defId: wpn, count: 1 },
          { defId: 'ammo_9mm', count: wpn === 'makarov' ? 6 : 0 },
          { defId: 'ammo_shells', count: wpn === 'shotgun' ? 4 : 0 },
        ],
        weapon: wpn,
        faction: Faction.WILD, occupation: Occupation.HUNTER,
        isTraveler: false,
        questId: -1,
        rpg,
      });
    }
  }
`;

const match = /for \(let g = 0; g < guardPositions\.length; g\+\+\) \{[\s\S]*?rpg,\n    \}\);\n  \}/m;

content = content.replace(match, replacement.trim());

writeFileSync('src/gen/maintenance/forpost.ts', content, 'utf-8');
console.log('Patched forpost.ts successfully');
