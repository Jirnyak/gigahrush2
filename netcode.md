# Netcode — server-authoritative from day one

> **Fundamental architecture directive (owner, 2026-07-29).** Multiplayer is laid
> in at the **engine level now**, so we never refactor the game onto it later.
> Every session is **client → server**, exactly like Source / Unreal: single-player
> is a **listen server** — the player's client connects to a server running in the
> same process over an in-memory loopback. A dedicated server is the same server
> with no client attached; a remote client is the same client with a network
> connection instead of the loopback. One code path, three deployments.

This doc is the **seam contract**. It is deliberately mostly *design + rules*: the
point is that gigahrush2's layering was already a hair's breadth from
server-authoritative, so the job is to name the boundary and forbid the couplings
that would make it expensive to network later — not to bolt on a netcode stack.
Real wire serialization, prediction, and lag compensation are **future work behind
a single interface** (`Connection`); nothing above that interface changes when they
land.

## Why this is almost free here

The [architecture](ARCHITECTURE.md) already enforces the two rules that normally
cost a studio a year to retrofit:

- **`giga_core` + `giga_game` are headless and authoritative.** They link no SDL,
  Vulkan, or ImGui; the whole simulation — grid, physics, floor streaming, nav
  bakes, macro society, AI, combat — runs and is unit-tested with **no GPU**
  (`game_test`). That is a **dedicated server** in all but name.
- **Data flows sim → render only.** The renderer mutates no game state and never
  answers a gameplay question from the framebuffer ([AGENTS.md](AGENTS.md)); input
  writes *intent* onto components, it doesn't reach into systems. The client is
  already a read-only shell over the sim.

So the seam is not a new subsystem grafted on — it is a **name** for a line the
code already almost respects, plus a small amount of glue (a command channel and a
connection handle) and one new discipline: **the client proposes, the server
disposes.**

## The three roles

```
             PlayerCommand (up)                 world snapshot (down)
  ┌────────┐ ───────────────► ┌────────────┐ ───────────────► ┌────────┐
  │ input  │                  │ Connection │                  │ render │
  │ + HUD  │ ◄─────────────── │  (seam)    │ ◄─────────────── │        │
  └────────┘                  └────────────┘                  └────────┘
     CLIENT  (src/app, render/, input/)   │        SERVER (giga_core + giga_game)
     owns camera, prediction, drawing      │        owns ALL authoritative state
```

- **Server** — the authoritative simulation host. Owns the EnTT `Registry`, the
  `LevelStack` and its live `World`s, `FloorStreamer`, `MacroSim`, every `*_step`
  system, the nav bakes, combat, samosbor, save/load. Advances on the fixed
  **125 Hz** action tick (`kSimHz`, `src/core/tick.h` — the exact-8 ms step; plus
  the coarse macro clock). Accepts `PlayerCommand`s
  from each connected client and is the **only** writer of game state. Runs
  identically whether or not a renderer is attached — that is the whole point.
- **Client** — presentation and input only. Owns the Vulkan renderer, the SDL
  input bridge, the ImGui HUD, and the local camera. Holds one `Connection` to a
  server. Each frame: sample input → build a `PlayerCommand` → `send`; read the
  latest world view → draw it. Owns **no** authoritative state; it may own
  *predicted* copies (below), which are always corrected by the server.
- **Connection** — the transport seam between them. Two implementations:
  - **`LocalConnection`** (listen server / single-player): in-process, **zero
    serialization**. The client and server share the address space, so the client
    reads the server's `Registry` **directly** and `send(cmd)` hands the command
    struct straight to the server. This is how a Source listen server avoids
    paying for loopback — and it means single-player has *no* netcode overhead.
  - **`NetworkConnection`** (future): serializes `PlayerCommand`s up and world
    **snapshots** down over a socket. Everything above the `Connection` interface
    is unchanged; only this class knows a wire exists.

## The two messages

Everything that crosses the seam is one of two payloads. Keeping this set small
and POD is what keeps the wire format (when it comes) cheap and the local path a
plain struct copy.

- **`PlayerCommand`** — the client's intent for one tick (Source's *usercmd*). A
  POD: movement `wishDir` (camera-local), `yaw`/`pitch`, a button bitmask
  (jump / fly-toggle / use / attack / interact / elevator-up / elevator-down /
  save / load), and the client's tick number for ordering. The server applies it
  to **that client's** owned entity. The input layer stops writing components
  directly and instead fills a `PlayerCommand`; on a `LocalConnection` the server
  applies it the same frame, so the feel is identical to today.
- **World snapshot** — what the client needs to draw: the visible entities'
  `Transform` + `AABB` + `Renderable`, the active `World`'s grid surface, and
  **which entity this client's camera follows**. On a `LocalConnection` the
  "snapshot" is just a borrowed reference to the live server state (no copy). The
  `Connection` interface is shaped so a `NetworkConnection` can later replicate a
  delta-compressed subset here with client-side interpolation, **without touching
  a line of gameplay code**.

## Session & ownership

A **session** is a client's membership on a server. On connect, the server
**embodies** a record for that client and marks the client as its owner (the
existing `embody_as_player` — `CameraTag` + `Controller` — generalizes from "the
player" to "this session's avatar"). The engine already forbids a player
singleton ([the player is just an embodied record](npcs.md)), so N sessions each
owning an embodied entity needs **no** special case: `ai_step` already skips
`CameraTag` holders, so every owned avatar is simply excluded from NPC AI and
driven by its client's commands instead. Disconnect folds the record back
(`fold_back`) exactly like leaving a floor.

Multiple clients on **different floors** is the interesting case and it already
has an answer: floors are isolated `World`s in the `LevelStack`, and streaming
keeps the live set loaded. A multi-client server keeps every occupied floor live
(raise `FloorStreamer` keep-set from "exactly one" to "the union of occupied
floors") — a data change, not an architecture change.

## Deployment modes

| Mode | Server | Client | Connection | Command |
|------|--------|--------|-----------|---------|
| **Single-player** (default) | in-process | in-process | `LocalConnection` (loopback) | `gigahrush2` |
| **Dedicated server** | standalone, headless | none | listens for `NetworkConnection`s | `gigahrush2 --dedicated` |
| **Listen server (host)** | in-process | in-process | local **+** network for guests | `gigahrush2 --host` |
| **Remote client** | remote | in-process | `NetworkConnection` | `gigahrush2 --connect <addr>` |

The dedicated server falls out **for free** the moment the server owns its own
tick loop, because `giga_core`/`giga_game` already build without a GPU — `--dedicated`
is "construct the server, never construct the client."

## Rules that keep it refactor-free

These are the couplings that make networking a studio's nightmare. Forbid them
now and the `NetworkConnection` drop-in stays a drop-in. They extend the existing
sim→render rule to the input side.

1. **The client never mutates authoritative state.** No system writes a component
   that the sim reads, except *through* a `PlayerCommand` applied on the server.
   (Render/HUD/camera-local prediction state the server never reads is fine.)
2. **The server never depends on the client.** `giga_core`/`giga_game` gain **no**
   include of render/input/app — the same one-way stance the sim already has
   toward render, now also toward the session layer. The server must build and
   pass `game_test` with the client code deleted.
3. **All authoritative mutation is on the server tick**, fixed-step and
   deterministic (already true). A snapshot is a *read*; commands are the *only*
   write channel from outside.
4. **Ownership is per-connection, never global.** No "the player" — only "the
   entity this session owns." (Already the engine's stance; do not regress it.)
5. **Everything crossing the seam is POD and versioned.** `PlayerCommand` and the
   snapshot payload are flat structs so the future wire format is a memcpy, not a
   graph walk — the same dense-data discipline as the rest of the engine.

## What is deferred (and where it plugs in)

All of this lives **behind `Connection`**; none of it touches gameplay:

- **Serialization / wire format** — inside `NetworkConnection`. The save format
  (markololo's `save.{h,cpp}`) already proves the state is serializable; snapshot
  replication reuses that discipline.
- **Client-side prediction + reconciliation** — the client simulates its own
  avatar from its unacked `PlayerCommand`s and snaps to the server's correction.
  The `LocalConnection` needs none (server is authoritative *this* frame).
- **Entity interpolation + lag compensation** — client-side, network-only.
- **Snapshot delta compression / interest management** — which entities a given
  client is told about (its floor, its view). The floor-isolation model already
  gives a natural interest boundary.

## Code mapping (the increments)

Laid in additively, each building green (see [AGENTS.md](AGENTS.md) working
method). Exact file names are finalized against the merged tree, but the shape is:

1. **`PlayerCommand`** POD (a small `giga_game` header) + route the SDL input
   bridge through it. Additive: on `LocalConnection` it applies the same tick, so
   behaviour is unchanged. **✅ Built** — `src/game/player_command.{h,cpp}` is the
   client→server intent POD (button bitmask + camera-local `wishDir` + absolute
   `yaw`/`pitch` + `clientTick`, versioned, static_asserted trivially-copyable &
   standard-layout per rule #5). `apply_player_command` is the headless
   server-side writer: it clamps pitch (~±89°) — the client is never trusted with
   look range — flips fly on the toggle edge, and gates jump on walk mode. The SDL
   bridge (`src/input/input.{h,cpp}`) now *proposes* via `build_command` and the
   server *disposes* via `apply_player_command`; the input layer no longer writes
   `CameraTag`/`Controller`/`Jump` directly (rule #1). Proof it runs client-free:
   `tests/suite_playercmd.inl` exercises the whole apply path in `game_test` with
   no SDL. Behaviour is byte-identical to the old direct write.
2. **`GameServer`** (`giga_game`) — owns the authoritative `Registry` / `LevelStack`
   / `FloorStreamer` / `MacroSim` and a `tick(dt)` that runs the existing system
   order. Extracted from `main.cpp`; headless-constructible and **unit-testable
   with no client** (a big win: server logic gets `game_test` coverage).
3. **`Connection`** interface + **`LocalConnection`** (loopback) in `giga_game`.
4. **`GameClient`** (`src/app`) — owns render + input, holds a `Connection`;
   per-frame: gather input → command → `send`; read view → render.
5. **`main.cpp`** becomes mode dispatch (`--dedicated` / `--connect` / default
   listen) constructing server and/or client and the right `Connection`.

Until step 5 lands, the game runs exactly as it does today; the seam is being put
*under* the running game, not in front of it.
