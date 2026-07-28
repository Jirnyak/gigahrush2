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

## Optional replay log

Debug and replay want the history the transient ring throws away, so the bus can
mirror every published event into an **append-only log**. It is **off by
default** (zero cost); when `set_logging(true)`, the log is the only thing that
grows and it survives `clear()`. `clear_log()` empties it.

## Connections

Drained by whatever orchestrates a tick (the macro sim and, later, the app
loop). Producers are the gameplay systems: the NPC pool ([npcs.md](npcs.md)),
inventory transfers ([items.md](items.md)), the mob table
([monsters.md](monsters.md)), and macro migration ([macrosim.md](macrosim.md)).
