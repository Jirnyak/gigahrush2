# Pikabu Games / GamePush Pre-Submit QA Gate - 2026-05-27

Purpose: concrete gate before any `https://games.pikabu.ru/add-own-game/form` submission. This is specific to the current GIGAH|RUSH repo and must be passed in a real browser before the final GamePush/Pikabu moderation click.

Official constraints rechecked on 2026-05-27:

- Pikabu Games requires GamePush SDK integration before publication.
- Cloud saves are mandatory.
- Moderation can take up to 7 working days.
- Rejection reasons include launch instability, critical console errors, broken display on declared devices, missing root `index.html`, critical gameplay bugs, unfinished placeholders, missing legal/payment ability, 18+ content, casino-like mechanics, roulette/slots/poker analogues, and third-party links except technical support.

## Current Engineering State

Done in source:

- `src/systems/platform_bridge.ts`
  - recognizes `?portal=yandex`, `?portal=gamepush`, `?portal=pikabu`;
  - can load GamePush SDK when `gpProjectId` and `gpPublicToken` are supplied in query params or matching meta tags;
  - binds platform pause/resume into local pause/audio state;
  - sends ready/gameplay start/stop hooks without adding runtime dependencies;
  - writes current-shape records to GamePush `player.progress`, prefers a compact current-shape portal profile once the raw payload grows past `64 KiB`, and keeps the hard GamePush guard at `900 KiB`;
  - hydrates a current-shape cloud save back into `localStorage` when it is newer/missing locally;
  - keeps Yandex stricter save budget at `190 KiB`.
- `src/systems/save_payload.ts`
  - exports a compact portal save profile that preserves current save shape while trimming heavy floor memory, oversized quest/event/history lists and generated route caches for the GamePush cloud-save budget.
- `scripts/build-pikabu.mjs` / `npm run pikabu:build`
  - emits `pikabu/index.html`, `pikabu/gigahrush-pikabu.zip` and private upload notes;
  - injects strict Pikabu portal metadata into the copied artifact only, and injects GamePush public credentials only from local environment variables if the owner supplies them.
- `src/systems/audio.ts`
  - page-hidden pause and platform pause are separate suspend reasons.
- `src/systems/interactions.ts`
  - strict portal mode does not place, target or open generated roulette/slots machines.
- `src/systems/npc_interaction_options.ts`
  - strict portal mode hides durak, dice and Floor 69 entertainment menu options.
- `src/systems/procedural_floors.ts`
  - strict portal mode blocks authored `floor_69` and uses a procedural route entry at that `z` instead.
- `src/systems/net_sphere.ts`
  - strict portal mode keeps optional Net Sphere closed and avoids `/api/net` traffic.

Current local verification on 2026-05-27:

- `npm run check` passed: typecheck, 1339 unit tests, content audit and production build.
- `npm run pikabu:build` passed without GamePush credentials and emitted `pikabu/gigahrush-pikabu.zip` (`5 196 710` bytes) with root `index.html`; credentials embedded: no.

Not done:

- No GamePush project id/public token is committed.
- No Pikabu Games submission was sent.
- No legal/payment agreement was accepted.
- Local no-credential `npm run pikabu:build` passed and produced `pikabu/gigahrush-pikabu.zip` with root `index.html`; no dedicated uploaded artifact was tested inside GamePush/Pikabu iframe yet.

## Required Commands

Run from `/Users/jirnyak/Mirror/gigahrush`:

```bash
npm run typecheck
npm run test:unit
npm run content:audit
npm run build
npm run smoke
npm run check
npm run check:browser
```

Minimum pass for a submission candidate:

- `npm run check` passes after the final source/content state.
- `npm run check:browser` passes with Chrome available.
- If making the upload ZIP from the current single-file build, run:

```bash
npm run pikabu:build
```

Do not upload stale `itch/gigahrush-itch.zip` to Pikabu/GamePush. Use the generated `pikabu/gigahrush-pikabu.zip` and verify it in the GamePush/Pikabu iframe before final submit.

Before upload, verify the local artifact:

```bash
unzip -l pikabu/gigahrush-pikabu.zip | sed -n '1,20p'
rg -n '<meta name="gigahrush-portal" content="pikabu">' pikabu/index.html
```

## Browser QA

Use a normal browser session, then a clean profile/incognito session if possible.

Desktop:

- Open production build with `?portal=pikabu` and GamePush credentials only in the browser URL or test harness, not committed:
  - `...?portal=pikabu&gpProjectId=<owner-value>&gpPublicToken=<owner-value>`
- Confirm title screen appears and is interactive.
- Confirm no critical console errors.
- Start a new game.
- Verify pointer capture / click-to-capture screen is coherent.
- Walk, interact, shoot, open menu, save, load, change floor if practical.
- Confirm generated roulette/slots prompts do not appear in portal mode.
- Confirm NPC durak/dice options do not appear in portal mode.
- Confirm `floor_69` is not reachable as authored adult route in portal mode.
- Confirm `N` / Net Sphere does not open a network terminal and no `/api/net` request is made.

Mobile / responsive:

- Run the browser smoke and manually test at least one mobile viewport.
- Confirm mobile controls do not overlap the HUD.
- Confirm no text overflows critical buttons.
- Confirm fullscreen/direct-page behavior does not reload the embedded view unexpectedly.
- Confirm the game is playable without external registration.

## SDK / Cloud-Save QA

GamePush test harness must show:

- `window.gp` exists or the GamePush SDK script is loaded through the supplied project id/public token.
- Platform pause event pauses local simulation and audio.
- Platform resume event resumes only after every suspend reason is cleared.
- `gameStart` / `gameplayStart` / `gameplayStop` calls do not throw.
- Save writes `player.progress` as a wrapped `gigahrush-save` record.
- Save calls `gp.player.sync({ storage: 'cloud' })`.
- Removing local `gigahrush_save` and reloading can hydrate a current-shape cloud save back into local storage.
- Oversized portal saves above `900 KiB` are recorded as a blocker; do not submit until the candidate save fits the compact current-shape profile or the compact policy is tightened.

Suggested manual save check:

1. Start portal build.
2. Save.
3. Inspect GamePush player field `progress`.
4. Clear local `gigahrush_save`.
5. Reload the same portal URL.
6. Use load menu.
7. Confirm the saved run restores from GamePush-backed local hydration.

## Content / Moderation QA

Portal mode must not expose:

- third-party playable links, Telegram, itch, MyIndie, GameDev.net, Reddit or direct build links inside game UI;
- casino-like mechanics: generated slots, roulette, poker analogues;
- money-stake durak/dice NPC menu options;
- authored `floor_69` adult route or its placeholder entertainment option;
- Net Sphere same-origin API calls on GamePush/Pikabu hosting;
- public implementation geometry such as exact map dimensions/topology.

Current source scan on 2026-05-27 found no literal `http://` or `https://` URLs in `src/**/*.ts`, but repeat the scan before submission:

```bash
rg -n "https://|http://" src --glob '*.ts'
```

## Owner / Legal Blockers

These cannot be solved by code:

- Owner must authorize GamePush account/project creation.
- Owner must provide or enter GamePush `projectId` and `publicToken`.
- Owner must confirm legal/payment readiness for Russian-law contract/payment requirements.
- Owner must accept GamePush/Pikabu terms only in the official UI.
- Owner must provide final icons/covers if the form asks for `1024x1024` square and `1920x1080` horizontal graphics.

No agent should press the final submit/moderation button until the browser QA above passes with the real GamePush project configuration.
