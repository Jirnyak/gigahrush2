# PR 28 - GameDev.net Publish And Portal Bridge Start

Date: 2026-05-27.

Time window: 21:10-21:25 UTC / 22:10-22:25 BST.

Scope: finish owner-requested GameDev.net project publication, check Yandex/Pikabu Games blockers, and start the minimal SDK/lifecycle bridge needed before any Yandex or Pikabu Games upload. No credentials were printed. No Yandex developer account, legal attestation, GamePush authorization, Pikabu Games submission, or portal publish click was performed.

## GameDev.net Result

GameDev.net project is live:

- Manage draft: `https://gamedev.net/manage/projects/124/`
- Public/project view: `https://gamedev.net/projects/124-gigahrush/`
- Authenticated owner/profile shown in Chrome: `Tenevik`

Final browser verification:

- `Published` is checked on the settings tab after save/reload.
- Project page title is `GIGAH|RUSH | GameDev.net Projects - GameDev.net`.
- Public card shows `CREATED BY TENEVIK`.
- Media gallery shows `Screenshots (3)`.
- Native project media are present:
  - `126126` cover / `a9f01244d8864e578425d41ff795fd5a.gigahrush-gamedevnet-cover.jpg`
  - `126127` contract screenshot / `fe981d08ae7a466280f34f4560766879.gigahrush-gamedevnet-contract.jpg`
  - `126128` A-Life screenshot / `2dba265730a04448bf201dc16ff078f3.gigahrush-gamedevnet-alife.jpg`
- Duplicate local screenshot row `104` was removed after the concurrent add race, leaving only the intended three screenshots.
- Description has clickable direct browser and itch anchors:
  - `https://gigahrush.bileter.workers.dev/`
  - `https://tenevik.itch.io/gigahrush`
- Copy uses `unbounded concrete megastructure` and does not expose implementation geometry.

Unauthenticated shell fetch still hits GameDev.net/Cloudflare `403`, so use a normal browser challenge for clean public verification. Do not create a duplicate GameDev.net project.

## Yandex Status

Chrome reaches `https://games.yandex.com/console/developer/create`, but the console is still at developer-account creation:

- visible title/state: `Create developer account`;
- `Add app` is disabled until account setup is complete;
- form asks for developer/business name and agreement/legal/tax confirmations.

No developer account was created and no legal/tax terms were accepted. Engineering blocker remains: SDK and portal lifecycle are required before upload.

## Pikabu Games / GamePush Status

`https://games.pikabu.ru/add-own-game/form` is reachable, but the first step is GamePush authorization. Subagent Feynman confirmed the current build is not ready for Pikabu Games submission because official flow requires GamePush SDK, cloud saves, moderation/legal/payment readiness, and portal-safe content policy. Current full local saves can exceed small portal cloud-save budgets, so raw full-save sync must be guarded until a compact portal profile exists.

No GamePush authorization or Pikabu Games submission was made.

## Code Work Completed

Added a minimal optional platform bridge without adding runtime dependencies:

- `src/systems/platform_bridge.ts`
  - detects explicit `?portal=yandex`;
  - initializes Yandex SDK only when `YaGames` exists or `portal=yandex` asks for `/sdk.js`;
  - binds Yandex `game_api_pause` / `game_api_resume` and GamePush `pause` / `resume` when SDKs are present;
  - sends Yandex `LoadingAPI.ready()` after the title screen is interactive;
  - sends gameplay start/stop when the local pause state changes;
  - attempts non-blocking portal cloud-save only when SDK is present and raw save is below `190 KiB`.
- `src/systems/audio.ts`
  - changed audio pause from one page-hidden boolean to bounded reasons: `page` and `platform`;
  - sound resumes only after all suspend reasons are cleared.
- `src/main.ts`
  - platform pause is transient runtime state only, not saved;
  - platform pause clears inputs like page-hidden pause;
  - local `localStorage` save remains authoritative and still succeeds even if portal cloud save is unavailable/skipped.
- Tests:
  - `tests/audio.test.ts`
  - `tests/platform-bridge.test.ts`

This is bridge groundwork, not a finished Yandex/Pikabu portal artifact. The next portal build still needs Yandex/GamePush project credentials, external-link policy cleanup, legal owner actions, QA and moderation packaging.

## Verification

- `npm run typecheck` passed.
- `node --test --import tsx tests/audio.test.ts tests/platform-bridge.test.ts` passed: 5 tests.
- `npm run check` passed: typecheck, `1333` unit tests (`1331` pass, `2` skipped), content audit with `Errors: none`, and production build. The build step regenerated `dist/index.html`.
- `git diff --check` passed.

## Next Actions

1. Monitor GameDev.net page, comments, search/indexing and link/media retention.
2. Owner/legal: complete Yandex developer-account fields only if choosing Yandex as the next upload target.
3. Engineering: create a real portal artifact for `portal=yandex` or `portal=gamepush`, then run `npm run check` / browser QA before any upload.
4. For Pikabu Games, do not submit until GamePush project credentials, cloud-save policy, legal/payment readiness and portal-safe content pass are complete.
