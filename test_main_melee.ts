import { selectMeleeTarget } from './src/systems/melee_targeting';
import { EntityType, type Entity } from './src/core/types';
import { World } from './src/core/world';

const world = new World(1024, 0); // Fake world
world.delta = (from, to) => ((to - from + 1024 / 2) % 1024 + 1024) % 1024 - 1024 / 2;

const player = { id: 1, type: EntityType.NPC, x: 10, y: 10, angle: 0, alive: true } as Entity;
const enemy = { id: 2, type: EntityType.MONSTER, x: 10.5, y: 10, angle: 0, alive: true } as Entity;

const range = 1.0;
const ax = player.x + Math.cos(player.angle) * range;
const ay = player.y + Math.sin(player.angle) * range;

console.log(`ax=${ax}, ay=${ay}`);

const meleeHitQuery = [enemy]; // Pretend queryRadius found it
const target = selectMeleeTarget(world, player, meleeHitQuery, range, undefined);

console.log("Target:", target ? target.id : "None");
