# PR 33 - Pikabu/GamePush v2 Update

Date: 2026-05-28.

Time window: 2026-05-28 04:35-05:40 UTC / 05:35-06:40 BST.

Scope: continue the owner-requested Pikabu Games follow-up after GamePush project `28314` existed but was not visible in the public Pikabu catalog. This pass verified the updated GamePush-hosted build, created the required cloud-save player field and checked distribution/sandbox state.

## Result

Updated GamePush hosting is live for project `ГИГАХРУЩ` / `28314`.

- GamePush project panel: https://gamepush.com/panel/projects/28314
- Hosting page: https://gamepush.com/panel/projects/28314/hosting/
- Published GamePush-hosted build: https://s3.eponesh.com/games/28314/v2/
- Draft GamePush-hosted build: https://s3.eponesh.com/games/draft/28314/v2/
- Distribution page: https://gamepush.com/panel/projects/28314/distribution/

Visible hosting state in Chrome:

```txt
Last published version: 2 published
Last draft version: 2 loaded
Game published.
```

Visible distribution state in Chrome:

```txt
Distribution status: Application submitted
Pikabu
Actual draft version: 2
Application submitted
```

This is still not a public Pikabu Games catalog listing. Public search and the visible Pikabu Games catalog did not expose a `ГИГАХРУЩ` / `GIGAH|RUSH` game page during this pass.

## Build And Field State

The uploaded local artifact was the updated ignored archive:

- `pikabu/gigahrush-pikabu.zip`: `5 225 076` bytes.
- `pikabu/index.html`: `11 384 204` bytes.
- Archive root includes `index.html`.
- The GamePush hosted HTML at `https://s3.eponesh.com/games/28314/v2/` returned `200`, title `ГИГАХРУЩ - САМОСБОР`, `gigahrush-portal=pikabu` and GamePush public project metadata.

The required GamePush player custom field now exists:

```txt
Custom fields
string
Progress
progress
""
```

This removes the known panel-side blocker for the code path that writes cloud saves through `gp.player.set('progress', ...)` and `gp.player.sync({ storage: 'cloud' })`.

## Sandbox QA

Sandbox URL opened from GamePush:

- https://gamepush.com/panel/projects/28314/sandbox/?gameUrl=https%3A%2F%2Fs3.eponesh.com%2Fgames%2Fdraft%2F28314%2F

Observed sandbox state:

```txt
Testing progress: 11%
1 / 9
Game window: 1280x720
Debug Console: ready
```

The sandbox checklist did not fully pass in this pass. Only SDK initialization was counted. The remaining checklist still includes GameStart timing, progress save/load, language fallback and sound control requirements. Do not announce a public Pikabu listing from this state.

## Remaining Actions

1. Monitor GamePush distribution status for project `28314`; do not duplicate-submit while it says `Application submitted`.
2. After moderation acceptance, fill the required Pikabu catalog card fields in GamePush: short description, full description, about, how to play, icon, cover, four landscape screenshots and keywords.
3. Run full iframe QA again after the catalog/card fields are available: SDK GameStart, progress save/load, language detection/fallback, sound pause/control, console errors, desktop scaling and mobile landscape/portrait.
4. If sandbox stays stuck at `1 / 9`, inspect the GamePush SDK method names/events against current docs and patch the bridge only if source behavior is wrong.

## No Public PR Action

No public post, email, comment, vote, rating or duplicate portal submission was made in this pass. The only external mutation was creating the GamePush custom player field `progress` inside the already-created owner-authorized project.
