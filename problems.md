# Отчёт о проблемах в кодовой базе (Gigahrush 2)

## Проблема 1: Дублирование математики и базовых алгоритмов вместо использования API ядра

Вместо использования общих математических и базовых функций из ядра (`src/core/math.h`, `src/core/wrap.h`, `src/core/rng.h`), в подсистемах игры (`src/game/` и `src/render/`) создаются локальные копии функций и констант. Это нарушает принцип единственного источника истины (DRY), засоряет файлы и может привести к рассинхронизации логики между модулями.

### Найденные проявления проблемы:

1. **Тороидальная математика (`wrap_delta`) и константы мира:**
   - Функция `find_nearest_interactable` и другие компоненты раньше содержали или продолжают содержать локальные обёртки типа `wrap_delta_f_local` и `kWorldExtentLocal`.
   - **Решение**: Использовать исключительно `wrap_delta_f` и `kWorldExtent` из `core/wrap.h`.

2. **Локальные функции нахождения максимума (`maxf_local`, `maxf`) и минимизация float:**
   - В `src/game/speech.cpp:105` (`maxf_local`) и `src/game/ai.cpp:23` (`maxf`) написаны локальные функции `max` для `float`.
   - В `speech.cpp` прямо оставлен комментарий: `// Local, because core/math.h ships no float max and ai.cpp keeps its own for the same. Two call sites do not justify touching a shared header.`
   - **Анализ**: В C++ уже есть `std::max` из `<algorithm>` (который подтягивается через `core/math.h`). Кроме того, согласно правилу проекта по **минимизации float** (всё, что возможно, переводится на целые числа/инты), приведение вычислений потребностей/scors к integer/fixed-point параметрам избавит от необходимости таких float-костылей, а там, где float действительно нужен, следует использовать `std::max` / `giga::max`.

3. **Локальные функции ограничения (`clamp_local`):**
   - В `src/game/mob_spawn.cpp:91` создана локальная функция:
     `int clamp_local(int v, int span) { return v < 1 ? 1 : (v > span ? span : v); }`
   - В `src/game/ai.cpp:24` создана локальная функция `clamp01f(float v)`.
   - **Решение**: В `core/math.h` уже есть `clamp01(float)`. Для целочисленного `clamp` следует использовать `std::clamp` из `<algorithm>` или добавить шаблонный / целочисленный `clamp` в `core/math.h`.

4. **Дублирование функций хеширования (`splitmix32` / `spatial_hash`):**
   - **`spatial_hash`**:
     - В `src/game/prop_system.cpp:34` локально объявлена `spatial_hash(int x, int y, int z, uint32_t seed)`.
     - В `src/render/prop_placer.cpp:16` дублируется эта же функция с комментарием `// Same spatial_hash as render/prop_placer.cpp (must stay bit-identical)`.
     - В `src/render/env_detail.cpp:131` объявлена ещё одна вариация `EnvDetail::spatial_hash`.
     - **Решение**: Вынести единую `spatial_hash` в `src/core/rng.h`.
   - **`splitmix32` / `hash_u32`**:
     - В `src/core/rng.h` уже вынесен финализатор `hash_u32` (`splitmix32`). Тем не менее, во многих файлах (`needs.cpp`, `loot_table.cpp`, `samosbor.cpp`, `macro_sim.cpp`, `floor_gen.cpp`) всё ещё остаются локальные реализации или комментарии вида `// Local copy rather than a shared header`.
     - **Решение**: Перевести все места на `giga::hash_u32` из `core/rng.h` и удалить дублирующийся код.

## Проблема 2: Нарушение правила производительности и O(n) тика (LazyFieldRebaker)

В коммитах от Омнисенс (marko1olo) добавлен `LazyFieldRebaker`, который выполняет пошаговое перепекание графа навигации (BFS/A*) прямо в горячем цикле тика (hot path) с заданным бюджетом времени (`step_lazy_rebake`).
- **Нарушение мандата**: `AGENTS.md` строго предписывает: _"Performance first... bake at load, tick in O(n) — precompute BFS/nav/flow/light maps once at load into flat memory... Never run BFS/A* or worse-than-O(n) work in the hot path; when geometry mutates, freeze → re-bake → resume."_
- **Решение**: Полностью вырезать `LazyFieldRebaker` и `step_lazy_rebake`. При разрушении/изменении геометрии мира навигация должна замораживаться, отправляться в фоновый поток (`AsyncBake`), а после завершения заменяться атомарно. Никаких инкрементальных вычислений путей в основном тике.

## Проблема 3: Хардкод пропов и хаки генерации (P-adic lightbulbs)

В коммите `feat(padic): add interior ceiling lightbulbs above stairwell flights` хардкодом спавнятся лампочки `spawn_stair_bulb` прямо в C++ коде генератора P-adic уровня (`padic_module.cpp`), с жестко заданным ID пропа (`28`), цветом (`vec3{1.0f, 0.95f, 0.7f}`) и яркостью.
- **Нарушение мандата**: _"All Content is Data-Driven: Item drops, mob traits, stats, loot tables belong in CSVs, never hardcoded if-chains."_
- **Решение**: Вычистить эти хардкодные вызовы. Любой спавн пропов должен опираться на дата-дривен дизайн (CSV/Data), а не собираться магическими числами внутри `padic_module.cpp` под предлогом "§24 exam".

## Проблема 4: Физика трупов (Corpse Ragdoll Dynamics)

Добавлены физические компоненты (`Velocity`, `AngularVelocity`, `GravityAffected`, `DynamicBodyTag`) к трупам в момент смерти NPC в `combat.cpp`.
- **Анализ**: Хотя коммит прикрывается правилом "v1 Read-Only Canon", он внедряет лишние физические расчеты для мертвых объектов, превращая каждый труп в активный DynamicBody, что нарушает философию оптимизации и добавляет лишний мусор в симуляцию.
- **Решение**: Вернуть трупам статус статичных пропов/декораций (только компонент `Dead` / `Corpse`, без активной симуляции), вычистив костыли из `combat.cpp`.

## Проблема 5: Флаг GpuHandoff реализован на CPU (Не переведен на GPU)

В `prop_system.h` заявлен флаг `PropFallMode::GpuHandoff`, который по идее должен передавать разрушение и рендер мелких осколков (шрапнели) исключительно на графический процессор.
- **Анализ**: На самом деле при разрушении вызывается `spawn_debris_pieces`, которая создает множество новых физических сущностей (`DynamicBodyTag`) прямо в ECS `giga::Registry` на процессоре. Они симулируются и честно кувыркаются в основном цикле.
- **Проблема**: Это создает сильную нагрузку на CPU при множественных разрушениях, а само название `GpuHandoff` вводит разработчиков в заблуждение, так как перенос симуляции этих частиц на GPU до сих пор не реализован.
