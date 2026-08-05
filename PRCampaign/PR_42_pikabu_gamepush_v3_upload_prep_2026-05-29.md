# PR 42 - Pikabu/GamePush v3 Upload Prep

Date: 2026-05-29.

Time window: 2026-05-29 01:45-01:51 UTC / 02:45-02:51 BST.

Scope: prepare the current committed build for a Pikabu Games / GamePush update after the owner showed a moderator chat where Pikabu Games said they are happy to take the game and asked whether the developer is a physical person, self-employed, individual entrepreneur or company. Owner replied in the chat that this is a physical person and the game is free.

Follow-up: `PRCampaign/PR_43_pikabu_gamepush_v3_asset_followup_2026-05-29.md` supersedes this prep note for live panel status. Owner uploaded v3, promo icon/cover/screenshots warnings were cleared, and the remaining visible blocker is owner-only `My Company` contract data plus sandbox/cloud-save QA.

## Result

Local Pikabu/GamePush upload artifact is ready, but no external upload, publish action, distribution final-click, public post, email, vote, rating or catalog announcement was made in this pass.

- GamePush project panel: https://gamepush.com/panel/projects/28314
- Hosting page to update: https://gamepush.com/panel/projects/28314/hosting/
- Existing published GamePush-hosted build from PR 33: https://s3.eponesh.com/games/28314/v2/
- Existing distribution page: https://gamepush.com/panel/projects/28314/distribution/

Fresh local artifact from current HEAD:

```txt
HEAD: c08a452 Refine combat HUD logging
Archive: pikabu/gigahrush-pikabu.zip
Archive size: 5 185 480 bytes
SHA-256: e396c610c226be1eaaec14ad4a1d2cdb433b8c5be27bb401fb5f027387bebcb4
HTML: pikabu/index.html
HTML size: 11 246 051 bytes
Portal metadata: gigahrush-portal=pikabu
GamePush credentials embedded: no
```

ZIP contents were verified with `unzip -l`: `index.html` is at archive root and the archive contains `apple-touch-icon.png`, `build-size-manifest.json`, `icon-192.png`, `icon-512.png`, `index.html`, `manifest.webmanifest` and `sw.js`.

## Validation

Passed:

```txt
npm run pikabu:build
npm run check:readonly
```

`check:readonly` result: TypeScript passed, unit tests passed (`1366` passed, `0` failed, `2` skipped), and content audit reported `Errors: none`.

Browser smoke note: `npm run smoke` launched Vite preview and headless Chrome, but did not reach a final report after more than two minutes and was stopped so the local preview/Chrome processes would not remain running. The visible output showed only Chrome service messages and WebGL `ReadPixels` performance warnings, not a completed pass. Treat browser validation as not completed until the owner or next agent tests the uploaded GamePush sandbox/iframe.

## Owner Upload Steps

Use the already existing project, not a new Pikabu application:

1. Open https://gamepush.com/panel/projects/28314/hosting/
2. Upload `pikabu/gigahrush-pikabu.zip` as the next hosting build/version.
3. After upload, publish that draft in Hosting if GamePush shows separate load/publish controls.
4. Open the draft or sandbox URL and verify launch, console, pause/audio, scaling and `progress` cloud-save behavior.
5. Open https://gamepush.com/panel/projects/28314/distribution/ and confirm Pikabu still points at the new actual draft/published version.
6. Do not create a duplicate Pikabu submission while Distribution remains `Application submitted`; reply to moderators in the existing chat if they ask for legal/payment details or a fresh version.

If GamePush shows a version selector for Pikabu Distribution, select the newly uploaded version. If it auto-binds the latest Hosting version, just confirm the displayed `Actual draft version` changed after upload.

## Remaining Risks

- The local archive embeds no private GamePush credentials. PR 33 showed GamePush-hosted HTML still received public project metadata after upload, but sandbox QA must confirm this again.
- The previous sandbox checklist was only `11%`, `1 / 9`; SDK GameStart, progress save/load, language fallback and sound control were not fully verified.
- There is still no public Pikabu Games catalog URL; do not announce Pikabu publication until moderation acceptance and a public game page are visible.
