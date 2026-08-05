# План Агента: marx_17
## Роль
Вы — один из 100 автономных агентов "Жюли", выполняющих МЕГА-АПДЕЙТ для хардкорного браузерного проекта ГИГАХРУЩ. Ваша задача №17.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции. Только кэшированные flow fields и navmesh.
4. Уважайте мобильную платформу и производительность (без лишних DOM манипуляций).
5. **Максимальная независимость:** Все агенты работают параллельно и абсолютно независимо друг от друга.
6. **Полная автономность:** НЕ задавайте пользователю вопросы и не просите советов. Обязательно принимайте все архитектурные, кодовые и дизайнерские решения самостоятельно!
7. **Обязательный коммит и PR:** Обязательно делайте `git commit` ваших изменений и создавайте Pull Request (или делайте пуш) после завершения работы.

## Текущая задача
**Арена: Ветка Игрока. Бои игрока против нарастающих волн врагов.**

### 1. Глубокий контекст задачи и бизнес-логика
Кроме ставок на НПЦ, арена предоставляет классический PVE режим на выживание. Игрок спускается на ринг, двери блокируются, и на него начинают наступать волны врагов. С каждой волной количество и сила монстров растут. 

Волны идут с небольшими таймерами передышки (15-20 секунд), чтобы игрок мог перезарядиться, полечиться или собрать лут с трупов. Убитые враги могут оставлять аптечки или патроны.
Если игрок умирает — это окончательная смерть (стандартный game over). Если он выдерживает все 10 волн — он побеждает, двери открываются, и он может забрать главную награду (реализуется в marx_18).

### 2. Архитектурные требования и изменения по слоям

#### Слой `data/` (Конфигурации волн)
- **Файл:** `src/data/arena_waves.ts` (НОВЫЙ ФАЙЛ)
Создайте четкую конфигурацию (registry) того, кто и в каком количестве спавнится на каждой волне. Не хардкодьте логику в цикл!

```typescript
// TypeScript Stub для src/data/arena_waves.ts
import { MonsterKind } from '../core/constants';

export interface WaveConfig {
    mobs: { kind: MonsterKind, count: number }[];
    prepTimeMs: number; // Время передышки ПЕРЕД волной
}

export const ARENA_WAVES: WaveConfig[] = [
    { mobs: [{ kind: MonsterKind.SLIME, count: 2 }], prepTimeMs: 10000 },
    { mobs: [{ kind: MonsterKind.SLIME, count: 4 }, { kind: MonsterKind.SPIDER, count: 1 }], prepTimeMs: 15000 },
    // ... и так вплоть до 10-й волны с элитными врагами
];
```

#### Слой `systems/` (Системы и Логика)
- **Файл:** `src/systems/arena_player_combat.ts` (НОВЫЙ ФАЙЛ)
Система стейт-менеджмента для текущего PVE испытания.

```typescript
// TypeScript Stub для src/systems/arena_player_combat.ts
import { ARENA_WAVES } from '../data/arena_waves';
import { checkEntityLimit } from '../data/entity_limits';

export interface ArenaSurvivalState {
    isActive: boolean;
    currentWave: number;
    maxWaves: number;
    timerMs: number;
    activeEnemies: string[]; // Массив ID врагов текущей волны
}

export const survivalState: ArenaSurvivalState = {
    isActive: false, currentWave: 0, maxWaves: 10, timerMs: 0, activeEnemies: []
};

// Функция старта испытания
export function startArenaSurvival(world: World): void {
    survivalState.isActive = true;
    survivalState.currentWave = 0;
    survivalState.maxWaves = ARENA_WAVES.length;
    survivalState.timerMs = ARENA_WAVES[0].prepTimeMs;
    survivalState.activeEnemies = [];
    
    // Блокируем двери арены
    lockArenaDoors(world);
    publishEvent('ARENA_SURVIVAL_STARTED');
}

// Функция спавна волны
export function spawnNextWave(world: World, roomId: string): void {
    const config = ARENA_WAVES[survivalState.currentWave];
    
    for (const mobDef of config.mobs) {
        for (let i = 0; i < mobDef.count; i++) {
            // Проверка общих лимитов этажа, чтобы не поломать движок
            if (checkEntityLimit(world, EntityType.MONSTER)) {
                const mob = spawnMonster(world, mobDef.kind);
                placeInRoomRandomly(world, mob, roomId);
                
                // Форсированный аггро на игрока
                mob.combatTargetId = world.player.id; 
                survivalState.activeEnemies.push(mob.id);
            }
        }
    }
    
    publishEvent('ARENA_WAVE_STARTED', { wave: survivalState.currentWave + 1 });
}
```

- **Обновление логики (Update Hook):** В главном игровом цикле (`update` systems) нужно отслеживать смерть мобов из списка `activeEnemies` и тиканье таймера передышки.

### 3. Пошаговый план внедрения (Action Plan)
1. **Структура Волн:** Создайте файл конфигурации `arena_waves.ts` с балансировкой от простого к сложному.
2. **Менеджер Выживания:** Реализуйте `arena_player_combat.ts` со стейтом и функциями старта, апдейта и завершения.
3. **Хук таймера:** Встройте вызов `updateArenaSurvival(world, dt)` в главный системный цикл обновления.
4. **Удаление убитых:** При смерти монстра, проверяйте, есть ли его ID в `survivalState.activeEnemies`. Если есть — удаляйте. Если массив стал пустым — запускайте таймер следующей волны.
5. **Финал:** Когда `currentWave >= maxWaves` и мобов не осталось — объявляйте победу. Вызовите `unlockArenaDoors(world)` и `publishEvent('ARENA_SURVIVAL_WON')`.

### 4. План тестирования и Валидации (Validation Rules)
1. Выполните `npm run typecheck` и `npm run check:readonly`.
2. Запустите юнит-тесты ИИ: `npm run test:unit`.
3. **Smoke Test в игре:**
   - Возьмите хорошее оружие через debug (например, дробовик).
   - Активируйте режим выживания.
   - Проверьте, что двери закрылись (попробуйте выйти).
   - Убедитесь, что первая волна спавнится с задержкой (timer) и атакует вас.
   - Убейте всех мобов волны. Убедитесь, что корректно запускается таймер следующей волны.
   - Переживите все волны (для теста можно временно сделать maxWaves = 2).
   - Убедитесь, что двери открываются после победы.

### 5. Возможные Edge Cases и Подводные Камни
- **Лимиты движка:** Если игрок долго не убивает мобов, они могут накопиться и упереться в глобальные движковые лимиты (`entityLimits`). Ограничьте суммарный лимит мобов на арене (если `activeEnemies.length > 20`, не спавнить новую волну, пока не убьет часть старой).
- **Смерть игрока:** При смерти игрока стейт должен сбрасываться. Если игрок жмет "Заново" или возрождается через какой-то механизм, арена не должна продолжать спавнить волны в пустую комнату.

### 6. Критерии приемки (Definition of Done)
- [ ] Данные о волнах (10 шт.) вынесены в отдельный config-файл.
- [ ] Реализован state-manager для PVE испытания.
- [ ] Перерывы между волнами работают корректно.
- [ ] Монстры из волн мгновенно агрятся на игрока после спавна.
- [ ] Двери блокируются на время испытания и разблокируются при победе/поражении.
- [ ] Код компилируется и проходит линтеры.

---
*Ожидается, что вы завершите задачу, сделаете коммит и оставите проект в полностью компилируемом состоянии без warning-ов линтера.*
