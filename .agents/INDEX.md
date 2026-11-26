# 🗺️ GigaHrush 2 — Master Documentation Index & Cross-Linking Highway

> **ГЛАВНЫЙ ИНТЕРТЕКСТУАЛЬНЫЙ НАВИГАЦИОННЫЙ ХАБ СИСТЕМЫ**  
> ⚠️ Высшая Конституция (Supreme Law): **[.agents/THE_HAMMER_MASTER_PROMPT.md](file:///C:/gigahrush2/.agents/THE_HAMMER_MASTER_PROMPT.md)**  
> 📜 Архитектурный Канон Систем (S1–S28): **[CANON.md](file:///C:/gigahrush2/CANON.md)**  
> 🗺️ Карта Исполняемого Кода: **[SKELETON.md](file:///C:/gigahrush2/SKELETON.md)**  
> 🚪 Оперативные инструкции и правила агентов: **[AGENTS.md](file:///C:/gigahrush2/AGENTS.md)**  
> 🎯 СТРАТЕГИЧЕСКИЙ МАНИФЕСТ (Graf Irnyak / Klaus Schwab):  
> 1. Фича без живого доказательства в геймплее = ОТКЛОНЕНА (DECLINED).  
> 2. Фича не на фундаментальной базовой системе ядра = ОТКЛОНЕНА (DECLINED).  
> 3. Весь контент строго дата-дривен (CSV — единственный источник правды).  
> 4. Нещадная чистка легаси и костылей.  
> 5. Ретро-пиксель / VHS / CRT эстетика служебной аппаратуры (`WindowRounding = 0.0f`, `#59F266`).  
> 6. Игрок НЕ особенный (игрок = NPC со вселённой камерой).  
> 7. Тороидальный изотропный мир 128³ вокселей, 0.25 м субвоксельные атомы.  

---

## ⚡ AI Agent Navigation Matrix (Матрица Быстрого Перехода)

> **ПРАВИЛО ДЛЯ ВСЕХ ИИ-АГЕНТОВ И СУБАГЕНТОВ:**  
> Не блуждай по дереву файлов наугад. Найди свою задачу в таблице ниже, изучи указанные канонические документы целиком чанками по 800 строк, и только после этого открывай файлы кодовой базы.

| Задача / Домен разработки | Обязательные стандарты и библии | Ключевые файлы кода в репозитории |
|:---|:---|:---|
| **Высшие законы, инварианты, правила сессий** | 1. **[.agents/THE_HAMMER_MASTER_PROMPT.md](file:///C:/gigahrush2/.agents/THE_HAMMER_MASTER_PROMPT.md)**<br>2. **[AGENTS.md](file:///C:/gigahrush2/AGENTS.md)**<br>3. **[CANON.md](file:///C:/gigahrush2/CANON.md)** | `CMakeLists.txt`<br>`tools/check_source_rules.cmake`<br>`CONTINUE.md` |
| **Анатомия движка, слои, память, такт 125 Гц** | 1. **[.agents/CANONICAL_ARCHITECTURE.md](file:///C:/gigahrush2/.agents/CANONICAL_ARCHITECTURE.md)**<br>2. **[SKELETON.md](file:///C:/gigahrush2/SKELETON.md)**<br>3. **[performance.md](file:///C:/gigahrush2/performance.md)** | `src/app/main.cpp`<br>`src/core/tick.h`<br>`src/core/math.h` |
| **Воксельный мир 128³, субвоксели 8³, тор, гравитация** | 1. **[.agents/VOXEL_AND_WORLD_BIBLE.md](file:///C:/gigahrush2/.agents/VOXEL_AND_WORLD_BIBLE.md)**<br>2. **[voxels.md](file:///C:/gigahrush2/voxels.md)**<br>3. **[gravity.md](file:///C:/gigahrush2/gravity.md)** | `src/world/grid.h`<br>`src/world/submask.h`<br>`src/world/gravity.h`<br>`src/core/wrap.h` |
| **Динамическое разрушение, карв, снос зданий** | 1. **[.agents/VOXEL_AND_WORLD_BIBLE.md](file:///C:/gigahrush2/.agents/VOXEL_AND_WORLD_BIBLE.md)**<br>2. **[destruct.md](file:///C:/gigahrush2/destruct.md)**<br>3. **[CANON.md (S2, S16)](file:///C:/gigahrush2/CANON.md)** | `src/world/destruct.cpp`<br>`src/world/destruct.h`<br>`src/world/surface.h` |
| **Физика тел, коллизии AABB, капсулы, рэгдолл** | 1. **[.agents/PHYSICS_AND_BODIES_BIBLE.md](file:///C:/gigahrush2/.agents/PHYSICS_AND_BODIES_BIBLE.md)**<br>2. **[physics.md](file:///C:/gigahrush2/physics.md)** | `src/sim/physics.cpp`<br>`src/sim/physics.h`<br>`src/sim/contact.h` |
| **Тела из 7 частей (CANON S28), кинематика, походка, позы** | 1. **[.agents/PHYSICS_AND_BODIES_BIBLE.md](file:///C:/gigahrush2/.agents/PHYSICS_AND_BODIES_BIBLE.md)**<br>2. **[.agents/GAIT_AND_ACTIONS_DEEP_DIVE.md](file:///C:/gigahrush2/.agents/GAIT_AND_ACTIONS_DEEP_DIVE.md)**<br>3. **[CANON.md (S28)](file:///C:/gigahrush2/CANON.md)**<br>4. **[markoaudit/plans/bodies.md](file:///C:/gigahrush2/markoaudit/plans/bodies.md)** | `src/game/body_pose.cpp`<br>`src/game/body_pose.h`<br>`src/sim/rigid.cpp`<br>`src/render/body_pass.cpp`<br>`data/prop_forms.csv` |
| **GPU Верле-симуляция (провода, тенты, частицы)** | 1. **[.agents/PHYSICS_AND_BODIES_BIBLE.md](file:///C:/gigahrush2/.agents/PHYSICS_AND_BODIES_BIBLE.md)**<br>2. **[antourage.md](file:///C:/gigahrush2/antourage.md)**<br>3. **[CANON.md (S4)](file:///C:/gigahrush2/CANON.md)** | `src/render/verlet_pass.cpp`<br>`shaders/verlet_sim.comp` |
| **Клеточный автомат среды (жидкости, газы, сыпучка)** | 1. **[.agents/PHYSICS_AND_BODIES_BIBLE.md](file:///C:/gigahrush2/.agents/PHYSICS_AND_BODIES_BIBLE.md)**<br>2. **[fluid.md](file:///C:/gigahrush2/fluid.md)**<br>3. **[CANON.md (S16)](file:///C:/gigahrush2/CANON.md)** | `shaders/medium_sim.comp`<br>`src/render/gpu_medium_pass.cpp` |
| **Vulkan Рендерер, Raymarch, освещение DDA, светосетка** | 1. **[.agents/RENDER_AND_RAYMARCH_BIBLE.md](file:///C:/gigahrush2/.agents/RENDER_AND_RAYMARCH_BIBLE.md)**<br>2. **[render.md](file:///C:/gigahrush2/render.md)**<br>3. **[ddalight.md](file:///C:/gigahrush2/ddalight.md)** | `shaders/raymarch.frag`<br>`src/render/voxel_raymarch_pass.cpp`<br>`src/render/light_grid.cpp` |
| **Интерфейс CRT / ImGui, совет-панк аппаратура, HUD** | 1. **[.agents/RENDER_AND_RAYMARCH_BIBLE.md](file:///C:/gigahrush2/.agents/RENDER_AND_RAYMARCH_BIBLE.md)**<br>2. **[hud.md](file:///C:/gigahrush2/hud.md)**<br>3. **[AGENTS.md (§7 UI Aesthetic)](file:///C:/gigahrush2/AGENTS.md)** | `src/render/imgui_layer.cpp`<br>`src/app/hud_ui.cpp`<br>`src/app/hud_ui.h` |
| **Макросим 1 000 000 жителей, контекстное воплощение** | 1. **[.agents/ALIFE_AND_MACROSIM_BIBLE.md](file:///C:/gigahrush2/.agents/ALIFE_AND_MACROSIM_BIBLE.md)**<br>2. **[macrosim.md](file:///C:/gigahrush2/macrosim.md)**<br>3. **[npcs.md](file:///C:/gigahrush2/npcs.md)** | `src/game/macro_sim.cpp`<br>`src/game/embody.cpp`<br>`src/game/population.cpp` |
| **A-Life Utility AI, скоринг интентов, SteerRank руления** | 1. **[.agents/ALIFE_AND_MACROSIM_BIBLE.md](file:///C:/gigahrush2/.agents/ALIFE_AND_MACROSIM_BIBLE.md)**<br>2. **[ai.md](file:///C:/gigahrush2/ai.md)**<br>3. **[CANON.md (S13, S25)](file:///C:/gigahrush2/CANON.md)** | `src/game/ai.cpp`<br>`src/game/guide.cpp`<br>`src/game/guide.h` |
| **Потребности (голод/жажда/сон/туалет), деяния Serve** | 1. **[.agents/ALIFE_AND_MACROSIM_BIBLE.md](file:///C:/gigahrush2/.agents/ALIFE_AND_MACROSIM_BIBLE.md)**<br>2. **[Docs/specs/14_NEEDS_AND_SURVIVAL.md](file:///C:/gigahrush2/Docs/specs/14_NEEDS_AND_SURVIVAL.md)**<br>3. **[CANON.md (S22, S24)](file:///C:/gigahrush2/CANON.md)** | `src/game/needs.cpp`<br>`src/game/serve.cpp`<br>`src/game/serve.h` |
| **Летопись мира Chronicle, события, факты памяти** | 1. **[.agents/ALIFE_AND_MACROSIM_BIBLE.md](file:///C:/gigahrush2/.agents/ALIFE_AND_MACROSIM_BIBLE.md)**<br>2. **[events.md](file:///C:/gigahrush2/events.md)**<br>3. **[CANON.md (S21)](file:///C:/gigahrush2/CANON.md)** | `src/game/chronicle.cpp`<br>`src/game/chronicle.h`<br>`src/game/event_bus.h` |
| **Дата-дривен таблицы CSV, генераторы, кодогенерация** | 1. **[.agents/DATA_TABLES_AND_CSVS_BIBLE.md](file:///C:/gigahrush2/.agents/DATA_TABLES_AND_CSVS_BIBLE.md)**<br>2. **[items.md](file:///C:/gigahrush2/items.md)**<br>3. **[props.md](file:///C:/gigahrush2/props.md)** | `data/*.csv`<br>`tools/gen_*.py`<br>`src/game/*_table.*` |
| **Генерация этажей, лифты, переходы, швы** | 1. **[.agents/CANONICAL_ARCHITECTURE.md](file:///C:/gigahrush2/.agents/CANONICAL_ARCHITECTURE.md)**<br>2. **[floors.md](file:///C:/gigahrush2/floors.md)**<br>3. **[elevators.md](file:///C:/gigahrush2/elevators.md)** | `src/game/floor_stream.cpp`<br>`src/game/elevator.cpp`<br>`src/game/floors/` |
| **Бой, баллистика, огнестрел, кувалда, урон** | 1. **[.agents/PHYSICS_AND_BODIES_BIBLE.md](file:///C:/gigahrush2/.agents/PHYSICS_AND_BODIES_BIBLE.md)**<br>2. **[Docs/specs/09_COMBAT_BALLISTICS_AND_RPG.md](file:///C:/gigahrush2/Docs/specs/09_COMBAT_BALLISTICS_AND_RPG.md)** | `src/game/combat.cpp`<br>`src/game/combat.h`<br>`src/game/ranged_pick.cpp` |
| **Аудит дефектов, Red Team инквизиция, бенчмарки** | 1. **[.agents/RED_TEAM_INQUISITION_REGISTRY.md](file:///C:/gigahrush2/.agents/RED_TEAM_INQUISITION_REGISTRY.md)**<br>2. **[problems.md](file:///C:/gigahrush2/problems.md)**<br>3. **[bugs.md](file:///C:/gigahrush2/bugs.md)** | `tests/rigid_bench.cpp`<br>`tests/perceive_bench.cpp`<br>`tests/game_test.cpp` |

---

## 📚 Каталог Канонических Библий Архитектуры (`.agents/`)

1. **[.agents/THE_HAMMER_MASTER_PROMPT.md](file:///C:/gigahrush2/.agents/THE_HAMMER_MASTER_PROMPT.md)** — Высшая инженерная конституция GigaHrush 2: доктрина T.A.R.S., Закон №0 (обязательное полное чтение файлов чанками по 800 строк), запрет на процедурный онанизм и симуляторы реальности, абсолютный суверенитет CSV данных, презумпция 100% брака при код-ревью.
2. **[.agents/CANONICAL_ARCHITECTURE.md](file:///C:/gigahrush2/.agents/CANONICAL_ARCHITECTURE.md)** — Исчерпывающая архитектурная анатомия воксельного движка: C++23 стандарт, zero-exception / zero-RTTI правила, 8 фундаментальных слоёв ядра, O(n) такт 125 Гц, структура хранения данных SoA, шина событий и память.
3. **[.agents/VOXEL_AND_WORLD_BIBLE.md](file:///C:/gigahrush2/.agents/VOXEL_AND_WORLD_BIBLE.md)** — Канонический стандарт воксельного мира: математика 3D тора 128³, 8³ упакованные битовые маски субвокселей (0.25 м), 8 режимов векторной гравитации `GravityRegime`, динамический карвинг, 6-фасетный селектор поверхностей `surface_face_at`, топология комнат и навигационные поля.
5. **[.agents/PHYSICS_AND_BODIES_BIBLE.md](file:///C:/gigahrush2/.agents/PHYSICS_AND_BODIES_BIBLE.md)** — Канонический физический стандарт: двухуровневая физика (CPU vs GPU), солвер 7-сегментных гуманоидных тел (CANON S28), стабилизация шарниров по Баумгарте, одометр походки `Gait`, прямая кинематика конечностей, расчленение, и GPU Verlet-интегратор антуража и частиц.
6. **[.agents/GAIT_AND_ACTIONS_DEEP_DIVE.md](file:///C:/gigahrush2/.agents/GAIT_AND_ACTIONS_DEEP_DIVE.md)** — Исчерпывающий разбор процедурной кинематики тел: одометр пути ног, аналитический вывод предельного угла размаха $\theta_{\max} \approx 17^\circ$, противофаза конечностей, синхронизация звука шагов из одометра (И3б), пермилле-фаза окна деяния `acting_phase_e3` (И3в), расчленение (S28.4) и тороидальный инвариант шва.
7. **[.agents/RENDER_AND_RAYMARCH_BIBLE.md](file:///C:/gigahrush2/.agents/RENDER_AND_RAYMARCH_BIBLE.md)** — Канонический стандарт рендеринга и визуальной эстетики: Vulkan пайплайн, первичный реймарш `raymarch.frag`, запекание видимости света (9 субвоксельных лучей), светосетка `GpuLightGrid`, совет-панк аппаратура ImGui (`WindowRounding = 0.0f`, фосфор `#59F266`).
8. **[.agents/ALIFE_AND_MACROSIM_BIBLE.md](file:///C:/gigahrush2/.agents/ALIFE_AND_MACROSIM_BIBLE.md)** — Канонический стандарт симуляции живого мира: миллионная макросимуляция, бесшовное контекстное воплощение на активном этаже, Utility AI, цикл физиологических нужд (S24), деяния у интеракторов `Serve` (S22), летопись Chronicle (S21) и арбитраж руления `SteerRank` (S25).
9. **[.agents/DATA_TABLES_AND_CSVS_BIBLE.md](file:///C:/gigahrush2/.agents/DATA_TABLES_AND_CSVS_BIBLE.md)** — Канонический стандарт данных: CSV Single Source of Truth, генераторы таблиц на Python, строгие механические гейты целостности (`tables_fresh`, `csv_columns`, `row_law`, `source_rules`), схема всех датасетов.
10. **[.agents/RED_TEAM_INQUISITION_REGISTRY.md](file:///C:/gigahrush2/.agents/RED_TEAM_INQUISITION_REGISTRY.md)** — Канонический реестр инквизиции дефектов: точные адреса расхождений в кодовой базе `[файл:строка]`, физика воспроизведения, математические доказательства и закрытые гейты верификации.
