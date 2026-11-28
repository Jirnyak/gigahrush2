# ГЛОБАЛЬНЫЙ МАНИФЕСТ ПРОИЗВОДИТЕЛЬНОСТИ C++23, ОПТИМИЗАЦИИ ПАМЯТИ/GPU, ПОРТИРУЕМОСТИ И РЕЛИЗА В STEAM (GIGAHRUSH 2)

> **Статус документа:** Инженерный мастер-план и архитектурная спецификация высшего уровня (Engine Perf & Release Architecture).
> **Базовый срез кода (Ground Truth):** ветка `main`, коммит `15d3da9` (2026-11-28), C++23 (`-fno-exceptions -fno-rtti` на Clang/GCC; `/EHsc /GR- /W4 /wd4100 /permissive- /utf-8` на MSVC), Vulkan 1.2 + SDL3 + EnTT 3.14 + Dear ImGui 1.91.5 + libktx 4.4.0.
> **Метод верификации:** 100% фактура проверена прямым чтением исходного кода (`src/`, `shaders/`, `CMakeLists.txt`, `tools/`). Устаревшие утверждения ранних аудитов (`steam-readiness.md` от 2026-09-12, `release-roadmap.md` от 2026-09-01) перепроверены по живому `HEAD` и разведены на «уже посажено» vs «реально открыто / неполно / критично для релиза».

---

## 0. РЕАЛЬНАЯ КАРТА ТЕХДОЛГА НА HEAD (`15d3da9`) — ЧТО ЗАКРЫТО vs ЧТО БЛОКИРУЕТ РЕЛИЗ

Прошлые аудит-документы (`steam-readiness.md`, ранние части `matwej.md`) содержат десятки устаревших диагнозов. Ниже — точный срез по живому коду `HEAD 15d3da9`:

| Трек / Тема | Утверждение старого аудита | Факт в коде `HEAD 15d3da9` | Инженерный вердикт |
|---|---|---|---|
| **B1** (Пути к шейдерам/ассетам) | Вшит абсолютный `GIGA_SHADER_DIR` (`CMakeLists.txt`) | Частично закрыто: runtime-поиск через `SDL_GetBasePath()` в `main.cpp` и `material_textures.cpp:42-52`, `vk_device.cpp:42-55` | **ОТКРЫТО (хвост):** `GIGA_SHADER_DIR` всё ещё вкомпилирован как абсолютный build-tree path (`CMakeLists.txt:564`); отсутствует поставка кириллического TTF-шрифта (D12); не унифицирован единый `AssetPaths` резолвер для `shaders/`, `data/textures/`, `assets/fonts/`. |
| **B2** (`install()`, CPack, `WIN32`) | 0 `install()`, нет `WIN32`, нет CPack | Частично: `CMakeLists.txt:596-607` добавлены 4 `install()`, `POST_BUILD` копирует DLL | **КРИТИЧНО ОТКРЫТО:** нет `WIN32` в `add_executable` для Release (всплывает чёрная консоль с 245+ `fprintf`), нет `version.rc` и `.ico`, нет `CPack`, нет `GIGA_RELEASE_BUILD` флага, `install()` не кладёт шрифт и не чистит дев-отладку. |
| **B3** (macOS `.app` и Homebrew dylibs) | Бинарь прибит к `/opt/homebrew/...` | Частично: `INSTALL_RPATH` добавлен (`CMakeLists.txt:592`), `MoltenVK_icd.json` ищется от `SDL_GetBasePath()` | **КРИТИЧНО ОТКРЫТО:** `KTX_FEATURE_STATIC_LIBRARY ON` (`CMakeLists.txt:181`), но цель `ktx` всё равно собиралась/линковалась с `libktx.4.dylib` на macOS; `find_package(SDL3 QUIET CONFIG)` цепляет Homebrew `/opt/homebrew/lib/libSDL3.0.dylib`; нет `MACOSX_BUNDLE`, `Info.plist`, `.icns`, `fixup_bundle`/`install_name_tool` + ad-hoc/Developer ID codesign & notarization. |
| **B4** (`kPoolBytes` vs `maxStorageBufferRange`) | `kPoolBytes = 4 294 967 296` (+1 Б UB) | Частично закрыто: `kPageCap` урезан до `kMacroCells = 2 097 152` → **2.0 GiB** (`voxel_mirror.h:139-147`) | **КРИТИЧНО ОТКРЫТО ДЛЯ 4–6 ГБ VRAM:** `pagePool_` всё равно статически выделяет **2048 МиБ одним куском** на старте (`voxel_mirror.cpp:159`), а проверка `maxStorageBufferRange` (`voxel_mirror.cpp:198`) только печатает warning и НЕ проверяет `maxMemoryAllocationSize` и `VK_EXT_memory_budget`! На 4 ГБ GPU / части Intel/AMD / Steam Deck это падение `VK_ERROR_OUT_OF_DEVICE_MEMORY` или PCIe-своп. |
| **B5** (5.0 ГиБ VRAM и 620 МиБ текстур) | ~5.0 ГиБ DEVICE_LOCAL, пустые слоты текстур | Сейчас **~3.1 GiB DEVICE_LOCAL + ~186 MiB HOST**: `pagePool_` 2048 МиБ + `MaterialTextures` **608 МиБ** (3×38 слоёв × 5.333 МиБ при **6 уникальных текстурных сетах = 96 МиБ!**) | **КРИТИЧНО ОТКРЫТО:** 512 МиБ VRAM в `MaterialTextures` тратится впустую (27 пустых слоёв + 5 дубликатов `rubble_*`, которые ещё и декодируются libktx дважды на старте!). Плюс 2048 МиБ статический `pagePool_` + 128 МиБ `GpuLightGrid` + 64 МиБ постоянно резидентный `bakedStaging_`. Цель **< 1.8–2.2 GiB** полностью достижима. |
| **B6** (`/arch:AVX2` без CPUID) | Безусловный `/arch:AVX2` / `-mavx2 -mfma` | **НЕ ТРОНУТО** (`CMakeLists.txt:129-133`), 0 SIMD-интринсиков, 0 CPUID-диспетчера | **КРИТИЧНО ОТКРЫТО:** гарантированный `SIGILL` / `EXCEPTION_ILLEGAL_INSTRUCTION` на любом x86-64 CPU до Haswell/Excavator (Ivy Bridge, Sandy Bridge, Pentium/Celeron без AVX2). |
| **B7** (Сейвы/конфиги в `cwd`) | Всё пишется в `.` | **В ОСНОВНОМ ЗАКРЫТО:** `src/app/app_paths.{h,cpp}` с `SDL_GetPrefPath("TenevikGames", "gigahrush2")` и UTF-8 `_wfopen` | **ПРОВЕРИТЬ ХВОСТЫ:** унификация всех путей, очистка legacy `cwd`-фолбэков и интеграция со Steam Cloud Auto-Cloud. |
| **B8** (Сейв 218 МБ / слот 613 МБ) | RLE-слепок этажа 158–218 МБ | **ЧАСТИЧНО ЗАКРЫТО:** посажен delta-кодек v7 в `save.cpp` (нетронутый этаж = 62 Б!), но формат v29 без сжатия Zstd/LZ4, нет миграций 1.0, `run.sav` везёт `NpcPool` до 446 МиБ сырьём! | **ОТКРЫТО ДЛЯ STEAM CLOUD:** обжитой разрушенный этаж + `NpcPool` (до 425 Б × живые строки) без потокового сжатия и без разреженных оверрайдов пула всё ещё раздуваются до десятков/сотен МБ; `JointLink` не сериализуется; формат v29 не заморожен как 1.0. |
| **B9** (CI/CD + MSVC §69) | Нет CI; MSVC красный на §69 | Workflows написаны, но **142/142 прогона мертвы по биллингу GitHub**; MSVC не гонялся с 2026-09-28 | **КРИТИЧНО ОТКРЫТО:** необходим локальный Windows/macOS regression runner + воспроизведение и закрытие §69 на MSVC + восстановленный CI workflow с кэшированием FetchContent и артефактами. |
| **C4** (Выход во время Prebuild/Rebake) | Зависание на выходе до 6.4 с | **ОТКРЫТО:** `RebakeScheduler::start_prebuild` (`rebake.h:195-198`, `rebake.cpp:365-383`) не передаёт `cancel_` в `restore`/`generate`, деструктор блокируется на `worker_.join()` | **ОТКРЫТО:** кооперативная отмена `std::atomic<bool>& cancel` внутрь `floor_file_read`, `generate_*_floor`, `bake_zone_nav` и `JobSystem`. |
| **C6 / A2** (Утечка и остатки `StainRGB`) | Пятна не освобождаются и не чистятся на реюзе слота | Частично закрыто: `collapse_uniform_cursor_step` сворачивает нулевые `StainRGB`, `carve` роняет пустые страницы | **ПРОВЕРИТЬ A2:** проверить очистку `SubField<StainRGB>` во всех генераторах и `FloorStreamer` при реюзе слота мира + `compact()` пула пятен. |
| **C7** (Краш-хендлер) | Нет перехвата крашей | **БАЗА ПОСАЖЕНА:** `src/app/crash_log.{h,cpp}` (Win32 SEH + `SIGABRT`, POSIX `sigaltstack`/`sigaction` + `backtrace`) | **ДОРАБОТКА ДО STEAM-КЛАССА:** добавить `MiniDumpWriteDump` (`.dmp`) на Windows, ротацию файлов `crash_YYYYMMDD_HHMMSS.log`, контекст GPU/VRAM/seed/git-SHA и кнопку «Открыть папку логов» в меню. |
| **Track D** (Продуктовый полиш D1–D14) | 14 продуктовых блокеров | Часть закрыта (`AppScreen::RunOver`, `settings_ui`, `draw_loading_frame`, `samosbor_fog_tick`, еда через инвентарь; квесты снесены). Остальные проверяются по живому `main.cpp` и `*_ui.cpp` | **ТОЧЕЧНАЯ РЕВИЗИЯ ПО КОДУ:** подробный аудит каждого D1–D14 в Разделе 5 после полного чтения `main.cpp` и всех UI-модулей. |

---

## 1. ЭКСТРЕМАЛЬНАЯ ОПТИМИЗАЦИЯ CPU И ПАМЯТИ (DOD / CACHE / SIMD / MULTITHREADING)

### 1.1. Контракт горячего тика 125 Гц (`kSimHz`) и дисциплина памяти

Фундаментальный инвариант ядра (`src/core/tick.h:28-35`):
- Частота симуляции: `kSimHz = 125`, `kSimDt = 0.008f` (ровно `kSimStepMs = 8` мс без дрейфа целых таймеров).
- Защита от спирали смерти: цикл `while (simAccum >= kSimDt && guard++ < 8)` с обязательным сливом остатка `simAccum` при достижении `guard == 8`.
- **Критическое правило расчёта бюджета:** на 60 FPS один кадр содержит `125 / 60 = 2.083` сим-тика (2–3 тика/кадр); на 120 FPS — `1.04` сим-тика (1–2 тика/кадр). При хитче 64 мс аккумулятор прокручивает до 8 тиков подряд, умножая стоимость каждого пер-тикового прохода в **8×** (феномен «эхо фикс-шага» из `lift-limb-2-prompt.md:52,119` и `matwej.md:205-208`).

#### Бюджет кадра (Frame Budget Table — целевой стандарт Steam Release)

| Профиль цели | Период кадра | CPU Sim Total (1 кадр) | `med_apply` (CPU шов) | `rigid` (пузырь N=111) | `doors` + `physics` + `AI/guide` | CPU Render Prep + Command Recording | GPU Total (`1080p` / `720p` Steam Deck) | Порог детекции хитча |
|---|---|---|---|---|---|---|---|---|
| **120+ FPS (Desktop Mid: i5-12400 / Ryzen 5 5600 / M2 Pro + RTX 3060 / RX 6600)** | **8.33 мс** | **≤ 2.20 мс** | ≤ 0.45 мс | ≤ 0.85 мс | ≤ 0.65 мс | ≤ 1.20 мс | **≤ 6.50 мс** | > 16.6 мс (warn) / > 33.3 мс (fail) |
| **60 FPS (MinSpec: i5-6600 / Steam Deck / GTX 1060 6GB / RX 580)** | **16.67 мс** | **≤ 4.80 мс** | ≤ 0.90 мс | ≤ 1.85 мс | ≤ 1.50 мс | ≤ 2.20 мс | **≤ 13.50 мс** | > 33.3 мс (hard fail) |

*Примечание:* на `HEAD 15d3da9` уже закрыты главные старые убийцы кадра (ход A `kActDirty` срезал лишние `memcmp` в `med_apply`, F1 пузырь `N=111` ограничил `rigid` константой, двухуровневые зоны сжали `ZoneDist` с 414.5 МиБ до 1.20 МиБ). Следующие разделы фиксируют **оставшиеся** системные провалы CPU/памяти, найденные в реальном коде.

---

### 1.2. Устранение CPUID-мины `/arch:AVX2` (Track B6): Безопасный Runtime SIMD Dispatcher

#### Диагноз реального кода
В `CMakeLists.txt:129-133` зашито безусловное требование AVX2 для всех x86-64 сборок:
```cmake
if(MSVC)
    target_compile_options(${tgt} PRIVATE /arch:AVX2)
elseif(CMAKE_SYSTEM_PROCESSOR MATCHES "x86_64|AMD64")
    target_compile_options(${tgt} PRIVATE -mavx2 -mfma)
endif()
```
При этом в дереве `src/` **0** явных SIMD-интринсиков: компилятор использует `/arch:AVX2` только для авто-векторизации и генерации VEX-префиксов (включая `vzeroupper` и AVX-кодировки скалярных `vmovss`/`vaddss` в глобальных инициализаторах ДО `main()`!).
**Последствие:** запуск на любом CPU без AVX2+FMA+BMI2 (Intel Sandy Bridge/Ivy Bridge, часть Pentium/Celeron Gold, AMD Bulldozer/Piledriver/Jaguar) падает мгновенным `EXCEPTION_ILLEGAL_INSTRUCTION` (`0xC000001D`) / `SIGILL` ещё до открытия окна и даже до установки `crash_log_install()`!

#### Архитектура решения: Baseline SSE4.2 + Per-TU Target Compilation + Lock-Free Function Table

**Шаг 1. Понизить глобальный baseline x86-64 до SSE4.2 + POPCNT (покрывает >99.6% Steam Hardware Survey, включая все CPU с 2009+ года):**
- На MSVC: убрать глобальный `/arch:AVX2` из `giga_target_flags()` (baseline x64 на MSVC — SSE2; `std::popcount` компилируется безопасно через fallback или runtime-путь, а не через безусловный `popcnt` без флага; при желании SSE4.2/POPCNT проверяется на входе `main()` с дружественным диалогом SDL вместо молчаливого `SIGILL`).
- На GCC/Clang x86-64: заменить `-mavx2 -mfma` на `-msse4.2 -mpopcnt` как минимальный x86-64-v2 baseline.
- На ARM64 (Apple Silicon / Windows ARM64): NEON (AdvSIMD) является обязательной частью ISA — отдельный флаг не требуется, NEON-ядра компилируются напрямую.

**Шаг 2. Изолированный модуль runtime-диспетчеризации `src/core/simd_dispatch.{h,cpp}` + отдельные TU-ядра `*_avx2.cpp` / `*_sse42.cpp` / `*_neon.cpp`:**
Почему отдельные `.cpp` (а не `__attribute__((target("avx2")))` в заголовках)?
1. MSVC **не поддерживает** per-function `__attribute__((target("avx2")))`! В MSVC единственный способ безопасно компилировать AVX2-код в одном бинаре с базовым x64 — задать `set_source_files_properties(... PROPERTIES COMPILE_OPTIONS "/arch:AVX2")` на конкретный файл `src/core/simd_kernels_avx2.cpp` (а на GCC/Clang `-mavx2 -mfma -mbmi2`).
2. Ни одна VEX-инструкция из `simd_kernels_avx2.cpp` физически не может протечь в код инициализации или в базовые TU (`main.cpp`, `giga_core`).

```cpp
// src/core/simd_dispatch.h (POD, no-exceptions, no-RTTI, zero alloc)
#pragma once
#include <cstddef>
#include <cstdint>

namespace giga::simd {

enum class IsaLevel : std::uint8_t {
    Scalar = 0,
    Sse42  = 1, // x86-64-v2 (SSE4.2 + POPCNT)
    Avx2   = 2, // x86-64-v3 (AVX2 + FMA + BMI2 + F16C + OSXSAVE XMM/YMM enabled)
    Neon   = 3, // ARM64 AdvSIMD
};

struct DispatchTable {
    IsaLevel isa = IsaLevel::Scalar;

    // 1. Проверка однородности 1 КиБ страницы (512 x u16) — SubField::is_page_uniform / floor_awaken / cursor B
    bool (*page_uniform_u16)(const std::uint16_t* page512) noexcept = nullptr;

    // 2. Классификация батча макроклеток (VoxelMirror::upload_wholesale_ / flush)
    void (*classify_cells_batch)(
        const std::uint64_t* masks8,     // n * 8 u64
        const std::uint16_t* types,      // n u16
        const std::uint32_t* pageOf,     // n u32 (kNoPage = 0xFFFFFFFF)
        const std::uint16_t* pagePool,   // flat pool
        std::uint32_t poolCount,
        const std::uint8_t* matFlags,    // LUT[kMatCount]: bit0=is_medium, bit1=passes_light
        std::uint8_t* outClass,          // n u8
        std::size_t n) noexcept = nullptr;

    // 3. Побитовая фильтрация / сравнение страниц в med_apply (1024 B page + 64 B mask diff)
    bool (*page_diff_1024)(const void* a, const void* b) noexcept = nullptr;

    // 4. Пакетная проверка 8 сфер/AABB против сетки или тороидальных расстояний (rigid broadphase / presence kNN)
    void (*wrap_dist2_batch8)(
        const float* px, const float* py, const float* pz,
        float cx, float cy, float cz, float period, float invPeriod,
        float* outDist2, std::size_t n) noexcept = nullptr;

    // 5. Пакетное перепаковывание пятен StainRGB (512 x 3 B -> 512 x 4 B RGBA8) в VoxelMirror::flush
    void (*repack_stain_512)(const std::uint8_t* srcRgb1536,
                             std::uint8_t* dstRgba2048) noexcept = nullptr;

    // 6. Быстрый CRC-32C / CRC-32 (IEEE 0xEDB88320, slice-by-8 или PCLMULQDQ / ARM CRC32) для save.cpp и lightvis-кэша
    std::uint32_t (*crc32_ieee)(const std::uint8_t* data, std::size_t len) noexcept = nullptr;
};

// Инициализируется один раз в самом начале main() (и лениво по первому вызову в тестах).
// Проверяет НЕ ТОЛЬКО CPUID leaf 7 EBX bit 5 (AVX2), но и OSXSAVE (ECX bit 27) +
// _xgetbv(0) & 0x6 == 0x6 (ОС сохраняет YMM-регистры при context switch!).
const DispatchTable& init_and_get() noexcept;
const DispatchTable& get() noexcept;

} // namespace giga::simd
```

**Критический нюанс проверки CPUID (который ломает наивные реализации):**
Проверять только `CPUID(7, 0).EBX & (1 << 5)` **недостаточно**! На старых/виртуализированных ОС без поддержки XSAVE инструкция AVX2 вызывает `#UD` (SIGILL). Обязательная полная цепочка проверки на x86-64:
1. `CPUID(0)`: `maxLeaf >= 7`.
2. `CPUID(1)`: `ECX & (1<<20)` (SSE4.2), `ECX & (1<<23)` (POPCNT), `ECX & (1<<27)` (OSXSAVE), `ECX & (1<<28)` (AVX), `ECX & (1<<12)` (FMA).
3. Если OSXSAVE == 1: вызвать `_xgetbv(0)` (MSVC `<immintrin.h>` / Clang `xgetbv` inline asm) и проверить `(xcr0 & 0x6) == 0x6` (XMM + YMM state enabled by OS).
4. `CPUID(7, 0)`: `EBX & (1<<5)` (AVX2) и `EBX & (1<<8)` (BMI2).
5. Аварийный override через env `GIGA_FORCE_ISA=scalar|sse42|avx2` — для автоматического ctest-гейта **битовой идентичности** всех SIMD-ядер против скалярного эталона!

---

### 1.3. Единый персистентный пул потоков `JobSystem` (замена ad-hoc `std::thread` и закрытие Track C4)

#### Диагноз реального кода
На `HEAD 15d3da9` выявлены **три** независимых места, где на каждый батч создаются и уничтожаются свежие системные потоки ОС (`std::thread`):
1. `src/core/jobs.h:45-56` (`parallel_for`): на КАЖДЫЙ вызов (`clearance.build`, `floor_awaken`, `bake_light_visibility`, `bake_zone_nav`) создаёт `std::vector<std::thread> pool`, спавнит `hw` потоков и делает `join()`.
2. `src/render/voxel_mirror.cpp:422-442` (`upload_wholesale_`): вручную создаёт ещё один локальный `std::vector<std::thread> pool` (`max(2, hw/2)` потоков) на каждый вход на этаж!
3. `src/game/rebake.cpp:94,294,379,428`: создаёт новый `std::thread worker_` на каждый цикл `Fresh`/`Rebake`/`LightPatch`/`Prebuild`, который внутри снова вызывает `parallel_for` (nested thread oversubscription!).
4. **Track C4 (медленный выход):** `RebakeScheduler::start_prebuild` (`rebake.h:195-198`, `rebake.cpp:365-383`) передаёт `std::function<void()> job`, который не принимает `const std::atomic<bool>* cancel`. Деструктор `~RebakeScheduler()` (`rebake.cpp:29-32`) ставит `cancel_ = true` и висит на `worker_.join()` до 6.4 с, пока `floor_file_read` / `generate_floor` доделают ненужную работу.

#### Целевая архитектура `giga::JobSystem` (`src/core/jobs.h` + `src/core/jobs.cpp`)

Требования: zero-exceptions, zero-RTTI, zero per-dispatch heap allocations, 64B cache-line padding против false sharing, поддержка приоритетных очередей (Foreground Bake vs Background IO/Rebake) и кооперативной отмены `CancelToken`.

```cpp
// src/core/jobs.h — единый персистентный пул ядра (заменяет per-call std::thread)
#pragma once
#include <atomic>
#include <cstdint>

namespace giga {

struct CancelToken {
    const std::atomic<bool>* flag = nullptr;
    bool cancelled() const noexcept {
        return flag && flag->load(std::memory_order_relaxed);
    }
};

enum class JobPriority : std::uint8_t {
    High = 0, // Главный поток ждёт (upload classify, sync clearance, audio/frame prep)
    Normal = 1, // Fresh-бейк за створками лифта, Prebuild
    Background = 2, // Фоновый Rebake (ограничен max(2, hw/2)), асинхронный save-кодек
};

// Выровненный на 64 байта слот воркера — исключает false sharing счётчиков между ядрами.
struct alignas(64) WorkerCounters {
    std::atomic<std::uint64_t> jobsExecuted{0};
    std::atomic<std::uint64_t> steals{0};
};

class JobSystem {
public:
    static JobSystem& global() noexcept; // Инициализируется один раз в main(), shutdown() до выхода

    void init(int workerCount = 0) noexcept; // default: max(1, hardware_concurrency() - 1)
    void shutdown() noexcept;                // ставит globalStop_, будит CV, джойнит все потоки
    int worker_count() const noexcept;

    // Детерминированный parallel_for поверх существующих воркеров (ноль std::thread spawn!).
    // Разбивает [0, n) на детерминированные чанки, поддерживает cooperative cancel и
    // ограничение concurrency (`maxThreads` для Background-бейков, чтобы не душить 125 Гц тик).
    // Главный/вызывающий поток тоже участвует в работе (work-helping) — защита от дедлока
    // при вложенных вызовах (Rebake worker -> parallel_for).
    template <class F>
    void parallel_for(int n, F&& body, int maxThreads = 0,
                      CancelToken cancel = {},
                      JobPriority prio = JobPriority::Normal) noexcept;
};

} // namespace giga
```

**Ключевые инженерные гарантии `JobSystem`:**
1. **Защита от nested deadlock (Work-Helping):** Когда фоновый поток `RebakeScheduler` вызывает `parallel_for`, вызывающий поток сам разбирает чанки из общего `std::atomic<int> nextChunk` наравне с воркерами пула и никогда не блокируется в `condvar.wait` на задаче, для которой нет свободных воркеров.
2. **Ограничение полосы фона (`maxThreads = max(2, hw/2)`):** Фоновый `Rebake` и фоновая запись этажей (`write_floor_file_async`) используют не более половины ядер и низкий приоритет (`THREAD_PRIORITY_BELOW_NORMAL` на Windows / `QOS_CLASS_UTILITY` на macOS), оставляя минимум половину физических ядер свободными для главного 125 Гц сим-потока, Vulkan-драйвера и аудио-колбэка SDL3.
3. **Закрытие Track C4 (отмена Prebuild/Exit за < 15 мс):**
   - Изменить сигнатуру `start_prebuild` на `std::function<void(CancelToken)> job`.
   - Протащить `CancelToken cancel = {}` в:
     * `floor_file_read(..., CancelToken)` — опрос `cancel.cancelled()` каждые 4096 записей/блоков и перед CRC/декомпрессией;
     * `generate_floor(..., CancelToken)` / `generate_padic_floor` / `generate_khrushi_floor` / `generate_blame_floor` — опрос на каждой фазе генерации и каждые 8 Z-срезов;
     * `bake_zone_nav(..., CancelToken)` — опрос каждые 64 зоны (сейчас `bake_zone_nav` в `rebake.cpp:356,467` вообще не принимает `cancel_`!).
     * Фоновый писатель сейва `write_floor_file_async` — при выходе из игры (`app_exit`) **НЕ отменяется** (иначе потеряется сейв этажа!), но после ускорения delta-кодека + Zstd (Раздел 3) дописывается за **< 30 мс** вместо 2.7 с.

---

*(Разделы 1.4, 2, 3, 4, 5 и 6 дописываются итеративно после полного чтения `save.cpp`, `light_vis_bake.cpp`, `gpu_medium_pass.cpp`, `rigid.cpp`, `main.cpp` и UI-модулей.)*
