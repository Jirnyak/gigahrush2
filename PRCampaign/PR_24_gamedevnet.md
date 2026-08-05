# PR 24 - GameDev.net Project Lane

Date: 2026-05-27.

Time window: 20:24-20:38 UTC / 21:24-21:38 BST.

Scope: GameDev.net Projects create flow under the authenticated `Tenevik` account. No source code was touched. No public publish/final promotion click was made.

Read before acting:

- `KPI.md`
- `PRCampaign/campaign_plan_ru.md`
- `PRCampaign/PR_23.md`
- Current EN/link rules in the KPI/campaign docs: direct browser build is the primary EN frictionless play link, itch is the mirror/gallery link, `jirnyak`/`jirny.uk` are not used, and public copy must say `unbounded concrete megastructure` rather than implementation geometry.

## Result

GameDev.net draft/private project was created:

- Manage URL: `https://gamedev.net/manage/projects/124/`
- Author-visible view URL: `https://gamedev.net/projects/124-gigahrush/`
- Account: `Tenevik` / `profile/375035-tenevik`
- Title: `GIGAH|RUSH`
- Tagline: `Free browser survival horror ARPG shooter built in TypeScript/WebGL.`
- Type: `Games`
- Status: `In Development`
- Genre: `Survival`
- Engine: `WebGL`
- Visibility: not public. The manage page showed `Published` / `When published, your project will be visible to everyone`, and the `is_visible` checkbox was unchecked after creation.

The safe path from PR 23 was confirmed: the create form has a real visibility control. Creating with `Publish immediately` disabled posts `is_visible=0`, then returns the private manage page instead of forcing immediate public publication.

## Media And Links

Native GameDev.net uploads completed before creation:

- Cover media id `126126`: `https://uploads.gamedev.net/projects/monthly_2026_05/a9f01244d8864e578425d41ff795fd5a.gigahrush-gamedevnet-cover.jpg`
- Screenshot/media id `126127`: `https://uploads.gamedev.net/projects/monthly_2026_05/fe981d08ae7a466280f34f4560766879.gigahrush-gamedevnet-contract.jpg`
- Screenshot/media id `126128`: `https://uploads.gamedev.net/projects/monthly_2026_05/2dba265730a04448bf201dc16ff078f3.gigahrush-gamedevnet-alife.jpg`

Author-visible project view was checked in the logged-in Chrome session before publish:

- Cover rendered from GameDev.net media.
- Three GameDev.net-hosted media images were present in the description.
- Direct browser link rendered as a clickable anchor: `https://gigahrush.bileter.workers.dev/`
- Itch mirror/gallery link rendered as a clickable anchor: `https://tenevik.itch.io/gigahrush`
- Developer disclosure was present.
- Public wording used `unbounded concrete megastructure`.

## Blocker Before Public Publish

Do not toggle `Published` yet.

The project is good as a hidden draft, but final public publish still needs one last manual/agent pass:

- Add the already-uploaded media ids `126126`, `126127`, `126128` to the official `Media` / screenshots gallery. The media tab opened and showed the three uploaded assets in the media library, but Chrome session state changed before the `Add Selected` action could be verified.
- Reopen `https://gamedev.net/manage/projects/124/?tab=media`, click `Add Screenshot`, select those three media items, click `Add Selected`, and verify the media tab no longer says `No screenshots yet`.
- Reopen `https://gamedev.net/projects/124-gigahrush/` and verify gallery screenshots, cover and direct/itch links still render.
- Only then toggle `Published` on the settings page and save.

Logged-out/public verification was not completed: shell requests to the public GameDev.net URL hit Cloudflare `403`, and browser JavaScript automation became disabled after Chrome window/session state changed. A web search for `site:gamedev.net/projects/124-gigahrush GIGAH RUSH` did not surface the project, which is consistent with the project still being hidden/unindexed.

## Exact Next Action

Use the existing logged-in browser session if it still opens the manage URL as `Tenevik`. If Chrome says JavaScript from Apple Events is disabled, manually enable `View > Developer > Allow JavaScript from Apple Events` or do the remaining clicks by hand:

1. Open `https://gamedev.net/manage/projects/124/?tab=media`.
2. Add screenshots from the media library: `126126`, `126127`, `126128`.
3. Verify `https://gamedev.net/projects/124-gigahrush/` shows cover, gallery/media and clickable direct/itch links.
4. Publish only after that verification.
