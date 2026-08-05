import { selectMeleeTarget } from './src/systems/melee_targeting';
import { EntityType, type Entity } from './src/core/types';
import { World } from './src/core/world';

const world = new World(1024, 0); // Fake world
world.delta = (from, to) => ((to - from + 1024 / 2) % 1024 + 1024) % 1024 - 1024 / 2;

const player = { id: 1, type: EntityType.NPC, x: 10, y: 10, alive: true } as Entity;
const enemy = { id: 2, type: EntityType.MONSTER, x: 10.5, y: 10, alive: true } as Entity;

const target = selectMeleeTarget(world, player, [enemy], 0.5, undefined);
console.log(target ? "Hit!" : "Missed!");
