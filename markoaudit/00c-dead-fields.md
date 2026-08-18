# 00c — Мёртвые поля структур (независимая перекрёстная проверка)

Скан: 1011 полей из `struct`/`class` в `src/{game,world,sim,ecs}/**.h`; для каждого
посчитаны обращения вида `.field` / `->field` по коду с вырезанными комментариями.

**Оговорка о методе, важная для доверия к цифрам.** Приватные члены (с подчёркиванием в
конце) внутри своих же методов пишутся без `this->`, поэтому скан считает их
неиспользуемыми — это ложные срабатывания, и все 114 таких строк из результата исключены.
Ниже только публичные POD-поля, где обращение через точку — единственная возможная форма.
Сырой результат со всей мусорной частью лежит в `/tmp/markoaudit/deadfields.txt`.

## Публичные поля с нулём обращений в `src/` — 41

Ценность этого списка не в его длине, а в том, что он получен **механически и независимо**
от чтения кода агентами. Совпадения — не эхо: это три разных метода, сошедшихся на одном.

| Поле | Подтверждено независимо |
|---|---|
| `MobDef::navClimbSub`, `navDropSub`, `navFly`, `navStepSub` | Аудит AI: «все 68 строк `mobs.csv` несут одинаковую нечитаемую навигационную четвёрку (1, 8, 16, 0)» |
| `MeleeDef::knockbackMm`, `hitRadiusMm` | Аудит боя: «`apply_damage:382` вместо этого выдумывает плоские `2.5f` — кувалда и нож отбрасывают одинаково» |
| `BankTerms::cashCap`, `questCap`, `questRate`, `lootCap` | Аудит предметов: «нулевые потребители в `src/`, при этом `contract.cpp:23-32` жёстко зашивает `1.6f / 3 / 900 / 20 / 30` ровно для этой задачи» |
| `Perception::minuteOfDay`, `factionAssaultTarget`, `gunfire`, `inShelter`, `isTraveler`, `orderedCombat`, `samosborWarning`, `strongerHostile` | Аудит AI: «17 из 30 полей `Perception` не имеют ни одного писателя, из-за чего `IntentFactionAssault` невыбираем» |
| `SamosborPressure::fogRadiusCells`, `fogStrength` | Аудит боя: «давление варианта не делает ничего — `samosbor.cpp:543` открывается с `(void)variant;`» |
| `GravityField::region` | Аудит sim: «`region`/`RegionFn` не присваивается нигде → `Custom` недостижим → 8 веток `Custom` мертвы» |
| `FloorStreamer::navBake_`, `keepRadius`, `landHub`, `kPopSeedSalt` | Аудит sim: «`navBake_ = false` (`floor_stream.h:324`), `set_nav_bake` не вызывается в `src/`» |
| `PlayerCommand::clientTick`, `kVersion` | Согласуется с мёртвыми `ElevatorUp`/`ElevatorDown` из скана перечислений — шов netcode построен и не подключён |
| `PropDef::pad0_`, `pad1_`, `SubMask::zMask`, `NoiseField::noiseField`, `MemoryTrace::kMemPayloadMask`, `AiMemory::kBlankMemoryRow`, `EventFeed::kLines`, `kLineLen`, `EventBus::kCapacity` | — |

## Поля ровно с одним обращением — 124

Одно обращение означает: поле либо только пишут, либо только читают. Оно не участвует в
обмене, а значит не влияет ни на что (если пишут) или содержит мусор (если читают).
Выборка из наиболее показательных:

`Corpse::deathTick`, `PropDef::colorRE3/colorGE3/colorBE3`, `PropDef::fallMode`,
`PropDef::interactKind`, `PropDef::sizeXMm`, `PropLight::coneDeg`,
`StatusDef::aimMultE3/altAimMultE3/altMoveMultE3/healMultE3/meleeMultE3/waterDrainE3/stacks/gateItem`
(совпадает с находкой аудита боя: «`heal_mult_e3`, `water_drain_e3`, `stacks`/`intensityE3`
— читателей нет, при этом `intensityE3` пишется в сейв»), `NeedsTick::secondsToDamage`,
`FluidStep::wetCells` (совпадает: солвер жидкости не вызывается), `MacroParams::fertileLo`,
`fertileHi`, `AiConfig::rethinkBaseSec`, `rethinkSpreadSec`, `LootEntry::maxCount`,
`CraftSource::consume`, `ParticleDef::bounce`, `drag`, `colorFromMaterial`,
`Projectile::gravityPct`, `DoorTick::lastKind`, `CarveOp::detachLimit`.

## Что это добавляет к отчёту

Механический скан не умнее агента, читавшего файл, — но он не может ошибиться в пользу
приятного ответа. Три независимых захода (мёртвые функции, мёртвые значения перечислений,
мёртвые поля) сошлись на одном и том же наборе модулей: `needs`, `monster_traits`, `rpg`
(колонка INT), `event_bus`, `nav`/`nav_cache`, `samosbor` (половина со спавном),
`macro_sim` (граф связей), `economy` (наблюдаемость банка), `PlayerCommand` (шов netcode).

Это и есть искомая карта: **не отдельные забытые строки, а системы, построенные целиком и
не подключённые ни к чему, кроме собственных тестов.**
