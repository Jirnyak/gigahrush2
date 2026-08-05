# PR 27 - GameDev.net Finalization

Date: 2026-05-27.

Time window: 21:00-21:06 UTC / 22:00-22:06 BST.

Scope: continue GameDev.net project draft at `https://gamedev.net/manage/projects/124/` under the authenticated `Tenevik` account. No credentials were printed, stored or repeated. The retired `jirnyak` identity was not used. Shared KPI/campaign docs were not edited.

Read before acting:

- `KPI.md`
- `PRCampaign/campaign_plan_ru.md`
- `PRCampaign/kpi_report_2026-05-27.md`
- `PRCampaign/PR_24_gamedevnet.md`

## Result

GameDev.net project URL:

- Public/project URL: `https://gamedev.net/projects/124-gigahrush/`
- Manage URL: `https://gamedev.net/manage/projects/124/`
- Account/profile shown in Chrome: `Tenevik` / `https://gamedev.net/profile/375035-tenevik`

The project is now live in the authenticated Chrome session. The verified page title is `GIGAH|RUSH | GameDev.net Projects - GameDev.net`.

Important process note: I did not intentionally click a standalone `Published` final toggle. During this shared-session pass, after saving the native links, the settings tab showed `Published` checked and the project URL opened as a live project page instead of the earlier hidden/error state. Since the page was already live, I verified the visible result rather than changing visibility back.

## Changes Made

Native project links were blank on the `Links` tab at the start of this pass, while the description already had clickable links. I added only the two safe intended fields and saved:

- `Demo/Play`: `https://gigahrush.bileter.workers.dev/`
- `itch.io`: `https://tenevik.itch.io/gigahrush`

GameDev.net confirmed: `Project links saved.`

No local source code, generated build artifact, KPI file or shared campaign plan file was edited.

## Media / Gallery Verification

The `Media` tab at `https://gamedev.net/manage/projects/124/?tab=media` now shows `Media 3` and a `Screenshots` section with no `No screenshots yet` message.

Verified GameDev.net-hosted media:

- `126126` / cover: `https://uploads.gamedev.net/projects/monthly_2026_05/a9f01244d8864e578425d41ff795fd5a.gigahrush-gamedevnet-cover.jpg`
- `126127` / contract screenshot: `https://uploads.gamedev.net/projects/monthly_2026_05/fe981d08ae7a466280f34f4560766879.gigahrush-gamedevnet-contract.jpg`
- `126128` / A-Life screenshot: `https://uploads.gamedev.net/projects/monthly_2026_05/2dba265730a04448bf201dc16ff078f3.gigahrush-gamedevnet-alife.jpg`

Live project page verification in Chrome:

- Shows `Screenshots (3)`.
- Shows the cover image.
- Shows three screenshot entries.
- Shows `CREATED BY TENEVIK`.
- Shows project info: `Games`, `In Development`, `Webgl`, `Survival`.
- Shows native `LINKS` entry for `itch.io`.
- Shows clickable description anchors for direct browser build and itch mirror.

## Link / Copy Verification

Live Chrome DOM checks on `https://gamedev.net/projects/124-gigahrush/`:

- Direct browser link exists and is clickable: `https://gigahrush.bileter.workers.dev/`
- Itch link exists and is clickable: `https://tenevik.itch.io/gigahrush`
- Text includes `unbounded concrete megastructure`.
- Text includes `TENEVIK` / `Tenevik Games`.
- Text does not include `jirnyak`, `jirny.uk`, `jirnyak@gmail`, `1024`, `torus` or `toroid`.
- The page did not show `No Project matches the given query`.

## Public / Logged-Out Check

Unauthenticated shell fetch is still blocked by GameDev.net/Cloudflare:

- `curl -L -I https://gamedev.net/projects/124-gigahrush/` returned `HTTP/2 403`.
- Response includes `cf-mitigated: challenge`.
- Body title is `Just a moment...`.

Web search for `site:gamedev.net/projects/124-gigahrush GIGAH RUSH` did not surface the new project yet. That is expected immediately after publication and does not prove the page is hidden.

## User Steps

1. Open `https://gamedev.net/projects/124-gigahrush/` in a clean normal browser session.
2. If Cloudflare appears, pass the normal browser challenge without logging into any old `jirnyak` account.
3. Confirm the page shows `GIGAH|RUSH`, `CREATED BY TENEVIK`, `Screenshots (3)`, the cover, three screenshots, direct browser link and itch link.
4. If the clean browser shows `No Project matches the given query` or missing media, do not create a duplicate project. Reopen `https://gamedev.net/manage/projects/124/?tab=media` under `Tenevik`, check `Media 3`, and save/publish only after the visible project page is correct.
5. Next campaign action is monitoring views/comments and search/indexing, not a duplicate GameDev.net post.

