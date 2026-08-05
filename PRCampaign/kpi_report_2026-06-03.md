# GIGAH|RUSH Media KPI Report - 2026-06-03

## Snapshot

| Surface | Status | Signal | Risk | Action |
| --- | --- | --- | --- | --- |
| PR 69 current reach / forecast | Monitoring-only KPI snapshot completed | Report: `PRCampaign/PR_69_current_kpi_reach_forecast_2026-06-03.md`. Current public lower-bound, non-deduplicated counters: DTF combined posts `5077801`, `5086991`, `5100874` = `3,987` views, `847` hits, `17` comments, `11` favorites, `10` reactions. MyIndie current player proxy = `160` views, `350` web plays, `21` downloads, `0` comments, `0` likes. Telegram public shell = `18` subscribers and `336` summed visible views across posts 1-15. ModDB search snapshot = rank `3,937 / 77,714`, `760` visits, `4 today`, `1` watcher, `2` articles. Fake Portal is now visibly public with GIGAH\|RUSH, direct build, itch and Telegram text. | These are not unique users and not all players. Direct Cloudflare, itch, private Telegram/VK/editorial queues and email opens are not publicly counted; itch still has `noindex`. | Use MyIndie web plays/downloads as the public player lower bound; add Cloudflare/itch/MyIndie dashboard analytics before making stronger claims. |
| PR 68 VK/TG/forms continuation | Two Telegram bot sends recovered from pasted log; one VK proposal and one catalog form newly submitted | Report: `PRCampaign/PR_68_vk_tg_forms_continuation_2026-06-03.md`. Counted TheDRZJ `@drzj_predlojka_bot` and DIGITALRAZOR `@drpredloga_bot` submissions from the pasted continuation without resending. VK `GameDev по-русски` suggested post submitted; page showed `Suggested posts 1`. MMOGOVNO add-game form accepted with redirect `sid=32086` and confirmation `Спасибо, ваша запись получена.` | DRZJ/DIGITALRAZOR/VK/MMOGOVNO are moderation/private queues, not live public reach yet. VK image upload was not verified, so the VK proposal should be treated as text-only. | Monitor all four routes. Next best fresh send is `@KwagaGames_robot`, then manual `Быть Инди`, then one VK indie community route with native media. |
| PR 67 RU forms / CoreMission | Two interrupted form submissions counted; one new moderated comment submitted | Report: `PRCampaign/PR_67_ru_forms_coremission_continuation_2026-06-03.md`. Perelesoq `https://forms.gle/sygk6XGiGRDCjA1B9` and Индикатор `https://forms.gle/ZomwE6hnHaPyd7vQ9` were confirmed from the owner-provided interrupted log with `Your response has been recorded`. CoreMission `+1PR` comment submitted at `https://coremission.net/gamedev/pr-dlya-indie-bez-izdatelya/`, response preview `Ваш комментарий ожидает одобрения`, comment id `129636`. | Perelesoq/Индикатор are not public until editorial/channel publication. CoreMission is moderation-pending and may never go live. | Do not resubmit these routes. Monitor Perelesoq, Индикатор and CoreMission approval/replies. |
| PR 66 requested target reaudit / PlayGround | Exact target audit done; PlayGround attempted but defective | Report: `PRCampaign/PR_66_requested_target_reaudit_2026-06-03.md`. PlayGround editor opened at `https://www.playground.ru/post/1343229` and published URL `https://www.playground.ru/misc/opinion/pochemu_gigahrusch_sdelan_kak_besplatnyj_brauzernyj_survival_horror_bez_dvizhka-1849349`, category `Мнения -> Аналитика`, title retained. | Do not count PlayGround as clean public reach: authenticated page showed only `t.me/gigah_rush` body, public shell redirected to login, edit/delete controls were not visible. | Owner should manually find edit/delete in PlayGround UI or ask moderation/support to remove the malformed post, then repost with native media and body verified before final submit. |
| PR 65 six-agent RU execution | DTF + Telegram public, VK proposal sent | Report: `PRCampaign/PR_65_six_agent_ru_execution_2026-06-03.md`. New public DTF post: `https://dtf.ru/indie/5100874-gigahrush-obnovlenie-novaya-versiya-fiks-fps-i-brauzernyj-opyt`, `HTTP/2 200`, `subsite=Инди`, published `2026-06-03 19:05:23 BST`, MyIndie/direct/itch/Telegram links retained. Official Telegram post: `https://t.me/gigah_rush/19`, published `2026-06-03 18:08 UTC / 19:08 BST`, MyIndie/direct/itch links visible in Telegram. VK proposal sent to RavenStories `https://vk.com/club182531836` at `07:04 pm`. | VK is a private proposal, not a public post; Telegram shell does not expose full post text to curl; DTF may attract comments/moderation. | Monitor DTF comments/counters, Telegram views/comments if accessible, and RavenStories replies/publication. |
| PR 64 RU expansion | Research/queue update, no public post | Report: `PRCampaign/PR_64_ru_platform_expansion_architecture_positioning_2026-06-03.md`. Fresh/reconfirmed Russian routes: Indie Hub bot, ИНДИ.РФ / Indie Spotlight, GcUp, XGM, StopGame Blogs, PlayGround user posts, Kanobu Pub/editorial, Unity3D Book, gamedev events / Indie Varvar showcase and CoreMission. | No safe authenticated Telegram/VK/forum/Gmail composer in this environment; posting would require owner-side login or manual final submit. | Owner/next agent should execute one Telegram route first, then one devlog/forum route, using the ready copy and exact blockers in PR 64. |
| New public positioning | Added to durable docs | `PRCampaign/copy_pack_ru.md` now includes the web/anonymous browser/Samosbor-imageboard paragraph requested by owner. | Overuse can sound like manifesto spam if posted everywhere unchanged. | Use as the core paragraph in architecture/devlog pieces; keep release posts shorter. |
| MyIndie | Live / updated | Public HTML shows version `0.55`, update `02.06.2026`, `Web (HTML5)`, `RU, EN`, safe wording and clickable itch/direct/Telegram links. Visible counters: `123 / 19 / 255 / 0 / 0`, labels hidden in shell. | Counter labels are not visible from shell; do not mislabel them. | Keep as RU/CIS primary link and recheck labeled counters in browser/account when needed. |
| Direct build | Live | `https://gigahrush.bileter.workers.dev` returned `HTTP/2 200` at `2026-06-03 16:20 BST`. | Direct link has no discovery by itself. | Keep as frictionless playable fallback in every post where allowed. |
| itch.io | Live / updated / still noindex | Public fetch returned `HTTP/2 200`; HTML shows `Updated 03 June 2026 @ 15:31 UTC`, EN/RU metadata, HTML5 iframe and direct build link. HTML still has `noindex`. | Itch discovery/indexing remains blocked despite current page updates. | Use as EN mirror; continue support/indexing watch. |
| GameDev.ru release topic | Live | New release topic `https://gamedev.ru/projects/forum/?id=295635` returned `HTTP/2 200`; HTML contains MyIndie, direct build, itch and Telegram anchors. | Creating another GameDev topic now would be duplicate pressure. | Monitor replies/link retention only. |

## Good Signs

- Measured public attention now has a real lower-bound stack: DTF `3,987` views, ModDB `760` visits, Telegram visible `336` views, MyIndie `160` views and `350` web plays.
- MyIndie is showing usable player-proxy growth: from `255` web plays at the earlier June 3 snapshot to `350` web plays by 23:25 BST.
- Fake Portal is no longer just a pending/uncertain route; it is visibly public and searchable with GIGAH\|RUSH.
- Two new public owned/earned Russian surfaces went live in the same run: DTF and official Telegram.
- PR 68 added four more non-duplicate moderation/submission queues: DRZJ, DIGITALRAZOR, VK `GameDev по-русски` and MMOGOVNO.
- One VK group proposal was sent to a matching Russian-games/VK Play community, with the project's playable links and media.
- Perelesoq and Индикатор now have non-duplicate submitted-form status recorded from the interrupted run.
- CoreMission accepted a moderation-pending comment for the old `+1PR` indie-developer initiative.
- MyIndie now publicly exposes the updated 0.55 RU/EN Web page and visible counters have grown since the earlier June 1 public check.
- itch was updated again on 2026-06-03 and still has a working HTML5 iframe/direct-build link.
- GameDev.ru release topic remains publicly reachable with links intact.
- The next Russian push has a new non-duplicate angle: architecture, web accessibility, anonymous browser access and Самосбор culture.

## Bad Signs

- "All internet reach" and "all players" cannot be computed from public pages alone; the current honest player lower bound is MyIndie `350` web plays + `21` downloads, while direct Cloudflare and itch sessions remain uncounted publicly.
- Search discoverability is split: `GIGAH|RUSH` is clean enough for global/indexed traces, while `ГИГАХРУЩ` is noisy because of broader Samosbor lore and unrelated/adjacent results.
- PlayGround was attempted from an authenticated editor but produced a malformed/session-only post; repair/delete/repost is needed before using it as reach.
- Perelesoq, Индикатор and CoreMission are submissions, not guaranteed publications.
- DRZJ, DIGITALRAZOR, VK `GameDev по-русски` and MMOGOVNO are also queues/moderation, not live publications.
- VK `GameDev по-русски` screenshot upload was attempted but not verified, so it is currently text-only.
- GcUp, XGM, StopGame and PlayGround are still blocked by account activation/login/editor access.
- itch still has `noindex`.
- forum.indie remains unupdated in this run; future updates belong in the existing thread.
- Several A-priority routes are easy to duplicate badly; next agent must avoid posting the same wall of text everywhere.

## Next Actions

1. Add/inspect Cloudflare Worker analytics, itch dashboard analytics, MyIndie dashboard analytics and DTF referral/link metrics before claiming stronger player totals.
2. Monitor DRZJ, DIGITALRAZOR, VK `GameDev по-русски`, MMOGOVNO, Perelesoq, Индикатор and CoreMission before any follow-up.
3. Monitor new DTF post `5100874` for comments, moderation and link retention.
4. Repair or remove the malformed PlayGround post before reposting there.
5. Monitor Telegram post `https://t.me/gigah_rush/19` and RavenStories VK dialog/publication.
6. Send the next fresh Telegram proposal to `@KwagaGames_robot` with a clean GIF or contact sheet.
7. Use manual `Быть Инди` route or one VK Indie Space style community next; attach native media if the UI is reliable.
8. Complete GcUp account activation test/email, then create one GcUp feedback thread; if blocked, use XGM or StopGame only with the architecture angle.
