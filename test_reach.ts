import { selectMeleeTarget } from './src/systems/melee_targeting';
import { EntityType, type Entity } from './src/core/types';
import { World } from './src/core/world';

const world = new World(1024, 0); // Fake world
world.delta = (from, to) => ((to - from + 1024 / 2) % 1024 + 1024) % 1024 - 1024 / 2;

const player = { id: 1, type: EntityType.NPC, x: 10, y: 10, alive: true } as Entity;
// Enemy is very close!
const enemy = { id: 2, type: EntityType.MONSTER, x: 10.01, y: 10.01, alive: true } as Entity;

const candidates = [enemy];
const target = selectMeleeTarget(world, player, candidates, 0.5, undefined);
console.log("Point blank hit?", target ? "Yes" : "No");

const enemyFar = { id: 3, type: EntityType.MONSTER, x: 11, y: 10, alive: true } as Entity;
const targetFar = selectMeleeTarget(world, player, [enemyFar], 0.5, undefined);
console.log("Distance 1.0 hit?", targetFar ? "Yes" : "No");

const enemyMiss = { id: 4, type: EntityType.MONSTER, x: 11.1, y: 10, alive: true } as Entity;
const targetMiss = selectMeleeTarget(world, player, [enemyMiss], 0.5, undefined);
console.log("Distance 1.1 hit?", targetMiss ? "Yes" : "No");

