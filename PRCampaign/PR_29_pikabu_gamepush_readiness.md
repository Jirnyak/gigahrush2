# PR 29 - Pikabu Games / GamePush Readiness Pass

Date: 2026-05-27.

Time window: 21:35-22:10 UTC / 22:35-23:10 BST.

Scope: continue owner-requested six-lane Pikabu Games preparation without damaging the canonical game. No GamePush project credentials, legal terms, payment agreement, Pikabu submission, moderation request or publish click was performed.

## Six Readiness Lanes

| Lane | Result |
| --- | --- |
| 1. Official requirements | Rechecked Pikabu Games and GamePush official docs. Pikabu requires GamePush SDK, cloud saves, autocorrect pause/audio behavior, Russian UI, no critical console errors, root `index.html`, no prohibited content, legal/payment readiness and moderation. GamePush install uses `https://gamepush.com/sdk/game-score.js?projectId=...&publicToken=...&callback=onGPInit`; game code must wait for `gp.player.ready` before relying on player data. |
| 2. SDK lifecycle | Upgraded `src/systems/platform_bridge.ts` so `?portal=gamepush` / `?portal=pikabu` can load GamePush SDK only when public `projectId` and `publicToken` are supplied through query or meta tags. The normal browser build still does not load GamePush or add a runtime dependency. |
| 3. Cloud saves | GamePush cloud save now writes a wrapped JSON record to the configured player field `progress`, then calls `gp.player.sync({ storage: 'cloud' })`. The bridge prefers a compact current-shape portal profile once the raw payload grows past `64 KiB`, keeps a hard GamePush guard at `900 KiB`, and can read the wrapped `progress` back into local `gigahrush_save` when no newer local portal save is present. |
| 4. Portal-safe runtime | Existing PR 28/29 portal mode keeps casino-like surfaces, NPC card/dice gambling, optional Net Sphere network calls and `floor_69` route stops disabled for strict portals (`portal=yandex`, `portal=gamepush`, `portal=pikabu`) without removing them from the main game. |
| 5. Content/legal blockers | Pikabu still cannot be submitted until owner/GamePush account, legal/payment status, public tokens, promo assets and a final portal-safe QA build exist. Current canonical game can keep its full content; the upload artifact must be launched in strict portal mode. |
| 6. Verification/docs | Focused portal/audio/Net Sphere tests passed, the full `npm run check` gate passed, and `npm run pikabu:build` emitted a local strict-portal ZIP candidate. Browser/iframe QA with real GamePush credentials is still required before submission. |

## Official Facts Rechecked

- Pikabu technical docs: GamePush SDK integration is mandatory; moderation can take up to 7 working days; common rejection causes include no cloud saves, unstable launch, critical console errors, bad archive root and missing legal/payment ability.
- Pikabu content/technical requirements: Russian UI, correct scaling, autocorrect pause when the tab is hidden or ads show, background sound off, cloud saves required, no required external auth, no third-party links except support, no adult content, no casino/slots/poker/roulette-like mechanics, icon `1024x1024`, cover `1920x1080`, at least four landscape screenshots `1280x720` for a landscape game.
- GamePush Pikabu distribution docs: Pikabu supports automatic auth, payments, ads, GamePush cloud saves and sharing; submit through GamePush distribution after creating a GamePush project; upload ZIP in hosting with root `index.html`; do not publish the draft yourself in the hosting section.
- GamePush SDK docs: JavaScript install uses `game-score.js` with `projectId`, `publicToken` and `callback=onGPInit`; after initialization, wait for `gp.player.ready`.
- GamePush cloud-save docs: player data fields must be created in the GamePush panel; JSON progress is stored through `gp.player.set('progress', JSON.stringify(...))`, then confirmed with `gp.player.sync()`. Total profile data limit is `1 MB`; recommended total profile data is no more than `10 KB` gzip.
- GamePush player-manager docs: `gp.player.sync({ storage: 'cloud' })` syncs with GamePush cloud. The SafeStorage support table marks Pikabu Games as unsupported, so the bridge uses GamePush cloud storage and does not rely on platform-local storage for Pikabu.

Official source URLs:

- `https://games.pikabu.ru/page/tehnicheskaya-dokumentatsiya`
- `https://docs.gamepush.com/ru/docs/distribution/pikabu/`
- `https://docs.gamepush.com/ru/docs/get-start/getting-started/`
- `https://docs.gamepush.com/ru/docs/player/cloud-saves/`
- `https://docs.gamepush.com/ru/docs/player/player-manager/`
- `https://docs.gamepush.com/ru/docs/storage/`

## Code Work Completed

- `src/systems/platform_bridge.ts`
  - accepts portal aliases `gamepush`, `gp`, `pikabu`, `pikabu-games`, `pikabu_games`;
  - supports GamePush SDK loading from query credentials: `?portal=gamepush&gpProjectId=...&gpPublicToken=...`;
  - supports GamePush SDK loading from wrapper meta tags: `gamepush-project-id` and `gamepush-public-token`;
  - preserves a host-defined `onGPInit` callback while also storing `globalThis.gp`;
  - waits for both `gp.ready` and `gp.player.ready`;
  - uses `gameStart`, `gameplayStart`, `gameplayStop`, `pause`, `resume`;
  - writes a wrapped save record to GamePush `progress` and syncs with `{ storage: 'cloud' }`;
  - prefers the compact current-shape portal profile from `src/systems/save_payload.ts` for larger saves;
  - can read a wrapped or older raw current-shape save from GamePush/Yandex and hydrate local `gigahrush_save`;
  - keeps Yandex strict limit `190 KiB` and GamePush raw limit `900 KiB` as guards before cloud sync.
- `scripts/build-pikabu.mjs`
  - adds `npm run pikabu:build` to emit `pikabu/gigahrush-pikabu.zip` with strict Pikabu portal metadata, without changing the canonical `dist/` artifact or committing GamePush credentials.
- `tests/platform-bridge.test.ts`
  - covers portal aliases, GamePush credentials parsing, strict portal content blocks, GamePush save budget, wrapped GamePush save write, and wrapped GamePush save read.

## Still Not Submission-Ready

1. Owner/legal: GamePush/Pikabu legal/payment readiness and public project credentials are not in the repo and were not accepted in a browser.
2. GamePush panel: the `progress` player field must exist as a string/JSON field before cloud save is real.
3. Cloud-save size: GamePush allows up to `1 MB` total profile data but recommends `10 KB` gzip; the bridge now sends compact current-shape portal records for large saves, but QA must still treat any compact candidate above the `900 KiB` guard as a blocker.
4. Promo assets: final icon `1024x1024`, cover `1920x1080`, and at least four `1280x720` screenshots need a dedicated pack check.
5. Portal QA: strict portal launch must be tested on desktop/mobile with `?portal=pikabu` or `?portal=gamepush`, GamePush SDK present, no critical console errors, pause/audio checks, no external-link surfaces, no gambling/adult route access and cloud save load/save.

## Verification So Far

- `npm run typecheck` passed.
- `npx tsx --test tests/platform-bridge.test.ts tests/audio.test.ts tests/npc-interaction-options.test.ts tests/interactions.test.ts tests/procedural-floors.test.ts` passed: 71 tests, 69 passed, 2 skipped, 0 failed.
- `npx tsx --test tests/net-sphere.test.ts tests/platform-bridge.test.ts tests/audio.test.ts` passed: 29 tests, 0 failed.
- `npm run check` passed: typecheck, 1339 unit tests, content audit and production build.
- `npm run pikabu:build` passed without GamePush credentials: generated ignored `pikabu/gigahrush-pikabu.zip` (`5 196 710` bytes) with root `index.html` and strict portal metadata; credentials embedded: no.

Still to run before a real Pikabu Games submission: `npm run check:browser` and real GamePush/Pikabu iframe QA with owner project credentials.
