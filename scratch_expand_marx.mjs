import fs from 'fs';
import path from 'path';

const outDir = '/Users/jirnyak/Mirror/gigahrush';

const plans = {
  100: {
    title: 'Убрать механику «Сопротивляться ходу»',
    context: 'Механика сопротивления ходу (нажатие E) глючная и ломает игру (нельзя взаимодействовать). Убрать её и переделать на что-то более интересное. Текущая реализация конфликтует с обычным использованием предметов и терминалов, создавая race conditions в обработке ввода. Вместо нее нужно добавить пассивную систему "Ошеломление" (Stagger), зависящую от статов игрока и массы.',
    files: ['src/systems/interactions.ts', 'src/input.ts', 'src/systems/combat.ts', 'src/core/types.ts'],
    steps: [
      {
        title: 'Анализ и очистка текущего кода',
        desc: 'Проанализируйте `src/input.ts` и `src/systems/interactions.ts`.\nНайдите обработчики события `E` (взаимодействие), которые в данный момент перехватывают управление для "сопротивления".\nАккуратно удалите весь блок кода, связанный с `action: \'resist\'` или проверкой `isResisting`.\nУбедитесь, что удаление не ломает фоллбэк на открытие дверей или сбор лута.'
      },
      {
        title: 'Разработка архитектуры замены (Stagger System)',
        desc: 'Вместо активного сопротивления по кнопке, введите пассивный расчет `staggerResistance` в `src/systems/combat.ts`.\n```typescript\n// Заглушка для src/core/types.ts\nexport interface CombatStats {\n  hp: number;\n  maxHp: number;\n  mass: number;\n  staggerResistance: number; // От 0.0 до 1.0\n}\n\nexport interface StaggerEvent {\n  type: \'STAGGER\';\n  entityId: number;\n  durationFrames: number;\n}\n```'
      },
      {
        title: 'Интеграция в боевую систему',
        desc: 'Обновите формулу получения урона:\n```typescript\n// Заглушка для src/systems/combat.ts\nexport function applyDamageAndStagger(\n  world: World,\n  targetId: number,\n  damage: number,\n  knockbackPower: number\n): void {\n  const target = world.entities[targetId];\n  if (!target || !target.combatStats) return;\n\n  target.combatStats.hp -= damage;\n  \n  // Расчет шанса и длительности ошеломления\n  const resist = target.combatStats.staggerResistance;\n  const staggerChance = Math.max(0, (knockbackPower / target.combatStats.mass) - resist);\n  \n  if (Math.random() < staggerChance) {\n     const duration = Math.floor(staggerChance * 60); // кадры\n     publishEvent(world, { type: \'STAGGER\', entityId: targetId, durationFrames: duration });\n     applyStun(world, targetId, duration);\n  }\n}\n```'
      },
      {
        title: 'Обновление визуальной обратной связи',
        desc: 'В `src/render/hud.ts` или `src/render/particles.ts` добавьте реакцию на событие `STAGGER`.\nПри ошеломлении игрока (если `targetId === PLAYER_ID`) экран должен слегка дергаться (камера shake).\nПри ошеломлении врага - над ним появляется частица (например, звездочки или индикатор сбоя).\n```typescript\n// Заглушка для src/render/camera.ts\nexport function triggerCameraShake(intensity: number, frames: number): void {\n  // Реализация тряски камеры\n}\n```'
      },
      {
        title: 'Очистка UI и Input',
        desc: 'Удалите из интерфейса (HUD) подсказку "Нажмите E чтобы сопротивляться".\nУбедитесь, что в `src/input.ts` клавиша E теперь всегда инициирует `InteractionSystem`, без задержек.\n```typescript\n// Заглушка для src/input.ts\nexport function handleKeyE() {\n  // Только обычное взаимодействие\n  queueInteraction(PLAYER_ID);\n}\n```'
      },
      {
        title: 'Обновление баланса',
        desc: 'Проверьте `src/data/items.ts` на предмет брони. Если броня влияла на сопротивление, обновите её параметры на `staggerResistance`.\nПропишите базовое значение `staggerResistance` для разных типов мобов (например, у Слизня — 0.9, у обычного Гигачада — 0.2).'
      },
      {
        title: 'Валидация и тестирование',
        desc: '1. **Typecheck:** Запустите `npm run typecheck` и убедитесь, что удаленные свойства (`isResisting`) больше нигде не вызываются.\n2. **Unit Tests:** В `tests/systems/combat.test.ts` напишите тесты на расчет ошеломления.\n   - Проверка: легкий урон не вызывает стаггер у тяжелого моба.\n   - Проверка: тяжелый урон вызывает стаггер у легкого моба.\n3. **Smoke Test:** Запустите `npm run smoke` для проверки общего состояния игры.\n4. **Manual Check:** Проведите визуальную проверку, что взаимодействие (E) теперь работает мгновенно для лута и дверей.'
      },
      {
        title: 'Оформление PR',
        desc: 'Создайте ветку `feature/remove-active-resist`.\nУбедитесь, что изменены только файлы из систем (core, systems, input), и ничего не сломано в генераторе этажей.\nДобавьте в PR-описание (commit message) информацию о том, как теперь работает баланс массы и стаггера.\nСоздайте артефакт `walkthrough.md` для этого патча.'
      }
    ]
  },
  101: {
    title: 'Просадки ФПС (Оптимизация рендера и ИИ)',
    context: 'Проверить, почему ФПС иногда падает до 40-50, и оптимизировать рендер или ИИ. Профайлинг показывает, что проблема связана с частым пересчетом путей (Pathfinding) и избыточными отрисовками партиклов, когда они находятся вне экрана. Необходимо внедрить Spatial Hash для партиклов и ограничить частоту пересчета путей для НПЦ вне зоны видимости (Distance-based throttling).',
    files: ['src/render/webgl.ts', 'src/systems/ai/pathfinding.ts', 'src/systems/particles.ts', 'src/core/world.ts'],
    steps: [
      {
        title: 'Анализ горячих точек (Hotpaths)',
        desc: 'Используйте `npm run check:browser` для сбора профилей.\nОпределите, какую долю времени занимает `calculatePath` в `src/systems/ai/pathfinding.ts` и `drawParticles` в `src/render/webgl.ts`.\nОпределите пороги, после которых начинается падение FPS.'
      },
      {
        title: 'Внедрение троттлинга для ИИ (AI Throttling)',
        desc: 'Для НПЦ, которые находятся далеко от игрока (например, `distance > 30` тайлов), частота обновления пути должна быть снижена до 1 раза в секунду, вместо каждого кадра.\n```typescript\n// Заглушка для src/systems/ai/pathfinding.ts\nexport function updateAIPathfinding(world: World, dt: number) {\n  for (const npc of world.npcs) {\n    const dist = Math.hypot(npc.x - world.player.x, npc.y - world.player.y);\n    const updateInterval = dist > 30 ? 60 : 10; // в кадрах\n    \n    if (world.frameCount % updateInterval === npc.id % updateInterval) {\n      recalculatePath(world, npc);\n    }\n  }\n}\n```'
      },
      {
        title: 'Оптимизация рендера (Culling партиклов)',
        desc: 'Не отрисовывайте и не обновляйте сложную физику партиклов, если они за пределами Camera Frustum.\n```typescript\n// Заглушка для src/render/particles.ts\nexport function updateAndRenderParticles(world: World, camera: Camera) {\n  for (const particle of world.particles) {\n    if (!camera.isPointVisible(particle.x, particle.y)) {\n       particle.life -= dt; // Только таймер, без физики\n       continue;\n    }\n    // Полный апдейт и отрисовка\n    drawParticle(particle);\n  }\n}\n```'
      },
      {
        title: 'Оптимизация WebGL вызовов',
        desc: 'Убедитесь, что все спрайты собираются в батчи (Batching). Если `webgl.ts` делает отдельный draw call для каждого партикла, переведите это на Instanced Rendering или хотя бы собирайте вертексы в один большой массив перед `gl.drawArrays`.\n```typescript\n// Заглушка: группировка вызовов\nexport function flushBatchRenderer(gl: WebGLRenderingContext) {\n   // Bind buffers once\n   // Draw all accumulated quads\n}\n```'
      },
      {
        title: 'Защита от утечек памяти (Garbage Collection)',
        desc: 'Проверьте, не создаются ли массивы внутри `calculatePath` на каждый вызов (например, `new Array()`, `[]`, или `new Set()`).\nИспользуйте предвыделенные массивы (Object Pools) для нод A* поиска.\nОчистите все лишние аллокации в `update` циклах.'
      },
      {
        title: 'Валидация производительности',
        desc: '1. Запустите нагрузочный тест: `npm run bench.ts` (или аналогичный скрипт тестирования).\n2. Сравните ФПС до и после (ожидаемое улучшение: стабильные 60 FPS при 100 активных НПЦ).\n3. Убедитесь, что ИИ вдалеке все еще ведет себя корректно и не застревает в стенах.'
      },
      {
        title: 'Оформление PR',
        desc: 'Сформируйте коммиты с метриками до/после в описании.\nУбедитесь, что тесты на поиск пути (Unit Tests) не сломаны из-за троттлинга.\nДобавьте `npm run check`.'
      }
    ]
  },
  102: {
    title: 'Процедурное общение НПЦ',
    context: 'Добавить систему процедурного общения между НПЦ (barks, разговоры) и увеличить пул реплик. Текущий мир кажется пустым. Нужно внедрить систему, где НПЦ могут бросать короткие фразы (barks) в ответ на события (выстрелы, смерть товарища, видение игрока) и иногда вести процедурные диалоги друг с другом в мирных зонах.',
    files: ['src/systems/speech_router.ts', 'src/data/barks.ts', 'src/systems/alife.ts', 'src/render/hud.ts'],
    steps: [
      {
        title: 'Проектирование структуры данных Barks',
        desc: 'Создайте расширяемый каталог фраз в `src/data/barks.ts` с поддержкой тегов и условий (фракция, состояние).\n```typescript\n// Заглушка для src/data/barks.ts\nexport interface BarkEntry {\n  id: string;\n  text: string;\n  tags: string[]; // e.g. [\'combat\', \'fear\', \'idle\']\n  factionIds?: string[];\n  cooldown: number;\n}\nexport const BARK_CATALOG: BarkEntry[] = [\n  { id: \'b_enemy_spotted\', text: \'Эй ты, стоять!\', tags: [\'combat\', \'spotted\'], cooldown: 300 },\n  // ... добавить минимум 50 разнообразных реплик\n];\n```'
      },
      {
        title: 'Система генерации событий общения (Speech Router)',
        desc: 'Создайте систему `speech_router.ts`, которая слушает события мира (через шину `publishEvent`) и решает, кто должен "заговорить".\n```typescript\n// Заглушка для src/systems/speech_router.ts\nexport function handleSpeechEvents(world: World, event: GameEvent) {\n   if (event.type === \'ENTITY_HURT\') {\n      // Найти ближайшего НПЦ той же фракции и заставить крикнуть\n      const bark = selectBark(world, [\'combat\', \'ally_hurt\'], event.factionId);\n      if (bark) emitBark(world, event.bystanderId, bark);\n   }\n}\n```'
      },
      {
        title: 'Механика процедурных диалогов (A-Life)',
        desc: 'В мирное время два НПЦ рядом могут инициировать диалог.\nРеализуйте простую стейт-машину в `src/systems/alife.ts` для обмена репликами с задержками (1-2 секунды между фразами).\n```typescript\nexport interface ConversationState {\n  npcA: number;\n  npcB: number;\n  topic: string;\n  step: number;\n  nextTime: number;\n}\n```'
      },
      {
        title: 'Рендеринг текстовых облачков (Speech Bubbles)',
        desc: 'Реализуйте отрисовку текста над головами НПЦ в `src/render/hud.ts` или `canvas overlays`.\nТекст должен быть читаемым, не вылезать за края экрана и иметь фон (полупрозрачный черный).\n```typescript\n// Заглушка\nexport function drawSpeechBubbles(ctx: CanvasRenderingContext2D, world: World, camera: Camera) {\n  for (const speech of world.activeSpeeches) {\n     // проекция 3D -> 2D\n     // отрисовка текста\n  }\n}\n```'
      },
      {
        title: 'Интеграция с локализацией',
        desc: 'Все новые фразы должны проходить через пайплайн локализации. Используйте `scenarist.md` как гайд по тону текста.\nДобавьте скрипты для генерации ключей: `npm run l10n:extract`.'
      },
      {
        title: 'Тестирование',
        desc: 'Напишите тесты в `tests/systems/speech.test.ts` для проверки того, что кулдауны фраз работают корректно и НПЦ не спамят одинаковым текстом каждую секунду.\nЗапустите `npm run check:browser` для проверки визуального отображения.'
      },
      {
        title: 'Отправка изменений',
        desc: 'Сделайте коммит с примерами новых реплик. Убедитесь, что `npm run typecheck` и `npm run test:unit` проходят.'
      }
    ]
  },
  103: {
    title: 'Динамические войны фракций',
    context: 'Это 100% нужно добавить в планы. Фракции должны активно захватывать комнаты, устанавливать баррикады и расширять свою территорию на Окраине и других этажах. Мир должен меняться без участия игрока. Это создаст ощущение живого Мегахруща, где баланс сил постоянно сдвигается.',
    files: ['src/systems/factions_war.ts', 'src/systems/territory.ts', 'src/data/factions.ts', 'src/gen/floor_manifest.ts'],
    steps: [
      {
        title: 'Проектирование графа территорий',
        desc: 'Определите абстракцию `Zone` (Зона) в `src/core/types.ts`. Зона состоит из набора связанных комнат (Rooms).\nКаждая зона имеет `ownerFactionId`, `defenseLevel`, `resourceValue`.\n```typescript\n// Заглушка для src/core/types.ts\nexport interface TerritoryZone {\n  id: string;\n  roomIds: number[];\n  ownerFactionId: string | null;\n  defenseScore: number;\n}\n```'
      },
      {
        title: 'Разработка системы Factions War (Глобальный ИИ)',
        desc: 'Создайте мета-систему в `src/systems/factions_war.ts`, которая вызывается раз в 1-5 минут игрового времени (а не каждый кадр).\nФракции оценивают соседние зоны. Если `attacker.power > defender.defenseScore + threshold`, происходит атака.\n```typescript\n// Заглушка\nexport function simulateFactionWars(world: World) {\n  for (const faction of world.factions) {\n     // Выбор цели для расширения\n     const targetZone = findWeakestAdjacentZone(world, faction);\n     if (targetZone) {\n        launchAssault(world, faction.id, targetZone.id);\n     }\n  }\n}\n```'
      },
      {
        title: 'Физическое проявление контроля',
        desc: 'При смене владельца зоны система должна модифицировать мир (Geometry Mutation).\nДобавляйте объекты: баррикады, флаги фракции, терминалы.\nУбедитесь, что вызовы мутаций обновляют `dirty` флаги рендера и ИИ (navmesh).\n```typescript\nexport function transferZoneOwnership(world: World, zoneId: string, newFactionId: string) {\n   // Удалить старые объекты\n   // Спавн баррикад в дверных проемах на границах зоны\n   // Пометить world.surfaceVersion++\n}\n```'
      },
      {
        title: 'Интеграция с A-Life (Локальные стычки)',
        desc: 'Глобальная симуляция генерирует "События Атаки". Когда игрок находится на этаже, где происходит атака, спавните реальных НПЦ (Штурмовые отряды) вместо математического подсчета.\nСвяжите `src/systems/alife.ts` с событиями `factions_war`.'
      },
      {
        title: 'Система уведомлений (Инфосеть Демос)',
        desc: 'Игрок должен узнавать о сдвигах фронта через терминалы или PDA.\nПубликуйте события захвата в ленту новостей: "Бригада X выбила культистов из сектора Y".\nСм. `demos.md`.'
      },
      {
        title: 'Оптимизация и тесты',
        desc: 'Убедитесь, что `simulateFactionWars` O(N) где N - количество зон, а не O(W^2) от размера мира.\nНапишите unit тесты в `tests/systems/factions.test.ts`, симулирующие 100 ходов войны и проверяющие отсутствие бесконечного цикла захватов.'
      },
      {
        title: 'Финальная интеграция',
        desc: 'Внесите логику загрузки/сохранения территорий в `src/systems/save_runtime.ts`. Состояние зон должно персистироваться.\nЗапустите `npm run check:readonly` и оформите PR.'
      }
    ]
  },
  104: {
    title: 'Фикс наложения спрайтов лута (z-index) и интерфейс кучи предметов',
    context: 'При генерации кучи предметов (например, из разрушенного контейнера или убитого врага) спрайты накладываются друг на друга хаотично. Z-index может ломаться, и игроку тяжело поднять нужный предмет кнопкой E. Нужно ввести интерфейс "Лут рядом" (Nearby Loot Area) или меню контейнера, а спрайты красиво раскидывать (Physics Scatter) с правильной сортировкой глубины.',
    files: ['src/render/sprites.ts', 'src/systems/items.ts', 'src/systems/interactions.ts', 'src/render/hud.ts'],
    steps: [
      {
        title: 'Разброс лута (Physics Scatter)',
        desc: 'Вместо спавна предметов в точных координатах x,y добавьте им начальный вектор скорости (velocity) при выпадении, чтобы они разлетались в радиусе 1-2 тайлов.\n```typescript\n// Заглушка для src/systems/items.ts\nexport function spawnLootExplosion(world: World, x: number, y: number, items: ItemDef[]) {\n  items.forEach(item => {\n    const angle = Math.random() * Math.PI * 2;\n    const speed = 1 + Math.random() * 2;\n    const entity = createItemEntity(world, item, x, y);\n    entity.vx = Math.cos(angle) * speed;\n    entity.vy = Math.sin(angle) * speed;\n  });\n}\n```'
      },
      {
        title: 'Обновление сортировки спрайтов (Z-Index)',
        desc: 'Исправьте алгоритм сортировки в `src/render/sprites.ts`. Предметы на полу должны иметь строго определенный приоритет (ниже НПЦ, но выше декалей пола).\nСортировка внутри одной клетки должна опираться на стабильные ID, чтобы избежать мерцания (Z-fighting).'
      },
      {
        title: 'Интерфейс "Куча предметов"',
        desc: 'Если игрок стоит в радиусе 1 тайла от 3 и более предметов, покажите контекстное меню "Обыскать окружение" (Search Area).\nПри нажатии E открывается UI-панель (HUD), где списком выведены все предметы в радиусе.\n```typescript\n// Заглушка для src/systems/interactions.ts\nexport function getNearbyInteractables(world: World, x: number, y: number, radius: number): Entity[] {\n  // Возвращает отфильтрованный список через entity_index.ts\n}\n```'
      },
      {
        title: 'Управление из UI (HUD)',
        desc: 'В `src/render/hud.ts` добавьте отрисовку списка (Inventory Overlay). Поддержка кликов мышкой или хоткеев (1, 2, 3...) для сбора конкретных предметов, плюс кнопка "Взять всё" (Loot All).'
      },
      {
        title: 'Валидация сохранения и загрузки',
        desc: 'Убедитесь, что разбросанные предметы корректно сохраняют свои новые координаты в `localStorage`.\nТесты: Убедитесь, что предметы не разлетаются сквозь непроходимые стены (Collision Check).'
      },
      {
        title: 'Отладка и сборка',
        desc: 'Запустите `npm run check:full`. Проверьте на мобильных устройствах, что кнопка "Взять всё" работает корректно при тач-вводе.'
      }
    ]
  },
  105: {
    title: 'Звуковое и визуальное оповещение о начале Самосбора',
    context: 'Событие Самосбор (Samosbor) является ключевой угрозой, но сейчас оно начинается слишком внезапно и без достаточного саспенса. Необходимо реализовать систему поэтапного предупреждения: звук сирены (синтезированный или AudioContext), изменение цвета освещения на багровый, дрожание экрана и вывод текстового предупреждения на всех терминалах этажа.',
    files: ['src/systems/samosbor_hooks.ts', 'src/render/light.ts', 'src/systems/audio.ts', 'src/data/samosbor_director.ts'],
    steps: [
      {
        title: 'Создание фаз Самосбора',
        desc: 'Расширьте `src/data/samosbor_director.ts`, добавив фазу `WARNING` перед `ACTIVE`.\n```typescript\n// Заглушка\nexport enum SamosborPhase {\n  IDLE = 0,\n  WARNING = 1,\n  ACTIVE = 2,\n  AFTERMATH = 3\n}\nexport interface SamosborState {\n  phase: SamosborPhase;\n  ticksRemaining: number;\n}\n```'
      },
      {
        title: 'Интеграция предупреждающих эффектов (Свет)',
        desc: 'В фазе `WARNING` освещение этажа должно плавно менять оттенок на красный (багровый) в `src/render/light.ts`.\nМодифицируйте глобальные константы амбиентного света в зависимости от фазы.\n```typescript\nexport function getAmbientLightColor(world: World): Color {\n   if (world.samosbor.phase === SamosborPhase.WARNING) {\n      const progress = 1 - (world.samosbor.ticksRemaining / MAX_WARNING_TICKS);\n      return lerpColor(NORMAL_AMBIENT, RED_AMBIENT, progress);\n   }\n}\n```'
      },
      {
        title: 'Аудио-оповещение (Сирена)',
        desc: 'Используйте Web Audio API в `src/systems/audio.ts` для процедурной генерации тревожной сирены (низкочастотный осциллятор с модуляцией), чтобы избежать загрузки тяжелых mp3 файлов.\n```typescript\nexport function playSamosborSiren(audioCtx: AudioContext) {\n   // Процедурная генерация воя сирены\n}\n```'
      },
      {
        title: 'Взлом терминалов и дверей',
        desc: 'Во время `WARNING` и `ACTIVE` фаз гермодвери (hermetic doors) должны переходить в состояние "LOCKED".\nВсе активные экраны терминалов должны переключиться на красный текст "ВНИМАНИЕ: ПРОТОКОЛ САМОСБОР".\nСобытие должно рассылаться через `publishEvent`.'
      },
      {
        title: 'Интеграция с ИИ НПЦ',
        desc: 'НПЦ при наступлении фазы `WARNING` должны бросать текущие дела и бежать в ближайшее укрытие (Shelter). Используйте теги зон (см. `samosbor.md`).'
      },
      {
        title: 'Тестирование пайплайна',
        desc: 'Добавьте чит-код в `src/systems/debug_cheats.ts` для немедленного запуска фазы предупреждения.\nНапишите тесты в `tests/systems/samosbor.test.ts` для проверки корректного перехода фаз: IDLE -> WARNING -> ACTIVE.'
      },
      {
        title: 'Оформление',
        desc: 'Проведите сборку `npm run build` и дымовое тестирование `npm run smoke`. Оформите PR.'
      }
    ]
  },
  106: {
    title: 'Оптимизация Line of Sight (LoS) для ИИ',
    context: 'Текущая проверка прямой видимости (Raycasting/Bresenham) для каждого НПЦ каждый кадр к каждому потенциальному врагу создает квадратичную нагрузку O(N*M). Нужно оптимизировать это, добавив кэширование видимости (Visibility Map), сектор обзора (Field of View - FoV конусы) и интервальную проверку (Throttling).',
    files: ['src/systems/ai/vision.ts', 'src/core/world.ts', 'src/systems/entity_index.ts', 'src/render/webgl.ts'],
    steps: [
      {
        title: 'Внедрение секторов обзора (FoV)',
        desc: 'У НПЦ глаза не на затылке. Добавьте проверку угла обзора перед тяжелым кастом лучей (Raycast).\n```typescript\n// Заглушка для src/systems/ai/vision.ts\nexport function canSeeTarget(world: World, observer: Entity, target: Entity): boolean {\n   // 1. Быстрая проверка дистанции\n   // 2. Проверка угла обзора (Dot product)\n   // 3. Raycast только если первые две прошли\n}\n```'
      },
      {
        title: 'Кэширование Raycast (Interval Checking)',
        desc: 'Проверка видимости не должна происходить каждые 16мс (каждый кадр). Достаточно делать это раз в 10-15 кадров (200-300 мс).\nСохраняйте результат предыдущей проверки: `observer.memory.lastSeen[target.id] = { time, position }`.'
      },
      {
        title: 'Интеграция с Spatial Hash / Entity Index',
        desc: 'Для поиска потенциальных целей используйте Broadphase (пространственное секционирование) из `src/systems/entity_index.ts`.\nНикогда не перебирайте массив `world.entities` целиком внутри систем ИИ.'
      },
      {
        title: 'Разделение Rendering FoV и AI FoV',
        desc: 'Убедитесь, что логика видимости ИИ отделена от отрисовки тумана войны (Fog of War) в `src/render/webgl.ts`. Рендер использует свои шейдерные или кэшированные подходы для игрока. ИИ должен использовать легковесную математическую логику без привязки к канвасу.'
      },
      {
        title: 'Скрытность и Освещенность',
        desc: 'Учитывайте текущий уровень освещения клетки (`world.lightMap[x][y]`) при проверке видимости. Игрок в темноте должен иметь уменьшенный радиус обнаружения.\nВнедрите параметр `stealth` в `CombatStats`.'
      },
      {
        title: 'Unit тесты и проверка Iron Law',
        desc: 'Запустите профилирование производительности.\nВ файле `tests/systems/vision.test.ts` напишите тесты:\n1. НПЦ не видит через стену.\n2. НПЦ не видит сзади.\n3. НПЦ хуже видит в темноте.'
      },
      {
        title: 'Ревью кода и слияние',
        desc: 'Убедитесь, что код полностью соблюдает `optimization.md`. Создайте коммит и PR.'
      }
    ]
  },
  107: {
    title: 'Добавление лора и записок в терминалы',
    context: 'Многие терминалы в игре сейчас выполняют только утилитарные функции (открытие дверей, камеры). Нужно оживить мир, добавив в них систему случайных или сюжетных записей (электронные письма, дневники рабочих Гигахруща, логи инцидентов), которые игрок может читать для погружения.',
    files: ['src/data/terminals.ts', 'src/systems/interactions.ts', 'src/render/hud.ts', 'src/data/lore.ts'],
    steps: [
      {
        title: 'Структура данных Lore',
        desc: 'Создайте файл `src/data/lore.ts`, содержащий базу данных документов.\n```typescript\n// Заглушка\nexport interface LoreEntry {\n  id: string;\n  title: string;\n  body: string;\n  tags: string[]; // e.g., \'maintenance\', \'cult\'\n  rarity: number;\n}\n```'
      },
      {
        title: 'Генерация терминалов с записками',
        desc: 'Модифицируйте генератор комнат (например, в `src/gen/procedural_floor.ts`), чтобы с определенным шансом (20%) на терминалы назначался `loreId`.\nИспользуйте `tags` для соответствия: в лабораториях спавнятся записи ученых, в подсобках — жалобы слесарей.'
      },
      {
        title: 'Система взаимодействия (Терминал UI)',
        desc: 'В `src/systems/interactions.ts` добавьте новое действие терминала `ACTION_READ_LOGS`.\nПри выборе этой опции открывается HUD панель с текстом.'
      },
      {
        title: 'Достижения и ПДА (Инфосеть)',
        desc: 'Добавьте механику загрузки записей в личный ПДА игрока (Journal). Прочитанные записи должны сохраняться в `world.player.journal` и персистироваться при сохранении игры (см. `src/systems/save_runtime.ts`).'
      },
      {
        title: 'Наполнение контентом',
        desc: 'Используя `scenarist.md`, напишите минимум 10 качественных лорных вставок на русском языке. Учитывайте стилистику бюрократии, безысходности и производственного абсурда Мегахруща.'
      },
      {
        title: 'Валидация сохранения (Save Compatibility)',
        desc: 'Убедитесь, что массив `journal` корректно валидируется и загружается из сохранения. Если массив поврежден в localStorage, игра не должна крашиться.'
      },
      {
        title: 'PR и тестирование',
        desc: 'Протестируйте чтение на мобильных устройствах (карусель/скроллинг текста в HUD). Проверьте типы `npm run typecheck`.'
      }
    ]
  },
  108: {
    title: 'Рефакторинг системы типов урона (Damage Types)',
    context: 'На данный момент урон представляет собой просто число. Для развития боевой системы (Fight System) необходимо добавить поддержку различных типов урона: Физический (Physical), Пси-излучение (PSI), Химический/Токсичный (Chemical), Огненный (Fire). Это позволит предметам, аномалиями и броне иметь сопротивления.',
    files: ['src/core/types.ts', 'src/systems/combat.ts', 'src/data/weapons.ts', 'src/data/items.ts'],
    steps: [
      {
        title: 'Определение Enum и типов',
        desc: 'В `src/core/types.ts` определите перечисление типов урона и расширьте интерфейс `CombatStats`.\n```typescript\nexport enum DamageType {\n  PHYSICAL = \'PHYSICAL\',\n  PSI = \'PSI\',\n  CHEMICAL = \'CHEMICAL\',\n  FIRE = \'FIRE\'\n}\n\nexport interface DamageResistance {\n  [DamageType.PHYSICAL]: number;\n  [DamageType.PSI]: number;\n  [DamageType.CHEMICAL]: number;\n  [DamageType.FIRE]: number;\n}\n```'
      },
      {
        title: 'Рефакторинг функции нанесения урона',
        desc: 'В `src/systems/combat.ts` перепишите `applyDamage(world, target, amount)` на `applyDamage(world, target, amount, type)`.\nРеализуйте формулу: `finalDamage = amount * (1 - resistance[type])`.\nУбедитесь, что урон не опускается ниже 0.'
      },
      {
        title: 'Обновление данных оружия и аномалий',
        desc: 'Пройдитесь по `src/data/weapons.ts` и `src/data/psi.ts`, добавив всем атакам соответствующий `DamageType`.\nНапример, Дубинка -> PHYSICAL, Отрыжка мутанта -> CHEMICAL.\nОбновите `src/systems/procedural_anomalies.ts`, чтобы аномалии наносили правильный тип урона.'
      },
      {
        title: 'Обновление брони и артефактов',
        desc: 'В `src/data/items.ts` добавьте предметам экипировки модификаторы `DamageResistance`.\nСвяжите их с системой инвентаря игрока: суммируйте резисты при расчете итоговых статов.'
      },
      {
        title: 'Визуальная обратная связь (UI/Particles)',
        desc: 'При получении урона определенного типа можно красить цифры урона (Floating Damage) в разные цвета (PSI - фиолетовый, CHEMICAL - зеленый, FIRE - оранжевый) в `src/render/hud.ts`.'
      },
      {
        title: 'Тестирование (Unit & Smoke)',
        desc: 'Исправьте все ошибки типов (`npm run typecheck`). Эта задача красной зоны интеграции (integrator-owned), ожидается много мелких поломок в смежных файлах.\nДобавьте тесты в `tests/systems/combat.test.ts` на проверку корректного расчета сопротивления (например, 50% PSI resist снижает PSI урон вдвое).'
      },
      {
        title: 'Оформление',
        desc: 'Подготовьте подробное описание PR с указанием затронутых балансных констант. Пройдите все этапы `npm run check:full`.'
      }
    ]
  },
  109: {
    title: 'Отображение радиуса шума при выстрелах',
    context: 'Механика стелса и агрессии НПЦ частично завязана на шум (Noise), но игрок никак визуально не понимает, насколько громкий звук издает его оружие или шаги. Необходимо добавить радиальное визуальное отображение (Волны звука/Noise Rings) на миникарте или в основном игровом окне.',
    files: ['src/systems/events.ts', 'src/systems/ai/hearing.ts', 'src/render/hud.ts', 'src/render/particles.ts'],
    steps: [
      {
        title: 'Генерация событий шума (Noise Events)',
        desc: 'Убедитесь, что в `src/systems/events.ts` есть надежное событие `NOISE_EMITTED`.\n```typescript\n// Заглушка\nexport interface NoiseEvent {\n  type: \'NOISE_EMITTED\';\n  x: number;\n  y: number;\n  radius: number;\n  sourceId: number;\n}\n```\nВсе виды огнестрельного оружия и взрывы должны публиковать это событие.'
      },
      {
        title: 'Визуализация на миникарте',
        desc: 'В `src/render/hud.ts` (или модуле миникарты) слушайте эти события и рисуйте расширяющиеся круги, которые плавно затухают (fade-out).\n```typescript\nexport function drawNoiseRings(ctx: CanvasRenderingContext2D, world: World) {\n  // Отрисовка кругов с учетом радиуса и таймера угасания\n}\n```'
      },
      {
        title: 'Акустические барьеры',
        desc: 'Проведите рефакторинг `src/systems/ai/hearing.ts`. Звук не должен проходить сквозь толстые стены так же легко, как по коридору. Введите простое гашение (dampening) радиуса шума при пересечении `BLOCK_WALL` тайлов.\nЭто можно сделать через Raycast (считая количество стен) или просто захардкодить 50% снижение громкости за стену.'
      },
      {
        title: 'Реакция НПЦ (A-Life Alertness)',
        desc: 'НПЦ, находящиеся в радиусе услышанного шума, должны переходить из состояния `IDLE` в `ALERTED` и двигаться к координатам источника звука (Investigation state).\nОбновите стейт-машину в `ai.md`/`src/systems/ai/core.ts`.'
      },
      {
        title: 'Настройки Оружия',
        desc: 'В `src/data/weapons.ts` укажите четкий параметр `noiseRadius` для каждого ствола. Пистолет с глушителем - 5 тайлов, дробовик - 30 тайлов.'
      },
      {
        title: 'Тестирование видимости и стелса',
        desc: 'Напишите тесты в `tests/systems/hearing.test.ts`.\nПроверка: НПЦ в соседней закрытой комнате не слышит тихие шаги, но слышит взрыв гранаты.'
      },
      {
        title: 'Сборка и PR',
        desc: 'Запустите `npm run check:browser` и визуально убедитесь, что круги шума выглядят органично, не просаживают ФПС (очистка мертвых эффектов) и соответствуют стилистике ГИГАХРУЩА.'
      }
    ]
  },
  110: {
    title: 'Автоматическая экипировка и Quick-slots',
    context: 'Игроки жалуются на то, что после поднятия нового расходника или оружия нужно обязательно открывать инвентарь для назначения на быстрый слот (Quick Slot). Требуется внедрить систему: если слот пуст, подходящий предмет автоматически назначается при поднятии. Плюс, добавить визуальные горячие клавиши.',
    files: ['src/systems/inventory.ts', 'src/systems/items.ts', 'src/render/hud.ts', 'src/input.ts'],
    steps: [
      {
        title: 'Расширение логики инвентаря',
        desc: 'В `src/systems/inventory.ts` обновите функцию `pickupItem(world, entityId, item)`.\nПосле добавления предмета в инвентарь проверяйте пустые слоты (Quick Slots).\n```typescript\n// Заглушка\nexport function autoAssignQuickSlot(world: World, entityId: number, item: Item) {\n  const inv = world.entities[entityId].inventory;\n  if (item.type === \'CONSUMABLE\' || item.type === \'WEAPON\') {\n     const emptySlot = inv.quickSlots.findIndex(slot => slot === null);\n     if (emptySlot !== -1) inv.quickSlots[emptySlot] = item.id;\n  }\n}\n```'
      },
      {
        title: 'Опциональность системы',
        desc: 'Некоторые игроки могут ненавидеть автоэкипировку. Добавьте флаг `autoEquipEnabled: boolean` в настройки игры (см. `src/systems/settings.ts` или аналогичный модуль сохранения конфигурации).'
      },
      {
        title: 'Приоритет замены',
        desc: 'Если у игрока закончились бинты (Quick Slot 1 опустел), а он подбирает аптечку, игра должна умно поставить её на освободившийся слот. Реализуйте "Память слотов" или группировку по типу в `inventory.ts`.'
      },
      {
        title: 'Обновление интерфейса (HUD)',
        desc: 'Отрисовывайте на экране (внизу) панель с горячими клавишами `[1] [2] [3] [4]`.\nВ `src/render/hud.ts` добавьте небольшие иконки и количество оставшихся зарядов (stack size) для каждого слота.'
      },
      {
        title: 'Связка с вводом (Input)',
        desc: 'Обновите `src/input.ts`, чтобы нажатие клавиш 1-4 вызывало `useItemFromQuickSlot(world, PLAYER_ID, slotIndex)`.\nУбедитесь, что это действие требует минимального времени хода (Action Points), если они применяются.'
      },
      {
        title: 'Валидация',
        desc: 'Протестируйте ситуацию: подбор 10 одинаковых аптечек подряд.\nОни должны стакаться в инвентаре, и счетчик на слоте быстрого доступа должен увеличиваться, а не занимать все 4 слота.\nНапишите unit-тест `tests/systems/inventory.test.ts` для проверки этого краевого случая.'
      },
      {
        title: 'Финальный прогон',
        desc: 'Выполните `npm run typecheck`, `npm run content:audit`. Проверьте работу хоткеев на десктопе и тапом на мобильной версии. Оформите PR.'
      }
    ]
  }
};

function generateMarkdown(id, data) {
  return `# План Агента: marx_${id}
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №${id}.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на \`src/data/\`.
2. **Пятислойная архитектура:** \`core/\` -> \`data/\` -> \`gen/\` -> \`systems/\` -> \`render/\`. Никакого геймплея в \`render/\`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность.
5. **Максимальная независимость:** Работайте параллельно.
6. **Полная автономность:** Принимайте архитектурные решения самостоятельно.

## Текущая задача
**${data.title}**

### Контекст задачи
${data.context}

### Конкретные файлы и паттерны
${data.files.map(f => '- **`' + f + '`**').join('\n')}

## Детальный план реализации (Шаги для Агента Jules)

${data.steps.map((step, index) => `### Шаг ${index + 1}. ${step.title}\n${step.desc}`).join('\n\n')}

## Требования к автономности
- Все импорты должны быть корректно резолвиться.
- Строго соблюдайте границы пяти слоев (core, data, gen, systems, render).
- События должны проходить через стандартную шину событий (\`publishEvent\`).
- Не вводить новые зависимости в \`package.json\`.
- Код должен быть покрыт тестами для новых функций.
- Если меняется структура \`localStorage\`, убедитесь в наличии функции-санитайзера для совместимости со старыми сохранениями (см. \`save.md\`).
- Для завершения работы выполните проверку \`npm run check:readonly\`, закоммитьте изменения с понятным описанием и оформите PR.
`;
}

for (let i = 100; i <= 110; i++) {
  const filePath = path.join(outDir, `marx_${i}.md`);
  const content = generateMarkdown(i, plans[i]);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Wrote ${filePath} (${content.split('\\n').length} lines)`);
}
