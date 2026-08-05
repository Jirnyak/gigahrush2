import { EntityType, type Entity } from '../core/types';

export function removeNpcEntities(entities: Entity[]): void {
  let write = 0;
  for (let read = 0; read < entities.length; read++) {
    const entity = entities[read];
    if (entity.type === EntityType.NPC) continue;
    entities[write++] = entity;
  }
  entities.length = write;
}

export function withoutNpcEntities<T extends { entities: Entity[] }>(generation: T): T {
  removeNpcEntities(generation.entities);
  return generation;
}
