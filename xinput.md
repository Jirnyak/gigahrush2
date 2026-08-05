# Gamepad / XInput Controls

> Текущий design / implementation reference для геймпада в ГИГАХРУЩЕ.
>
> Клавиатура и мышь остаются основным и приоритетным способом игры.
> Геймпад добавлен как параллельный вход для desktop-плеера с подключённым
> standard-mapped контроллером. Mobile touch overlay сохраняет текущее
> поведение и пока не превращён в виртуальный геймпад. Cloudflare Net Sphere
> и save shape геймпад не трогает.

## Implementation snapshot

| Layer | File | Status |
| --- | --- | --- |
| Universal intent (axes, held/pressed/released, menu nav, hardware, resolver) | [src/systems/input_intent.ts](src/systems/input_intent.ts) | shipped |
| Browser-local gamepad settings (deadzones, curves, invert, virtual pad toggle) | [src/systems/gamepad_settings.ts](src/systems/gamepad_settings.ts) | shipped |
| Physical gamepad adapter (Gamepad API, standard mapping, edge detection) | [src/input_gamepad.ts](src/input_gamepad.ts) | shipped |
| Game-loop integration (poll → resolve → movement/look read) | [src/main.ts](src/main.ts) | shipped |
| Touch DOM controls (existing mobile overlay) | [src/mobile.ts](src/mobile.ts) | unchanged |
| Title screen gamepad bridge | [src/main.ts](src/main.ts) | shipped (D-pad nav, A/Start accept, B back) |
| Net Sphere gamepad routing | — | not shipped |
| Gamepad UI / hints / remap screen | — | not shipped |
| Haptics | [src/input_gamepad.ts](src/input_gamepad.ts) | not shipped |
| Mobile virtual gamepad overlay | — | not shipped (existing touch overlay still used) |

## Stack and contract

- Zero new runtime dependencies. Pure browser `navigator.getGamepads()` +
  `gamepadconnected` / `gamepaddisconnected` events.
- Save shape untouched: `SAVE_SHAPE_VERSION` in
  [src/systems/save_runtime.ts](src/systems/save_runtime.ts) does not
  include any gamepad fields.
- Browser-local persistence only. Settings live under
  `gigahrush_gamepad_settings_v1` in `localStorage`, separate from
  `gigahrush_save` and `gigahrush_control_bindings_v7`.
- Keyboard/mouse paths in [src/input.ts](src/input.ts) and
  [src/systems/controls.ts](src/systems/controls.ts) are unchanged.
  Pointer lock, mouse look, ЛКМ/ПКМ semantics, menu accept/close latches
  and the remap screen behave exactly as before.
- Mobile DOM touch overlay still writes directly into `input.touch.*` and
  `input.mouseAttack`; gamepad axes are read alongside, not merged into,
  those fields.

```txt
Keyboard / Mouse DOM events ──┐
                              ├──► InputState (legacy fields,
Touch DOM overlay ────────────┤    unchanged write path)
                              │
Physical Gamepad polling ─────┴──► InputFrame (intent layer)
                                    │
                                    ├─ axes (gamepad-only, read directly)
                                    └─ actions / menu nav
                                              │
                                              ▼
                              resolveInputFrameToInputState
                                              │
                                              ▼
                                    InputState (booleans, edges)
                                              │
                                              ▼
                              movePlayer / handleMenuInput /
                              playerActions read both InputState
                              and InputFrame.axes
```

## Input intent layer

[src/systems/input_intent.ts](src/systems/input_intent.ts) defines:

- `InputDeviceKind = 'keyboard_mouse' | 'gamepad' | 'touch'`.
- `InputFrame`:
  - `axes: { moveX, moveY, lookX, lookY }` clamped to `[-1, 1]`.
  - `heldActions`, `pressedActions`, `releasedActions` as
    `Set<ControlActionId>`.
  - `menuNav: { up, down, left, right }` edges for one frame.
  - `activeDevice: InputDeviceKind`.
  - `hardware: { gamepadConnected, gamepadMappingStandard, gamepadLabel }`.
- Pure functions: `createInputFrame`, `beginInputFrame`, `mergeAxis`,
  `setActionHeld`, `pressAction`, `releaseAction`, `setMenuNav`,
  `setActiveDevice`.
- Math helpers: `applyStickDeadzone(x, y, deadzone, exponent)` and
  `applyTriggerCurve(value, held, edge)`.
- `resolveInputFrameToInputState(frame, input, ctx)`:
  - Per-frame held actions → mirror the action's bound `InputState`
    boolean.
  - Released actions → clear that boolean only when no longer held this
    frame (so simultaneous keyboard hold + gamepad release does not stomp
    the keyboard).
  - `interact` keeps existing edge semantics: one-frame `input.interact`,
    persistent `input.interactHeld`.
  - Menu nav edges set `invUp/Dn/Left/Right` for one frame so existing
    `handleMenuInput()` edge detection sees them.
  - `ctx.writeMenuEdgesFromActions = true` latches `menuAccept` from the
    `gameMenu` action edge and `menuClose` from the `menuClose` action
    edge, matching how mouse LMB/RMB feed the same fields in menu mode.

The intent layer does **not** touch the DOM, Gamepad API, save/load,
gameplay or render.

## Gamepad settings

[src/systems/gamepad_settings.ts](src/systems/gamepad_settings.ts) provides
browser-local configuration:

```ts
interface GamepadSettings {
  version: 1;
  enabled: boolean;
  profile: 'standard_xinput';
  invertLookY: boolean;
  moveDeadzone: number;     // default 0.18, clamp [0, 0.6]
  lookDeadzone: number;     // default 0.16, clamp [0, 0.6]
  triggerThreshold: number; // default 0.35, clamp [0.05, 0.95]
  moveCurve: number;        // default 1.15, clamp [0.5, 4]
  lookCurve: number;        // default 1.65, clamp [0.5, 4]
  lookSensitivity: number;  // default 1.0,  clamp [0.1, 4]
  haptics: boolean;
  virtualGamepad: {
    enabled: boolean;
    layout: 'compact' | 'full';
    opacity: number;
  };
}
```

Storage key: `gigahrush_gamepad_settings_v1`.

Sanitization rules (`sanitizeGamepadSettings`):

- Unknown `version` → defaults.
- Unknown enum (`profile`, `layout`) → default value.
- Non-finite numbers → default value.
- Finite numbers → clamped to range.
- Non-boolean flags → default value.
- Blocked `localStorage` → in-memory cache returns defaults.

Public API: `loadGamepadSettings`, `saveGamepadSettings`,
`updateGamepadSettings(patch)`, `resetGamepadSettings`. No save shape
bump. No migration scaffolding.

## Physical gamepad adapter

[src/input_gamepad.ts](src/input_gamepad.ts) implements
`createGamepadAdapter()`. Each tick `adapter.poll(frame)` is called from
`gameLoop` after `frameDt` is computed and before `wantSleep`,
`handleMenuInput()`, movement and actions, so menus, sleep latch and
movement all see the same input frame.

Behaviour:

- `gamepadconnected` / `gamepaddisconnected` listeners on `window` pick
  the active pad; `navigator.getGamepads()` is wrapped in `try/catch`
  and treats nulls gracefully.
- Only `gamepad.mapping === 'standard'` is read. Non-standard pads are
  reported in `frame.hardware` but produce no axes or buttons (the
  player must use keyboard/mouse or wait for the remap UI).
- On disconnect, the adapter emits `releaseAction` for any button that
  was held last tick, so `input.attack`, `input.useTool`, `input.sprint`
  etc. clear and `interactHeld` falls.
- `frame.hardware.gamepadConnected` /
  `frame.hardware.gamepadMappingStandard` / `frame.hardware.gamepadLabel`
  reflect the current pad; the label is the truncated `Gamepad.id`.
- `setActiveDevice(frame, 'gamepad')` is called whenever a stick or
  button produced input this tick.

### Default standard mapping

| Button / axis | Adapter intent | Resolves to |
| --- | --- | --- |
| axes[0/1] (Left stick) | `moveX`, `moveY` (Y negated; positive = forward) | `frame.axes.moveX/moveY` |
| axes[2/3] (Right stick) | `lookX`, `lookY` (Y optionally inverted, scaled by `lookSensitivity`) | `frame.axes.lookX/lookY` |
| Button 0 (A) | press → `interact` edge | `input.interact`, `input.interactHeld` |
| Button 1 (B) | press → `menuClose` edge | `input.controlClose`, `menuClose` latch |
| Button 2 (X) | hold → `useTool` | `input.use` |
| Button 3 (Y) | press → `inventory` edge | `input.inv` |
| Button 4 (LB) | press → `log` edge | `input.logMenu` |
| Button 5 (RB) | press → `factions` edge | `input.factionMenu` |
| Button 6 (LT, analog) | hold via trigger curve → `useTool` | `input.use` |
| Button 7 (RT, analog) | hold via trigger curve → `attack` | `input.attack` |
| Button 8 (Back / View) | press → `map` edge | `input.map` |
| Button 9 (Start / Menu) | press → `gameMenu` edge | `input.escape`, `menuAccept` latch |
| Button 10 (L3) | hold → `sprint` | `input.sprint` |
| Button 11 (R3) | reserved, no-op |  |
| Buttons 12–15 (D-pad) | press → menu nav edge **and** held → `menuUp/Dn/Left/Right` action | `input.invUp/Dn/Left/Right` |
| Button 16 (Guide) | unused |  |

Menu accept on A is intentionally **not** wired in the v1 adapter — menus
accept from Start/Menu plus existing keyboard/mouse paths. This avoids
the cross-context risk of A acting as both `interact` and `gameMenu` in
the same frame.

### Deadzones and curves

Radial deadzone applied to both sticks:

```ts
const len = Math.hypot(x, y);
if (len <= deadzone) return { x: 0, y: 0 };
const t = Math.min(1, (len - deadzone) / (1 - deadzone));
const scaled = Math.pow(t, exponent) / len;
return { x: x * scaled, y: y * scaled };
```

Triggers use a dual-threshold curve via
`applyTriggerCurve(value, held, edge)` returning `{ held, pressed,
analog }`. The adapter currently uses `held` for LT/RT and ignores
`analog`; `pressed` is reserved for future trigger-only edge actions.

Defaults: `moveDeadzone 0.18`, `lookDeadzone 0.16`,
`triggerThreshold 0.35` (held) with an internal `+0.2` edge cap (so
`pressed` fires near 0.55), `moveCurve 1.15`, `lookCurve 1.65`,
`lookSensitivity 1.0`, `invertLookY` off. All values pass through
`sanitizeGamepadSettings` on every load and save.

## Game-loop integration

In [src/main.ts](src/main.ts) the adapter and frame are created once
near input setup:

```ts
const gamepadAdapter = createGamepadAdapter();
const inputFrame    = createInputFrame();
```

Inside `gameLoop`, after `frameDt` is computed and before `wantSleep`
and `handleMenuInput()`:

```ts
beginInputFrame(inputFrame);
gamepadAdapter.poll(inputFrame);
resolveInputFrameToInputState(inputFrame, input, {
  writeMenuEdgesFromActions: true,
});
```

`movePlayer` reads gamepad axes alongside the existing keyboard booleans
and `input.touch.*`:

- Yaw: `input.touch.lookX * 3.0 * touchLookSensitivity * dt` **plus**
  `inputFrame.axes.lookX * 3.0 * padLookSensitivity * dt`.
- Pitch: same shape with `lookY` and `PLAYER_PITCH_LIMIT` clamp.
- Forward/strafe:
  `(fwd?1:0) - (back?1:0) + input.touch.moveY + inputFrame.axes.moveY`
  and the strafe equivalent, then clamped to `[-1, 1]`.

Both sensitivities reuse `mobileLookSensitivity()` from
[src/systems/ui_orchestrator.ts](src/systems/ui_orchestrator.ts). Mouse
look still requires pointer lock and continues to write to
`input.mouse.dx/dy` through the existing path.

## Behaviour matrix

| Situation | Input that wins | Notes |
| --- | --- | --- |
| Keyboard pressed | keyboard sets `InputState` boolean | gamepad release does not clear it (resolver checks `frame.heldActions`) |
| Gamepad LT/RT held | adapter writes `useTool` / `attack` held | gameplay reads the same `input.use` / `input.attack` |
| Both keyboard and gamepad hold the same action | boolean stays true until both release | release order is order-independent |
| Pad disconnected mid-hold | adapter emits releases on next poll | `attack`, `useTool`, `sprint` clear; `interactHeld` falls |
| Non-standard pad connected | adapter sets `hardware.gamepadConnected = true`, `gamepadMappingStandard = false` | no axes or buttons translated; player keeps keyboard/mouse |
| `localStorage` blocked | in-memory defaults via cache | settings still apply for the session |
| Page blur / visibility hide | existing `bindInput` blur path clears keyboard/mouse + touch; gamepad clears next poll if the OS drops button state | menu/text inputs reset as before |
| Pointer lock lost | existing path clears mouse + keyboard | gamepad continues; this is intentional so a controller player can browse menus without pointer lock |

## Active input mode and pointer lock

Current behaviour:

- Keyboard/mouse mode keeps the existing pointer-capture gate
  (`pointerCaptureGateVisible()` in `main.ts`).
- Mobile mode keeps the no-pointer-lock path.
- Physical gamepad input updates `frame.activeDevice = 'gamepad'` but
  does **not** yet bypass the desktop pointer-capture gate. A
  gamepad-only desktop player will still see the gate prompt until they
  click once or switch to mobile mode.

Promoting `activeDevice = 'gamepad'` into a pointer-capture override is
a follow-up: it requires deciding when to revert to keyboard/mouse mode
on real mouse motion and how the gate prompt should describe the
alternative. The intent layer already exposes the data; the gate logic
is the missing piece.

## Tests

- [tests/input-intent.test.ts](tests/input-intent.test.ts): radial
  deadzone math, trigger curve dual thresholds, axis merge clamping,
  `beginInputFrame` reset, held → boolean mirroring, release without
  re-hold clears the boolean, `interact` edge semantics, menu
  accept/close gating by `writeMenuEdgesFromActions`, menu nav routing.
- [tests/gamepad-settings.test.ts](tests/gamepad-settings.test.ts):
  default safety, unknown version → defaults, enum rejection, numeric
  clamping and non-finite rejection, save/load round-trip, `update`
  patch preserving nested defaults.
- Existing controls and pointer-lock tests
  ([tests/controls.test.ts](tests/controls.test.ts),
  [tests/input-pointer-lock.test.ts](tests/input-pointer-lock.test.ts),
  [tests/pointer-lock-release.test.ts](tests/pointer-lock-release.test.ts))
  continue to pass unmodified.

Validation: `npm run check:readonly` (typecheck + unit tests + content
audit). `npm run check:browser` is recommended for render/UI/mobile
follow-ups but is not required for the shipped scope, which only adds
input plumbing.

## Not shipped (next steps)

Tracked here so future passes do not duplicate work:

1. **Pointer-lock override for gamepad mode.** Bypass the desktop
   capture gate after a real pad input; revert to keyboard/mouse mode
   on the first mouse/keyboard movement event.
2. **Controls / settings UI for gamepad.** Three-view controls screen
   (`keys` / `gamepad` / `buttons`), inline status of the active pad,
   deadzone / invert / sensitivity tuning,
   `controlHintForActiveDevice()` helper for HUD hints.
3. **Net Sphere gamepad routing.** A select / B back / X erase / D-pad
   scroll, all gated by chat input focus state.
4. **Mobile virtual gamepad overlay.** Replace the current rail mental
   model with sticks + ABXY + RT cluster while keeping the existing
   `FULL/PAGE` fullscreen behaviour, safe-area integration and compact
   rail for rare actions.
5. **Haptics.** Optional `playGamepadHaptic(kind)` with capability
   detection, short pulses on hit and death, gated by `settings.haptics`.
6. **Browser smoke hook.** Synthetic `navigator.getGamepads()` injection
   behind a test flag so `scripts/smoke-playability.mjs` can assert
   gamepad start/move without a physical pad.

## Recent fixes

- **D-pad release semantics.** `BUTTON_HOLD_ACTIONS` in
  [src/input_gamepad.ts](src/input_gamepad.ts) now includes
  `menuUp/menuDown/menuLeft/menuRight`. The existing one-frame
  `setMenuNav` edge still fires for title-screen consumers, but the
  resolver also sees `heldActions` and the matching `releasedActions`,
  so `input.invDn` (etc.) is cleared the moment the D-pad goes back to
  rest. Without this, a single D-pad nudge would leave `input.invDn`
  stuck `true` and `menuRepeatStep` would auto-scroll menus forever.
- **Title screen gamepad bridge.** `gameLoop` now polls the gamepad
  before the `!started` early-return and calls
  `handleTitleGamepadInput(frame)`, which mirrors `startHandler`
  semantics from D-pad / A / B / Start. The title branch also schedules
  `requestAnimationFrame(gameLoop)` so polling keeps running while the
  player is on the title.
- **Mobile fullscreen on iOS.** `canUseMobileFullscreen()` in
  [src/fullscreen.ts](src/fullscreen.ts) no longer hides the button on
  iPad (which actually supports
  `documentElement.requestFullscreen`). On iPhone, the button stays
  visible and `enterMobileFullscreen()` falls back to a soft
  `window.scrollTo(0, 1)` URL-bar shrink trick when `requestFullscreen`
  is unavailable.

## Anti-patterns to keep rejecting

- Adding `gamepad*` fields to `InputState` ahead of the intent layer's
  proven shape.
- Mixing physical gamepad codes into `gigahrush_control_bindings_v7`
  before the UI handles non-key codes cleanly.
- Persisting gamepad preferences in `gigahrush_save` or bumping
  `SAVE_SHAPE_VERSION` for them.
- Mapping one gamepad button to both `interact` and `gameMenu`.
- Writing gamepad axes directly into `input.touch.moveX/Y/lookX/Y` (the
  touch DOM adapter sets those fields by assignment; additive
  contribution with subtraction tracking was tried and rejected as
  brittle).
- Implementing menu accept / back as fake mouse buttons.
- Bypassing pointer-capture gate or pointer-lock release rules for
  keyboard/mouse mode.

## Platform notes

- The `Gamepad` API is widely available but with per-browser /
  per-OS quirks. Treat `mapping === 'standard'` as the only reliable
  cross-browser layout. Non-standard pads currently degrade to "no
  controller input".
- Some browsers expose already-connected pads only after the first
  button press or stick motion. The adapter's polling loop handles
  this naturally.
- `navigator.getGamepads()` can contain null entries and may be
  blocked by iframe Permissions Policy. The safe wrapper returns `[]`
  in both cases.
- `vibrationActuator` / haptics is limited-availability and
  intentionally not shipped in v1.

References:

- https://developer.mozilla.org/en-US/docs/Web/API/Gamepad
- https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API
- https://www.w3.org/TR/gamepad/
