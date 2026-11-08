# Events — the gameplay event bus

> **Status: built.** Game layer (`src/game`, the `giga_game` library).
>
> - **Code:** [src/game/event_bus.h](src/game/event_bus.h) /
>   [.cpp](src/game/event_bus.cpp)
> - **Tests:** [tests/game_test.cpp](tests/game_test.cpp)

The one channel gameplay systems use to tell each other that *something
happened* — an NPC died, an item changed hands, a floor was entered — without
any system holding a pointer to any other. Producers publish; consumers drain.
This keeps the macro sim ([macrosim.md](macrosim.md)), NPC pool
([npcs.md](npcs.md)), and the action game decoupled: they meet only at the bus.

## Transient by default

Events are **transient**. Each is published into a **fixed-capacity ring** and
lives exactly one drain cycle:

```
producers ── publish() ──► ring (this cycle's batch)
consumers ── events()  ──► read the whole batch
              clear()   ──► wipe, ready for next cycle
```

Nothing accumulates and there is **no allocation in the hot path** — the ring is
sized once at `init()` and reused every tick. This matches the engine's
dense-flat-tables stance ([performance.md](performance.md)): the bus is one flat
POD array, not a graph of subscriber objects.

## Fixed POD events

Every event is the same small POD (`Event`, 24 B): a `type` tag
(`EventType`) plus three generic `a/b/c` payload slots and a producer-stamped
`tick`. The meaning of the slots depends on the type and is documented at the
call sites (e.g. `ItemTransferred` = `a` from, `b` to, `c` item id). No
inheritance, no per-event heap — the ring serializes verbatim.

## Bounded means bounded

If more than `kCapacity` (4096) events are published in one cycle, the surplus
is **dropped and counted** (`dropped()`), never grown. A bounded ring must stay
bounded; the drop counter surfaces a tuning problem instead of hiding it behind
a silent reallocation.

## Что шина НЕ делает: помнить (летопись, CANON S21)

Transient — это закон, а не ограничение, и у него есть цена: у ядра **есть
деяние** (`EventType::Deed`), **есть его цена** по `verbs.csv` и **есть
свидетель** (`witness_step`) — и **нет памяти**. Поэтому всякая надстройка,
которой нужно было помнить прошлое, заводила свой счётчик: у квеста прогресс с
капом в сейве, у контракта книга. Обе снесены 2026-11-08 вместе с багом
«инвентарь пустеет», который из такого счётчика и вырос.

Память мира — **вторая половина того же шва**, а не второй канал:

| | шина (`event_bus.h`) | летопись ([src/game/chronicle.h](src/game/chronicle.h)) |
|---|---|---|
| вопрос | «это случилось СЕЙЧАС» | «это случилось» |
| жизнь | один цикл дренажа | окно рода (такт × разрядность цены, S15) |
| кто пишет | любой производитель | ТОЛЬКО `witness_step` — увиденное |
| запись | `Event` 24 Б | `Fact` 32 Б, без строки текста |
| в сейве | нет | да, `run.sav` v27 (связи не едут, пересобираются) |

Три запроса и только три: `chronicle_near` (рядом), `chronicle_recent`
(недавно), `chronicle_near_kind` (рядом этого рода). Слова выводит
`fact_line` в момент показа — журнал есть ВИД на память, а не её второй
носитель (прежний `EventFeed`, хранивший отрендеренные строки, снесён
2026-09-30 за отсутствием потребителя). Тесты —
[tests/suite_chronicle.inl](tests/suite_chronicle.inl).

## Optional replay log

Debug and replay want the history the transient ring throws away, so the bus can
mirror every published event into an **append-only log**. It is **off by
default** (zero cost); when `set_logging(true)`, the log is the only thing that
grows and it survives `clear()`. `clear_log()` empties it.

## Connections

Drained by whatever orchestrates a tick (the macro sim and, later, the app
loop, immediately before `bus.clear()`; the macro sim neither publishes nor
drains). Producers are combat (`NpcDied`), inventory transfers
([items.md](items.md)) from `loot.cpp`/`needs.cpp`, prop detachment and
`relations_drain_deaths`. **Three types have no live producer:** `NpcSpawned`,
`NpcMigrated` and `FloorEntered` all go through `publish_floor_arrival`, which
is called only from the test suite. Historically listed: the NPC pool
([npcs.md](npcs.md)),
inventory transfers ([items.md](items.md)), the mob table
([monsters.md](monsters.md)), and macro migration ([macrosim.md](macrosim.md)).
