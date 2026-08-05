# PR 29 - Pikabu Games / GamePush Prep

Date: 2026-05-27.

Time window: 21:44-22:10 UTC / 22:44-23:10 BST.

Scope: continue the owner-requested six-lane Pikabu Games preparation without submitting the game or damaging the normal browser build. No GamePush credentials were committed, no legal/payment terms were accepted, and no Pikabu Games final submit click was performed.

## Six-Lane Result

| Lane | Status |
| --- | --- |
| 1. SDK / lifecycle | Extended the optional bridge so `?portal=gamepush` and `?portal=pikabu` are first-class portal targets. The bridge can load GamePush SDK only when owner-provided `gpProjectId` and `gpPublicToken` are supplied in query params or meta tags. |
| 2. Cloud save | GamePush raw save budget is now `900 KiB`; Yandex stays at the stricter `190 KiB`. Saves are wrapped as `gigahrush-save` records with `SAVE_SHAPE_VERSION`; larger saves prefer a compact current-shape portal profile after `64 KiB`, and current-shape cloud saves can hydrate back into local storage. |
| 3. Moderation-safe content gates | Strict portal mode disables generated roulette/slots, hides NPC durak/dice money-stake options, hides the Floor 69 entertainment placeholder, replaces authored `floor_69` route with a procedural route entry, and disables optional Net Sphere networking. |
| 4. Artifact / credentials | Added and ran a local `npm run pikabu:build` artifact builder. It emitted `pikabu/gigahrush-pikabu.zip` with root `index.html` and strict portal metadata, but no real GamePush artifact was uploaded because the project id/public token and owner/legal readiness are still missing. The normal Cloudflare/itch path remains untouched unless launched with portal query/meta configuration or through the copied Pikabu artifact metadata. |
| 5. QA / moderation checklist | Added `PRCampaign/pikabu_games_pre_submit_qa_2026-05-27.md` with exact commands, browser checks, SDK/cloud-save checks, content/link checks and owner blockers. |
| 6. PR/KPI continuity | This report plus KPI/campaign docs record the new state and keep Pikabu Games as engineering/legal-gated, not submit-ready. |

## Source Work Completed

- `src/systems/platform_bridge.ts`
  - normalizes `yandex`, `gamepush`, `pikabu` portal targets;
  - reads GamePush credentials from query params or meta tags without committing secrets;
  - loads GamePush SDK through the documented callback pattern when configured;
  - saves current-shape records to GamePush `player.progress` and syncs cloud storage;
  - prefers compact current-shape portal records for larger saves and keeps the hard GamePush guard at `900 KiB`;
  - loads current-shape cloud saves back when local storage is absent or older;
  - exposes strict portal policy helpers.
- `src/systems/save_payload.ts`
  - exports the compact portal save profile used before writing larger GamePush cloud saves.
- `scripts/build-pikabu.mjs` / `package.json`
  - add `npm run pikabu:build` for a separate `pikabu/gigahrush-pikabu.zip` artifact with strict portal metadata and optional local-env GamePush public credentials.
- `src/systems/interactions.ts`
  - strict portal mode does not place/target/open roulette or slots machines.
- `src/systems/npc_interaction_options.ts`
  - strict portal mode hides durak, dice and Floor 69 entertainment options.
- `src/systems/procedural_floors.ts`
  - strict portal mode blocks authored `floor_69` route and supplies a procedural route at the same `z`.
- `src/systems/net_sphere.ts`
  - strict portal mode does not bind/open/poll Net Sphere and avoids `/api/net` traffic.
- `tests/platform-bridge.test.ts`
  - covers portal aliases, GamePush config parsing, size budgets, strict portal policy and cloud-save load/write behavior.

## Verification So Far

Passed before/after this report:

- `npm run typecheck`
- focused test command:

```bash
npx tsx --test tests/platform-bridge.test.ts tests/audio.test.ts tests/npc-interaction-options.test.ts tests/interactions.test.ts tests/procedural-floors.test.ts
```

Focused run result: 71 tests, 69 pass, 2 skipped, 0 fail. The skipped tests are the existing generation-matrix-only cases.
- `npx tsx --test tests/net-sphere.test.ts tests/platform-bridge.test.ts tests/audio.test.ts` passed: 29 tests, 0 failed.
- `npm run check` passed: typecheck, 1339 unit tests, content audit and production build.
- `npm run pikabu:build` passed without GamePush credentials: generated ignored `pikabu/gigahrush-pikabu.zip` (`5 196 710` bytes) with root `index.html` and strict portal metadata; credentials embedded: no.

Remaining gates before any real Pikabu Games upload:

- `npm run check:browser`
- portal browser QA with the real GamePush project configuration.

## Remaining Blockers

- Owner must create/authorize the GamePush project and provide project id/public token through the official UI or private local run command.
- Owner/legal must confirm payment/legal status and accept official GamePush/Pikabu terms manually.
- A real GamePush-hosted or Pikabu iframe preview has not been tested.
- Oversized compact portal saves above `900 KiB` still block reliable GamePush cloud progress; if this appears in QA, tighten the compact current-shape portal save policy before submission.
- Final icons, cover, description, controls/instructions and age-rating fields still need the actual form pass.

## Next Action

Use the pre-submit gate in `PRCampaign/pikabu_games_pre_submit_qa_2026-05-27.md`. Do not submit the current build until `npm run check:browser`, a fresh `npm run pikabu:build` with owner-provided local GamePush credentials, real GamePush SDK save/load, no-link/no-casino/no-adult-route checks, and owner/legal blockers are all clear.
