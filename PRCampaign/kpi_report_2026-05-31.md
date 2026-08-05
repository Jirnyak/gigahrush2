# GIGAH|RUSH Media KPI Report - 2026-05-31

## Snapshot

| Surface | Status | Signal | Risk | Action |
| --- | --- | --- | --- | --- |
| PR 53 Telegram outbound | 3 confirmed sends | VGTimes feedback bot received one RU news-tip at 06:54 BST. App2Top Assistant received category `Хочу опубликовать материал на App2Top` at 07:00 and a Tenevik Games material description at 07:01. Мракопедия feedback bot received a permission-first horror/lore proposal at 12:32. Report: `PRCampaign/PR_53_telegram_outbound_posts_2026-05-31.md`. | Repeating the same bot pitches today would look like spam. Current Telegram session also lacks `@gigah_rush` admin composer. | Watch bot replies. Do not duplicate VGTimes/App2Top/Мракопедия; unlock owned-channel admin rights; prepare media before IXBT. |
| PR 52 six-agent global queue | Ready / no public action | Five read-only subagents returned RU/CIS portals, EN HTML5 portals, RU social/community, EN press and Reddit/forum safety queues. Local monitoring checks covered itch/MyIndie/direct/DTF/Pikabu/Gamin/ModDB. Report: `PRCampaign/PR_52_six_agent_global_distribution_2026-05-31.md`. | Treating the queue as a blast list would create spam/moderation risk. | Pick one lane per session and record exact outcomes. |
| itch.io | Still noindex | `https://tenevik.itch.io/gigahrush` returned `200`, but public HTML still contains `<meta content="noindex" name="robots"/>`; public HTML shows updated `30 May 2026 @ 05:55 UTC`. | Discovery remains limited; devlog permalink was already under moderation/review symptoms in PR 51. | Wait for support response and recheck noindex/search. No page recreation or duplicate project. |
| MyIndie | Live / RU primary | `https://myindie.ru/games/game/gigahrush` returned `200`. | Metrics/version can drift by cache/auth state. | Use as primary RU/CIS game link; clean browser recheck before replacing metric baselines. |
| Direct build | Live | `https://gigahrush.bileter.workers.dev` returned `200`. | Direct link has no platform discovery by itself. | Use as fallback playable link where direct browser builds are allowed. |
| DTF update comment | Live by shell | `https://dtf.ru/indie/5086991-gigahrusha-novaya-versiya-myindie-i-kadry-iz-samosbora?comment=64892114` returned `200`. | Another DTF post/comment too soon is duplicate risk. | Monitor and answer concrete feedback only. |
| Pikabu correction comment | Live by shell / noindex header | `https://pikabu.ru/story/delayu_brauzernyiy_survival_horror_pro_samosbor_alife_i_vyilazki_v_betonnoy_strukture_14010914?cid=393817860` returned `200`, with `x-robots-tag: noindex`. | Good community surface but weak search surface; another post before Pikabu Games catalog is risky. | Monitor comments/link retention; no fresh Pikabu post until catalog acceptance or distinct devlog angle. |
| Gamin.me | Live by shell | `https://gamin.me/posts/23350-gigahrusch-brauzernyy-survival-horror-pro-samosbor-nuzhna-proverka-pervyh-10-minut` returned `200`. | Standalone game listing can be treated as self-promo without article context. | Monitor post; use article as prerequisite/context before any game-page listing. |
| Habr Sandbox | Browser-only monitor | Shell returned QRATOR `403`; PR 50 browser state remains `Ожидает модерации` at `https://habr.com/ru/sandbox/287036/`. | Must not duplicate Habr while pending. | Browser/session monitor; record exact moderation result. |
| ModDB | Public indexed discovery signal | Web search/open found `https://www.moddb.com/games/gigahrush` under `TENEVIK`, Early Access May 23, 2026, with direct/itch/Telegram links, 1 follow, 2 articles, rank `790 of 77,699`, `647` visits / `11 today`. | DBolical old-account/IndieDB/ModDB surfaces can confuse ownership if duplicated. | Monitor visits/watchers/article authorization; do not create duplicate pages. |
| Reddit | Hold | Shell returned Reddit `403`; previous state remains one live `r/playmygame` post, pending `r/PBBG` captcha form and recent `BAD_CAPTCHA` risk. | More Reddit now risks account filtering/removals. | No Reddit submissions through at least 2026-06-03 except owner manual captcha/checkpoint clearing. |
| Fandom | Browser/API monitor required | Shell hit Cloudflare challenge for EN Fandom. | Shell can produce false negatives. | Use browser/API extlink checks for link retention. |

## Good Signs

- MyIndie, direct build, DTF, Pikabu and Gamin are still reachable from public shell checks.
- ModDB is visible in general web search and has measurable public visits/watchers/articles.
- Fresh Telegram outreach is no longer only queued: VGTimes, App2Top and Мракопедия now have direct bot pitches with developer disclosure and MyIndie/direct/itch/Telegram links where appropriate.
- There is now a broad but separated queue for RU/CIS, EN press, portal builds and forum safety, avoiding stale repeat-posting.
- Current copy rules keep MyIndie first for RU/CIS and preserve public illusion wording: `безграничная бетонная структура` / `unbounded concrete megastructure`.

## Bad Signs

- itch.io still has `noindex`; support/manual review is still the effective route.
- Habr, Reddit and Fandom cannot be reliably assessed from shell because of QRATOR/403/Cloudflare; future agents need browser/API checks.
- Reddit remains unsafe after `BAD_CAPTCHA`, recent removals, one live post and one pending captcha form.
- `@gigah_rush` still cannot be posted to from the current Telegram session; SIKRI/Indie HUB bot attempts stalled on bot UI/start/language gates in this pass.
- Several high-reach portals are technical/product tasks, not PR tasks: they require SDKs, legal terms, iframe QA, external-link cleanup and English onboarding.

## Next Actions

1. Monitor itch support/Gmail and Habr Sandbox moderation; record exact response text.
2. Prepare IXBT-ready Russian screenshots and a VK Video/YouTube trailer.
3. Choose one non-Reddit outreach lane not already used today: Индикатор/IXBT only after media prep, or one EN horror press target such as Bloody Disgusting/GameLuster/Buried Treasure.
4. Keep Reddit hold through at least 2026-06-03.
5. Scope portal-build tasks separately for Яндекс Игры, CrazyGames, Playgama, GamePix/GameDistribution and VK Play.
