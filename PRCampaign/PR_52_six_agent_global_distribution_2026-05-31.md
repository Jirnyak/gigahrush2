# PR 52 - Six-Agent Global Distribution Queue

Date: 2026-05-31.

Time window: 2026-05-31 06:25-06:45 BST.

Scope: owner asked to continue broad PR/distribution work with six subagents for Russian and English visibility. Five read-only subagents completed: RU/CIS portals, EN HTML5 portals, RU social/community, EN press/curators, and Reddit/forum safety. The first monitoring/indexing subagent failed on remote compaction; a replacement was spawned but did not return before this report. Local public checks covered the monitoring lane enough for this pass.

No public post, email, form submission, bot submission, upload, vote, rating, comment, modmail, paid request or final-click action was made. This report is a queue and safety map, not permission to blast all targets.

## Current Public Checks

- `https://tenevik.itch.io/gigahrush` still returns `200 OK` and still contains `<meta content="noindex" name="robots"/>`; public HTML shows updated `30 May 2026 @ 05:55 UTC`, 14 media items, direct build and Telegram links.
- `https://myindie.ru/games/game/gigahrush` returned `200`; keep it as RU/CIS primary.
- `https://gigahrush.bileter.workers.dev` returned `200`; keep it as direct playable build.
- DTF update URL `https://dtf.ru/indie/5086991-gigahrusha-novaya-versiya-myindie-i-kadry-iz-samosbora?comment=64892114` returned `200`.
- Pikabu correction URL `https://pikabu.ru/story/delayu_brauzernyiy_survival_horror_pro_samosbor_alife_i_vyilazki_v_betonnoy_strukture_14010914?cid=393817860` returned `200`, but shell headers also showed `x-robots-tag: noindex`; treat it as community traffic, not search-index surface.
- Gamin post `https://gamin.me/posts/23350-gigahrusch-brauzernyy-survival-horror-pro-samosbor-nuzhna-proverka-pervyh-10-minut` returned `200`.
- Habr Sandbox URL `https://habr.com/ru/sandbox/287036/` returned `403` through shell/QRATOR; the latest reliable state remains the browser-verified `Ожидает модерации` from PR 50.
- Reddit `r/playmygame` shell recheck returned Reddit `403`; use browser/public JSON only later. Do not assume removal or survival from shell alone.
- Web search/open found the ModDB mirror page `https://www.moddb.com/games/gigahrush` public under `TENEVIK`, Early Access May 23, 2026, with homepage/direct/Telegram links, 1 follow, 2 articles, rank `790 of 77,699`, and `647` visits / `11 today` at check time. This is a live discovery signal; monitor it, do not duplicate DBolical pages.
- Fandom shell fetch hit Cloudflare challenge; use browser/API checks for link retention instead of shell HTML.

Safe monitoring commands:

```bash
curl -L -s https://tenevik.itch.io/gigahrush | rg -i "robots|noindex|Updated|GIGAH"
curl -I -L -s https://myindie.ru/games/game/gigahrush
curl -I -L -s https://gigahrush.bileter.workers.dev
curl -I -L -s 'https://dtf.ru/indie/5086991-gigahrusha-novaya-versiya-myindie-i-kadry-iz-samosbora?comment=64892114'
curl -I -L -s 'https://pikabu.ru/story/delayu_brauzernyiy_survival_horror_pro_samosbor_alife_i_vyilazki_v_betonnoy_strukture_14010914?cid=393817860'
curl -I -L -s https://gamin.me/posts/23350-gigahrusch-brauzernyy-survival-horror-pro-samosbor-nuzhna-proverka-pervyh-10-minut
```

## Immediate Priority

1. Watch Gmail for itch support response and Habr moderation result; record exact text before changing anything.
2. Prepare 3-5 Russian screenshots plus a VK Video or YouTube trailer before restarting IXBT / НАШЫ ИГРЫ.
3. Keep Reddit on hold through at least 2026-06-03, except owner-side manual captcha/checkpoint clearing.
4. Choose only one outbound lane per session: RU community, EN horror press, or one portal fit-check. Do not batch all lanes.
5. Treat Яндекс Игры, VK Play, Playgama, CrazyGames, Poki, GamePix and GameDistribution as portal-build tasks, not quick PR submissions.

## RU/CIS Portal And Store Queue

| Priority | Surface | URL / contact | Status / blocker | Next safe action |
| --- | --- | --- | --- | --- |
| A | Пикабу Игры / GamePush | `https://gamepush.com/panel/projects/28314/distribution/` | Already in progress; owner `My Company` legal data, sandbox/cloud-save/mobile QA and moderation remain. | Owner completes legal data only if proceeding; no public announcement until catalog URL exists. |
| A | Яндекс Игры | `https://games.yandex.com/console` | Requires separate Yandex portal bridge: SDK ready event, pause/audio, save policy, no external CTAs. | Scope `portal=yandex` build task; no upload now. |
| A | VK Play Developer | `https://developers.vkplay.ru/` | Owner developer/legal verification and iframe QA. | Owner registers/validates; create draft only after rules/account check. |
| B | ИграйТут | `https://igraytut.ru/pages/publishing-rules` | Account/form/media/rating and artifact QA required. | Verify form and package rules; preview before submit. |
| B | IndieHub | `https://indiehub.ru/game/add` | Add path previously broken/support-blocked. | Ask support Telegram for current add-game route from Tenevik identity. |
| B | DevTribe | `https://devtribe.ru/p/games-dev/add` | Tenevik email/account gate and stale feed risk. | Confirm email, then unique dev diary; do not copy DTF. |
| C | InstGame | `https://instgame.com/` | Fit/content policy unknown. | Create draft only after policy check and media pack. |
| C | Playgama | `https://playgama.com/developers` | Bridge SDK required. | Separate SDK task; no current-build submit. |

## RU Social And Community Queue

| Priority | Surface | URL / contact | Route | Next safe action |
| --- | --- | --- | --- | --- |
| A | НАШЫ ИГРЫ / IXBT | `https://t.me/ixbtnashy`, `@ixbtgamesbot` | Bot application. | Prepare RU screenshots and VK Video/YouTube trailer; restart cleanly after earlier incomplete flow. |
| A | Индикатор / `#РелизыАвторов` | `https://t.me/IndikatorOnline`, `https://forms.gle/ZomwE6hnHaPyd7vQ9` | Public author-release form. | Fill only after media pack is selected; MyIndie as game URL, Telegram as project/contact. |
| A | Indie Spotlight chat/forum | `https://t.me/indiespotlight`, `https://t.me/indieSpotChat` | Feedback/chat route. | Use feedback route only; do not duplicate the already sent VK/admin pitch. |
| A | App2Top TG | `https://t.me/app2top_gamedev_breaking`, `@App2Top_bot` | News/cooperation bot. | Test in native Telegram under Tenevik account; technical WebGL angle. |
| B | VGTimes TG | `https://t.me/vgtimes`, `@vgtimes_feedback_bot` | News-tip bot. | One GIF-backed news-tip pitch; no chat drop. |
| B | Мракопедия | `https://t.me/mrakopedia`, `@mrakopedia_feedback_bot` | Permission-first horror/lore proposal. | Ask if a playable-project note fits before sending links. |
| B | VK GameDev по-русски | `https://vk.com/gamedevinrussian` | Proposed post/message after logged-in check. | Technical devlog angle, not player ad. |
| B | VK RPG Horror Games | `https://vk.com/rpg_horror_games` | Rules/topic check first. | Ask whether non-RPGMaker browser horror is acceptable. |
| C | Ужасариум | `https://t.me/uzhasarium`, `@uzhasarium_adm` | Likely paid/cooperation. | Ask terms/fit with one GIF; no free-editorial assumption. |
| Hold | DTF / Pikabu | Existing live surfaces. | Recent posts/comments already exist. | Monitor and answer concrete feedback only; no duplicate post now. |

Recommended RU copy baseline:

```text
ГИГАХРУЩ - бесплатный браузерный survival horror / ARPG shooter про вылазки в безграничную бетонную структуру.
```

## EN Press And Curator Queue

Do not send all of these in one sitting. Pick one or two, tailor copy and wait at least 7-10 business days before follow-up unless they reply.

| Priority | Target | Contact | Angle |
| --- | --- | --- | --- |
| A | Bloody Disgusting | `https://bloody-disgusting.com/contact-us/` | Horror-first pitch with one GIF/contact sheet. |
| A | GameLuster | `https://gameluster.com/contact/` | Editorial / press release route for no-install WebGL survival horror. |
| A | Buried Treasure | `https://buried-treasure.org/contact/` / `@game_treasure` | Overlooked strange free browser horror. |
| A | Dread Central | `https://www.dreadcentral.com/contact-us/` | Horror-news pitch with content note. |
| A | Pantaloon | `pitch@pantaloon.io` | Weird newsletter discovery, not normal press release. |
| B | Indie Hive | `admin@indie-hive.com` | Review/interview consideration. |
| B | Umigari | `https://www.umigari.com/contact` | Horror discovery submission with age guidance and embed permission question. |
| B | Horror Geek Life | `https://www.horrorgeeklife.com/about-us/` | Review-content submission. |
| B | Horror Obsessive | `info@horrorobsessive.com` | Indie-gaming feature/impressions. |
| C | Rue Morgue | `https://rue-morgue.com/contact-us/` | High-bar horror culture pitch; wait for tighter media/trailer. |
| C | SurvivalHorrors.com / JMMREVIEW | `https://survivalhorrors.com/about-us` | Private/social fit-check for upcoming/recent survival horror list. |
| C | Horror Press | `contact@horrorpress.com` | Games-review/news tip. |

EN wording must use `unbounded concrete megastructure`, not implementation geometry.

## EN Portal / HTML5 Distribution Queue

| Priority | Surface | URL / contact | Blocker | Next safe action |
| --- | --- | --- | --- | --- |
| A | CrazyGames | `https://developer.crazygames.com/` | Portal QA; Basic Launch may avoid SDK, Full Launch needs SDK; external CTAs must be removed. | Prepare `portal=crazygames` QA build and iframe/mobile/perf checks. |
| A | Playgama | `https://playgama.com/developers` | SDK mandatory. | Scope Playgama Bridge adapter. |
| A | GamePix | `https://partners.gamepix.com/developers` | Account/legal/payment/SDK. | Owner reviews rev-share/legal terms first. |
| A | GameDistribution | `https://gamedistribution.com/developers/` | English product completeness, SDK/ad placement, legal terms. | Create GD-specific QA checklist; no current-build submit. |
| B | Y8 | `https://www.y8.com/upload` | Login, rights, content risk, outlink limits. | Content-risk check before upload. |
| B | Addicting Games | `https://www.addictinggames.com/about/upload` | User submission agreement; review-only flow. | Owner approval, then one test-link submission. |
| B | Vibenture | `https://vibenture.com/submit-game` | Thumbnail/trailer/social fields, AI disclosure, pricing/IAP fields. | Prepare metadata; no final submit without owner. |
| B | Lagged | `https://lagged.dev` | Invite code and SDK/ad expectations. | Email support for fit/invite only. |
| C | Poki | `https://developers.poki.com/` | Curated, SDK/events, strict size/perf, external requests blocked. | Future target after English onboarding and size/perf pass. |
| C | GameTwiz | `https://www.gametwiz.com/developers` | 50 MB, responsive, no external dependencies/API calls, violence policy risk. | Ask support whether horror violence passes. |
| C | GameFlare Distribution | `https://distribution.gameflare.com` | Account/rev-share unclear. | Fit-check email before upload. |
| C | Famobi / HTML5Games | `https://famobi.com/developers`, `sales@famobi.com` | Casual/licensing fit weak. | Low-priority after trailer/onboarding. |

Follow-up only: Kongregate application is already submitted; Newgrounds remains blocked until correct account/support and playable preview are fixed.

## Reddit / Forum Safety Queue

Reddit remains hold-only through at least 2026-06-03. Current state: recent Tenevik removals, `BAD_CAPTCHA`, one live `r/playmygame` post from 2026-05-29, and one pending `r/PBBG` captcha form. Do not post, crosspost, modmail, comment with links, profile-promote, ask for votes or revive old deleted threads.

After owner manually clears captcha/checkpoint, the safe sequence is:

1. Make 3-5 normal no-link comments over several days.
2. Test one Reddit profile-native gameplay media post with no title/body links.
3. Wait 24 hours and check logged-out/JSON visibility.
4. If it survives, add one factual link comment only if useful, then wait 72 hours.
5. Then pick one subreddit only; if removed or captcha returns, stop 14 days and record the exact message.

Safer non-Reddit routes before that:

- Existing `forum.indie.ru` thread: real build update only, no duplicate topic.
- Existing GameDev.ru thread: reply only to real feedback or meaningful build note.
- Lemmy.World `indiegamedev`: English feedback post, one playable link, no Telegram body link.
- itch.io Devlogs board: progress/devlog continuation with screenshots, not a link dump.
- Hacker News Show HN: technical playable post only when owner can answer questions for hours.
- MakeWebGames `Game Projects`: technical project post after account/profile context.

Future Reddit candidates after recovery: `r/gameDevTesting`, `r/playtesters`, `r/alphaandbetausers`, `r/gamedevscreens`, `r/DestroyMyGame`. Hold-only: `r/WebGames`, `r/Games Indie Sunday`, pending `r/PBBG`.

## Owner Blockers

- `@gigah_rush` admin compose rights are still required for owned Telegram posting.
- IXBT needs 3-5 Russian screenshots and a YouTube/VK Video trailer.
- GamePush/Pikabu Games needs owner `My Company` data and QA before any public catalog announcement.
- Habr Sandbox and itch support need monitoring, not duplicate submissions.
- Portal/store work needs owner acceptance of legal/revenue/SDK terms per target.
- Newgrounds needs support/account/upload-size fix before any public link.

## Decisions

- Keep MyIndie first in Russian copy while itch remains `noindex`.
- Keep itch as EN/mirror, but do not rely on itch search discovery until support/manual review changes the robots state.
- Treat ModDB as a live indexed discovery surface and monitor visits/articles/watchers; do not create duplicate DBolical entries.
- Keep Telegram in public copy only where the platform allows social/contact links. If only one body link is allowed, use MyIndie/direct/itch as the playable link and put Telegram in profile/contact/native social field.
- Public copy must not reveal map dimensions or topology. Use `безграничная бетонная структура` / `unbounded concrete megastructure`.
