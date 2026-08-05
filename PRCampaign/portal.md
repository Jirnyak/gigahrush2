# Portal Builds And SDK Bridge

> Роль: рабочий документ для внешних portal/store сборок и проверок. Он намеренно лежит в `PRCampaign/`, а не в `README.md`: README остается факт-картой самой игры.

## Canonical Build

The normal browser build remains the canonical zero-runtime-dependency build. Portal artifacts are copies or package outputs around that build; they must not become a separate gameplay source of truth.

Relevant scripts:

```bash
npm run itch:build
npm run pikabu:build
npm run itch:verify
npm run artifacts:verify
npm run check:release
```

`npm run itch:build` emits an itch.io HTML5 upload under `itch/`: `index.html` for direct single-file upload, `gigahrush-itch.zip` with `index.html` at the archive root, and upload notes for PWA manifest, icons and service worker metadata.

`npm run pikabu:build` emits a separate upload candidate under `pikabu/`: `index.html`, `gigahrush-pikabu.zip` with `index.html` at the archive root, and private setup notes. The script injects `gigahrush-portal=pikabu` metadata into the copied artifact only; the canonical `dist/` build is not changed.

If `GAMEPUSH_PROJECT_ID` / `GP_PROJECT_ID` and `GAMEPUSH_PUBLIC_TOKEN` / `GP_PUBLIC_TOKEN` are present in the environment, matching GamePush meta credentials are injected into the artifact without committing secrets.

## Current Pikabu/GamePush State

As of 2026-06-05, GamePush project `28314` has a fresh Pikabu hosting v4 published from `pikabu/gigahrush-pikabu.zip`. Public hosting `https://s3.eponesh.com/games/28314/` returns `HTTP/2 200`, `content-length: 13098262`, and `last-modified: Fri, 05 Jun 2026 20:15:05 GMT`.

The current local ZIP is `5,778,238` bytes, SHA-256 `e44a2af01310df177d37b59f65fbe9c835ef1a1abd9e632216f00d6bc10656a2`, contains `index.html` at the archive root, declares `gigahrush-portal=pikabu`, and does not embed GamePush credential meta tags.

The Distribution request remains `ACCEPTED` for `PIKABU`, but there is still no confirmed public Pikabu catalog URL. The active blocker is owner-side self-employed / NPD and `My Company` legal data, followed by real GamePush/Pikabu iframe QA.

## Portal SDK Bridge

The optional portal bridge in `src/systems/platform_bridge.ts` activates only when one of these is true:

- a host SDK is present;
- a portal query such as `?portal=yandex`, `?portal=gamepush` or `?portal=pikabu` is used;
- a copied artifact declares `gigahrush-portal` metadata.

The bridge forwards platform pause/resume into local pause/audio state, sends ready/gameplay lifecycle hooks, and keeps the local `gigahrush_save` payload authoritative.

Yandex cloud-save attempts use the stricter `190 KiB` raw-save budget.

GamePush can be configured with owner-provided `gpProjectId` and `gpPublicToken` query/meta values. It writes wrapped current-shape save records into `player.progress`, prefers a compact current-shape portal profile once the raw payload grows past `64 KiB`, falls back to full current-shape records under the `900 KiB` hard guard, and can hydrate a current-shape cloud save back into local storage.

## Strict Portal Mode

Strict portal mode is a moderation-safety layer for upload targets. It disables only for portal launches:

- generated roulette/slots;
- NPC money-stake card/dice/domino options;
- authored `floor_69`;
- the Floor 69 placeholder option;
- optional Net Sphere network calls.

This does not by itself make a portal submission ready. The target still needs real account credentials, legal/payment setup, iframe QA and the normal validation gates.

## Size And Verification

`npm run build:size` reports the ordinary game build size from `dist/index.html`. When `itch/gigahrush-itch.zip` exists, the report can also include itch ZIP upload weight; if the ZIP is stale, run `npm run itch:build`.

Current warning thresholds used by the size tooling are:

- 9.5 MB raw HTML;
- 4.5 MB HTML gzip;
- 4.5 MB itch ZIP;
- 5.8 MB Bad Apple frame source;
- 3.3 MB Bad Apple frame gzip.

Warnings are not automatic content cuts. If an external upload crosses a threshold, first verify whether the package is current, then compress generated frames, audio, sprite or texture code before adding more heavy data.

## PR Campaign Boundary

Public store pages, portal listings and campaign copy must not reveal implementation geometry such as exact map dimensions or topology. Use player-facing wording such as `безграничная бетонная структура` or `unbounded concrete megastructure`. Keep exact geometry and save/runtime details inside engineering docs.
