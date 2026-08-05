import { EntityIndex } from './src/systems/entity_index';
import { EntityType, type Entity } from './src/core/types';

const index = new EntityIndex();
const player = { id: 1, type: EntityType.NPC, x: 10, y: 10, alive: true } as Entity;
const enemy = { id: 2, type: EntityType.MONSTER, x: 10.5, y: 10, alive: true } as Entity;

index.rebuild([player, enemy]);

const meleeHitQuery: Entity[] = [];
const ax = 10 + Math.cos(0) * 1.0;
const ay = 10 + Math.sin(0) * 1.0;

const ENTITY_MASK_NPC = 1 << EntityType.NPC;
const ENTITY_MASK_MONSTER = 1 << EntityType.MONSTER;
const ENTITY_MASK_ACTOR = ENTITY_MASK_NPC | ENTITY_MASK_MONSTER;

index.queryRadius(ax, ay, 1.2, meleeHitQuery, ENTITY_MASK_ACTOR);

console.log("Query returned:", meleeHitQuery.map(e => e.id));
