import { EntityType, type Entity } from '../core/types';

let currentPlayerId: number | undefined;

export function setCurrentPlayerEntity(entity: Entity | null | undefined): void {
  currentPlayerId = entity?.id;
}

export function getCurrentPlayerId(): number | undefined {
  return currentPlayerId;
}

export function isNativePlayerBodyEntity(entity: Entity | null | undefined): boolean {
  return entity?.persistentNpcId === 'player';
}

export function isPlayerEntity(entity: Entity | null | undefined): boolean {
  if (!entity) return false;
  if (currentPlayerId !== undefined) return entity.id === currentPlayerId;
  return isNativePlayerBodyEntity(entity);
}

export function getCurrentPlayerEntity(entities: readonly Entity[], fallback?: Entity): Entity | undefined {
  if (currentPlayerId !== undefined) {
    const current = entities.find(entity => entity.id === currentPlayerId && entity.alive);
    if (current) return current;
  }
  if (fallback?.alive) return fallback;
  return entities.find(entity => entity.alive && isNativePlayerBodyEntity(entity));
}

export function isActorEntity(entity: Entity | null | undefined): entity is Entity {
  return entity?.alive === true && (entity.type === EntityType.NPC || entity.type === EntityType.MONSTER);
}

export function isNonPlayerNpcEntity(entity: Entity | null | undefined): entity is Entity {
  return entity?.alive === true && entity.type === EntityType.NPC && !isPlayerEntity(entity);
}
