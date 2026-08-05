# GIGAH|RUSH Media KPI Report - 2026-05-26

## Snapshot

| Surface | Status | Signal | Risk | Action |
| --- | --- | --- | --- | --- |
| PR identity | Migrating now | Future public outreach uses `Tenevik Games` and `tenevik.games@gmail.com`. | Old drafts and account sessions can leak `jirnyak`, `jirnyak@gmail.com` or `jirny.uk` into new posts. | Use only Tenevik identity for new posts, registrations, support requests and pitches. |
| Local PR secret | Stored locally | `.env.pr.local` exists with mode `600`; `git check-ignore -v .env.pr.local` matches `.gitignore:14` / `.env.*`. | Secret can still leak if pasted, logged, or force-added. | Do not print contents, do not commit, do not use `git add -f`. |
| Old site | Retired from public copy | Active docs now say not to mention `https://jirny.uk` in new posts. | Historical reports and sent-email logs still contain it as audit trail. | Do not rewrite dated facts; remove it only from reusable drafts. |
| itch.io English store page | Done | Opera GX dashboard pass saved English short description/body/tags at 2026-05-25 23:50 UTC / 2026-05-26 00:50 BST. Public logged-out check confirms English copy on `https://tenevik.itch.io/gigahrush` and profile card. | The page still has itch-controlled `noindex`; this was not fixed by the copy edit. | Monitor `noindex`, exact itch search and support reply; do not recreate the game page. |
| itch.io external links | Done | The stale `Homepage -> https://jirny.uk` link was removed in the same dashboard pass. Public Links block now keeps Community `https://t.me/gigah_rush`, Direct browser build `https://gigahrush.bileter.workers.dev`, IndieDB and Game Jolt. | A future official site must be owner-confirmed before adding a Homepage link back. | Keep `jirny.uk` out of new posts, pitches, portal forms and store links. |
| Old email/account cleanup | Owner-requested | Account matrix added to KPI operating brief. | Blind deletion can remove useful live campaign pages or support threads. | Delete or migrate only after authenticated preview and ownership/export check. |
| Public old-identity web trace | Found | Public search shows a ModDB/DBolical page for `GIGAH\|RUSH` with creator `jirnyak` and homepage pointing to Tenevik itch. | Search may surface old creator identity even if links are current. | Recheck in browser/account context; migrate creator/profile or delete if transfer is impossible. |
| Active draft cleanup | In progress | `next_wave_targets_2026-05-23.md`, `needed_access_ru.md`, `next_wave_schedule_ru.md`, `post_wave_en_community_2026-05-23.md`, KPI and campaign plan were updated. | Other old copy may remain in historical docs. | Use `rg` before any outbound post. |
| RU/CIS upload scout | Completed read-only | Six subagents plus local official-doc checks ranked Яндекс Игры as best long-term RU/CIS playable upload target; VK Play browser project and ИграйТут are nearer current-build scouts. Details: `PRCampaign/ru_cis_upload_platforms_2026-05-26.md`. | Яндекс/Пикабу require SDK work; VK Play needs dashboard/legal/moderation; ИграйТут needs external-link/CSP/content check. | Owner chooses one lane before any submission: Yandex portal build, VK Play draft, or ИграйТут quick upload. |
| MyIndie Tenevik publication | Done | Authenticated Chrome/Tenevik pass at 2026-05-26 18:06-18:22 UTC / 19:06-19:22 BST updated and published `https://myindie.ru/games/game/gigahrush`. Public page now shows `Авторы (Tenevik Games)`, profile `TENEVIK`, dates `26.05.2026`, RU copy with `GIGAH\|RUSH`, clickable itch/direct/Telegram description links, 11 MyIndie-hosted media images and the current `5 078 498` byte ZIP. Follow-up at 19:17 UTC / 20:17 BST removed public map/topology wording and uses `безграничная бетонная структура` / `безграничная структура`. Web iframe URL returned `200`, title `ГИГАХРУЩ - САМОСБОР`, and direct browser check showed two canvas layers. Details: `PRCampaign/PR_16.md`. | Platform retained older gallery thumbnails alongside new media; possible duplicate media polish later. | Treat MyIndie as live Tenevik-owned RU surface; monitor moderation/comments/Web iframe/clickable links/public wording, no duplicate listing. |

## Good Signs

- The new credential is stored in an ignored local env file rather than a tracked document.
- The current operating docs now distinguish future Tenevik identity from historical old-account facts.
- MyIndie no longer leaks the old public `jirnyak` author on the active slug; it now shows Tenevik Games/TENEVIK, the current HTML5 build starts through MyIndie, the description has visible clickable links to itch/direct/Telegram, and the public text no longer reveals map size or topology.
- No source/gameplay code needs changes for this PR migration.

## Bad Signs

- Several useful live pages were likely created from old accounts; deleting everything would reduce campaign reach.
- Old support chains and outbound pitches still require monitoring from the old mailbox until closed or forwarded.
- Public creator/profile names still need manual dashboard checks on iDev.Games, ModDB/IndieDB, Game Jolt, DTF, GameDev.ru and Reddit. MyIndie was fixed through the Tenevik session on 2026-05-26.

## Next Actions

1. Recheck all active drafts with `rg "jirny.uk|jirnyak@gmail.com|\\bjirnyak\\b"` before any new post or email.
2. Recheck itch.io `noindex`, exact search results, devlog permalink and iframe hash after support/indexing has had time to update.
3. In each old-account dashboard, prefer rename/transfer/contact update over deletion when the page is live and useful; if the owner explicitly chooses deletion, record the URL and date.
4. Remove the old r/IndieDev post manually if desired; it is already moderator-removed and low campaign value.
5. Recheck ModDB/IndieDB account ownership and update creator/profile display to Tenevik.
6. Keep monitoring old Gmail threads only for replies, bounces and support closure; do not initiate new PR from it.
7. For Russian/CIS playable upload, do not scatter-submit. Pick one lane: Яндекс Игры as the main SDK build, VK Play browser draft as the first owner-dashboard scout, or ИграйТут as the quick HTML5 archive candidate.
8. MyIndie is now monitoring-only: watch moderation, comments, plays/downloads, Web iframe availability, clickable link retention and public wording retention at `https://myindie.ru/games/game/gigahrush`.

## Owner Needed

- Log into each platform that owns a live page and choose transfer/rename/delete after preview.
- Do not delete old mailbox access until itch support, Gamemoor support and sent media pitch threads are closed or forwarded.
- Confirm any replacement official site before adding one back to copy or itch External Links; until then use itch, direct build, Telegram and existing public resource pages.
