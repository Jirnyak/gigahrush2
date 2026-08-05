# GIGAH|RUSH Media KPI Report - 2026-06-02

## Snapshot

| Surface | Status | Signal | Risk | Action |
| --- | --- | --- | --- | --- |
| PR 63 RU public posts | GameDev.ru new topic live / others blocked | Report: `PRCampaign/PR_63_ru_public_posts_2026-06-02.md`. After owner clarified that GameDev needed a new post, a new GameDev.ru `Релизы` topic was created: `https://gamedev.ru/projects/forum/?id=295635`, message `#0`, timestamp `23:01, 2 июня 2026`; shell recheck returned `HTTP/2 200` and HTML contained MyIndie, direct build, itch and Telegram links. A prior same-turn reply in the old thread also exists at `m=6192509#m1`, but is not the final requested result. | DTF required unverified Yandex OAuth consent; VK Chrome was logged out; Telegram Web was logged out and native Telegram click/focus automation was blocked; forum.indie.ru was logged out. | Monitor new GameDev topic and old reply. Owner should manually unlock DTF/VK/Telegram/forum.indie using the prepared copy in PR 63. |
| PR 62 Y8 reply / outreach | Sent / private follow-up | Report: `PRCampaign/PR_62_y8_reply_and_outreach_2026-06-02.md`. Y8 reply sent from Tenevik Gmail after public checks confirmed the Cloudflare build returned `HTTP/2 200` and itch was updated on `02 June 2026 @ 18:11 UTC` with English description/language metadata. | Y8 has not approved upload yet; reply is private, not a public listing. | Wait for Y8 response. Do not upload or follow up until they reply. |
| New RU outreach | Sent by Gmail | GamerBay `news@gamerbay.ru`, BELONGPLAY `dm@belongplay.ru` and DUNGEN `info@dungen.ru` each produced Gmail `Message sent`. | Private emails may bounce or be ignored; quick duplicate follow-ups would be spammy. | Monitor Gmail replies/bounces and public mentions. |
| New EN/global outreach | Sent by Gmail | Warp Door `warpdoor@gmail.com`, Blue's News `news@bluesnews.com` and Indiepocalypse `indiepocalypse@gmail.com` each produced Gmail `Message sent`. | Indiepocalypse may need a downloadable/offline ZIP if selected; Blue's News usually does not reply; Warp Door is curator-fit but subjective. | Watch replies. If Indiepocalypse selects the game, prepare clean HTML5 ZIP/materials. |
| Direct build | Live | `https://gigahrush.bileter.workers.dev` returned `HTTP/2 200` on 2026-06-02. | Direct link has no discovery by itself. | Keep using it as the frictionless playable link. |
| itch.io | Live / updated / still noindex | Public page fetch showed English description, HTML5 embed, `Updated 02 June 2026 @ 18:11 UTC`, languages English/Russian and the direct build external link. | Still has `noindex`; itch discovery/indexing remains blocked. | Use as EN mirror. Continue support/indexing watch. |
| MyIndie | Live but not fresh-proof | Public fetch reached `https://myindie.ru/games/game/gigahrush`, but text appeared stale relative to current campaign facts. | Do not cite it as proof of the June 2 English/performance build update without a browser/account recheck. | Keep as RU/CIS primary link; recheck later. |
| Public posts | Not added in PR 62 | No public post, comment, vote, upload or portal final-click was made. | Public routes need owner/browser/account/captcha or have Reddit/duplicate risk. | Next public route should be one account-visible post: #PitchYaGame on June 5, HTML5GameDevs, GcUp/XGM, or official Tenevik Telegram/VK if composer is available. |

## Good Signs

- A real new Russian GameDev.ru release topic was posted after preview, with clickable links retained.
- Y8 got a professional correction/follow-up after their concrete content-team feedback.
- The live itch page now exposes English page copy and English/Russian language metadata.
- Six fresh non-duplicate recipients were contacted with the June 2 update hook.
- Indiepocalypse was submitted before its 2026-06-04 16:00 deadline.

## Bad Signs

- DTF, VK, Telegram and forum.indie.ru still depend on owner-side auth/desktop control before a safe post can be completed.
- Y8 approval is still pending; do not treat the game as accepted for y8.com.
- itch still has `noindex`.
- MyIndie public fetch may lag or show stale fields, so fresh update claims should use Cloudflare/itch facts only.

## Next Actions

1. Watch Gmail for replies/bounces from Y8, GamerBay, BELONGPLAY, DUNGEN, Warp Door, Blue's News and Indiepocalypse.
2. If Y8 approves the fixed build, prepare a clean Y8-ready HTML5/WebGL ZIP/package and metadata.
3. Use PR 63 copy to unlock one manual public post path at a time: DTF after OAuth, Telegram after focusing the admin composer, VK after login, or forum.indie after login.
4. Do not duplicate the June 2 recipients or the June 1 wave.
