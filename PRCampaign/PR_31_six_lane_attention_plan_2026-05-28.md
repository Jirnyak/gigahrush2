# PR 31 - Six-Lane Attention / Reddit / AI Visibility Pass

Date: 2026-05-28.

Time window: 2026-05-28 03:45-04:02 UTC / 04:45-05:02 BST.

Scope: owner asked for more publicity on Reddit, other sites, AI/Grok visibility and six agents after the new release/Pikabu Games submission. Six read-only lanes ran in parallel: Reddit, RU/CIS communities, EN media, portals, AI/search/Grok, and KPI monitoring.

No public post, email, form submission, vote, rating, modmail, support request, portal upload or final click was made in this pass. The reason is practical, not passive: current logs already contain a fresh Reddit burst, Pikabu Games is already in GamePush moderation, several surfaces are pending/moderated, and new posts need platform-specific media/link handling rather than a blind repost.

## Current Facts Found

| Surface | Fresh status | Action |
| --- | --- | --- |
| MyIndie | Public RU/CIS page is live. Current public counters found by the monitoring lane: `20` views, `3` downloads, `26` web launches, `0` comments, version `0.3.0`, updated `2026-05-28`. | Use as the first RU/CIS link. Monitor comments and web launch. |
| Direct build | `https://gigahrush.bileter.workers.dev/` returns live game HTML with no `noindex`. | Keep as frictionless playable fallback and EN Reddit/direct-play link. |
| itch.io | Live EN/mirror page, but public HTML still has `noindex`. | Do not use as main search landing until support/indexing changes. |
| DTF follow-up | Live and repaired. Current counters: `2` comments, `1` favorite, `661` views, `74` hits, `738` total. | Monitor and answer concrete comments only. No duplicate DTF post or link bump. |
| DTF old post | Still live proof point: `13` comments, `10` favorites, `7` reactions, `2 138` views, `569` hits, `2 737` total. | Monitoring only. |
| Pikabu Games / GamePush | Project `ГИГАХРУЩ` / `28314` exists after PR 30. No public Pikabu catalog URL found. | Do not duplicate-submit. Monitor moderation and then run iframe/cloud-save QA. |
| Pikabu live post | HTTP `200`, correction comment id `393697666` exists in static HTML, but MyIndie text needs browser/AJAX retention check. | Do not add a second correction. Recheck visible comment only. |
| GameDev.ru / forum.indie.ru | Both live and show `TENEVIK`, `ГИГАХРУЩ` and MyIndie in public HTML. | Monitor replies/moderation. No duplicate threads. |
| GameDev.net | Previously live in authenticated Chrome. Public fetch still Cloudflare-blocked. | Clean-browser verification only; no duplicate project. |
| HTML5GameDevs | Still not public-confirmed; public fetch is Cloudflare/challenge and web search did not find the topic. | Monitor moderator approval. No repost. |

## Reddit Lane

Existing Reddit posts remain monitoring-only:

- r/playmygame - live, do not repost.
- r/PBBG - live, answer only PBBG-fit questions about single-player/local persistence.
- r/WebGames - live direct-link post, do not repost.
- r/Games Indie Sunday - live, high-risk large subreddit, do not repeat outside allowed cadence.
- r/IndieDev - removed by moderator/automoderation, no immediate repost.
- PBBG.com - directory review pending, not a Reddit resubmit target.

Best single new Reddit candidate: `r/SurvivalGaming`. Current subreddit rules allow indie/AA developers to promote or request feedback up to once per week if the post is high-effort/informative, includes the game name in the title, and includes a store/play link in the post or top-level comment. The rules also define survival games around hunger/thirst or equivalent body systems and reject low-effort/clickbait posts.

Recommended Reddit angle:

```txt
Post-release field report: I shipped GIGAH|RUSH, a free browser survival-horror survival game where preparation, hunger/thirst pressure, A-Life NPCs, factions and Samosbor disasters matter more than raw shooting. I need feedback on whether the first expedition is readable.
```

Media/link plan:

- Native media first: `01_hero_gif_hell_blinking_eyes.gif` or `02_gif_underhell_maronary_samosbor_loop.gif`.
- Top-level comment only if needed: direct build first, itch mirror second.
- Do not mention Telegram/Game Jolt/IndieDB.
- Use `unbounded concrete megastructure`, not internal map/topology facts.
- One Reddit post maximum in this wave.

Other Reddit candidates:

- `r/IndieGaming` - possible later, but requires account history, 1 submission per 2 weeks, original content, no store-page dump, and GenAI disclosure if applicable.
- `r/DestroyMyGame` - only as a critique/video post, not an announcement.
- `r/SurvivalHorror` - only after modmail/approval.
- `r/GameDevelopment` - only educational/postmortem, not release promo.
- `r/proceduralgeneration` - only technical/media angle, no "play my game" title.
- `r/indiegames` - hold; high risk around native media, links and GenAI rules.

Sources checked:

- `https://www.reddit.com/r/SurvivalGaming/about/rules.json`
- `https://www.reddit.com/r/IndieGaming/about/rules.json`
- `https://www.reddit.com/r/DestroyMyGame/about/rules.json`

## EN Media Lane

Recommended batch if sending is explicitly chosen from a Tenevik-owned mail/account: no more than three tailored messages in one sitting.

| Priority | Target | Contact path | Pitch angle | Notes |
| --- | --- | --- | --- | --- |
| 1 | Big Boss Battle | `editors@bigbossbattle.com` from `https://bigbossbattle.com/contact/` | Free playable browser survival horror with 1 GIF, contact sheet, direct build and itch. | Good first general indie-media pitch. Do not use the sales contact without paid-placement approval. |
| 2 | Rely on Horror | Team/editor contacts from `https://www.relyonhorror.com/in-depth/` | Horror-first: Samosbor, hostile expeditions, body-horror tone, 10-15 minute first route, content warning. | Do not send to advertising/Playwire. |
| 3 | The Indie Informer | Contact form at `https://theindieinformer.com/contact/` | Indie-first: browser horror life-sim with expeditions, factions and persistent consequences. | Short form message, no heavy attachments. |

Next after the first batch:

- Dread Central - contact/news form at `https://www.dreadcentral.com/contact-us/`.
- GameSpew, GameGrin, Best Indie Games/ClemmyGames - useful but lower than the first three.
- Get Indie Gaming and SplatterCatGaming - only through official YouTube "View email address" and only if the build/onboarding is ready for a 25-35 minute first-look video.

No fast follow-up yet to Alpha Beta Gamer, Free Game Planet, Games Pending, Indie Games Plus, HorrorFam, Indie Game Buzz or Into Indie Games. Those were contacted on 2026-05-23 or 2026-05-24 and need normal follow-up spacing.

## RU/CIS Lane

Good candidates, but not blind-publication targets:

| Surface | Current status | Safe next action |
| --- | --- | --- |
| DevTribe | Strong fit, still blocked by unconfirmed `tenevik.games@gmail.com` and `403` on create routes. | Confirm email and open `/p/games-dev/add`; publish only a unique diary, not DTF copy. |
| Indie Spotlight / INDI.RF | Good editorial/Telegram proposal path. | From Tenevik Telegram identity, ask whether a free editorial proposal is appropriate; send MyIndie, direct build, 1 GIF and contact sheet. |
| СИКРИ | Low-risk small indie proposal path through bot/Telegram. | Submit only from Tenevik identity with a feedback-first pitch. |
| ИграйТут | Best quick RU HTML5 upload scout. | Only after fresh ZIP/media/preflight and owner approval; needs icon/cover/screenshots and rating/content notes. |
| VK Play | Browser project can be a non-public test iframe after registration. | Owner legal/tax/18+ developer registration first. |
| Яндекс Игры | Best long-term RU/CIS portal, not a PR post. | Separate `portal=yandex` SDK/legal/QA task. |
| Habr / vc.ru | Only original case/tech article. | Write technical/process article, not a promo repost. |

Already live or not safe to duplicate: DTF, GameDev.ru, forum.indie.ru, Pikabu ordinary post, Pikabu Games submission, StopGame blog, IndieHub.

## Portal Lane

Monitor first:

- Pikabu Games/GamePush `28314` - wait for moderation status or public URL; then verify launch, console, pause/audio, mobile scaling and GamePush `progress` cloud save.
- PBBG.com - still pending directory review.
- GamHub, Fake Portal, FreeZonePlay - previous submit/contact paths not public yet.
- Gamemoor - wait for reply to the 2026-05-27 support request.
- Kongregate - wait for developer approval.
- Newgrounds - still not an active link due RIP/project-access/upload blocker.
- IndieDB/ModDB - monitor; do not reinforce old identity traces until fully clean.

Next new portal candidate: ИграйТут, but only after owner approval and artifact/media preflight. This pass did not submit there.

## AI / Search / Grok Lane

The main fix is canonical public clarity, not "AI spam":

- Canonical RU/CIS: MyIndie.
- Frictionless playable: direct build.
- EN/mirror: itch, but not search-primary while `noindex` persists.
- Author identity: Tenevik Games. Do not reinforce old `jirnyak` creator traces in new public copy.

Direct build SEO work to schedule later:

- Real `robots.txt`, not game HTML.
- Real `sitemap.xml`, not game HTML.
- Meta description, OG/Twitter image, canonical URL.
- Small visible public about/FAQ text or an `/about` page.
- JSON-LD `VideoGame`/`SoftwareApplication` only for visible factual claims.

Grok/X:

- There is no useful "submit to Grok" flow. X documentation says Grok can search public X posts and the real-time web.
- The practical owner action is one official public X/Tenevik Games profile and one pinned media-first post with direct build or MyIndie, 1-2 hashtags, and developer disclosure.
- Do not use protected/private posts, hashtag stuffing, fake engagement or mention spam.

Sources checked:

- `https://help.x.com/en/using-x/about-grok`
- `https://help.x.com/en/using-x/how-to-use-hashtags`
- `https://developers.google.com/search/docs/appearance/ai-features`
- `https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl`

## Recommended Next Actions

1. Monitor GamePush project `28314`. If a preview/public URL appears, run iframe QA before announcing Pikabu Games as public.
2. If outbound media is allowed from the Tenevik account, send exactly three tailored EN pitches: Big Boss Battle, Rely on Horror, The Indie Informer. Record each send with date, route, subject and media links.
3. If doing Reddit today, do only one native-media post on `r/SurvivalGaming`, not a broad Reddit burst.
4. Prepare a one-post X/Grok owner-thread only from a public Tenevik Games account.
5. Schedule direct-build SEO work as a product task: robots/sitemap/meta/FAQ/JSON-LD.
6. Prepare ИграйТут only after artifact/media/legal preflight and owner approval.

## Copy Blocks

### r/SurvivalGaming Draft Core

```md
I released GIGAH|RUSH, a free browser survival-horror survival game, and I need feedback on whether the first expedition is readable.

The loop is: prepare food, water, ammo and medicine in a safer living area; take a lead or contract; enter hostile floors; trade, fight, loot or retreat; survive Samosbor events; return with consequences.

It is single-player, playable in browser, and built around local persistence, A-Life NPCs, factions, quests and survival pressure inside an unbounded concrete megastructure.

I am the developer. I am looking for blunt feedback on the first 10-15 minutes: controls, first goal clarity, survival pressure, UI readability and whether the expedition prep makes sense.
```

### EN Media Pitch Core

```md
Subject: GIGAH|RUSH - free browser survival horror / ARPG shooter by Tenevik Games

Hi,

I am the developer of GIGAH|RUSH, a free browser survival horror / ARPG shooter about preparing expeditions into an unbounded concrete megastructure.

The current build is playable directly in the browser. The first loop is preparation, a short expedition, trade or combat, quest leads, and surviving Samosbor events while A-Life NPCs, factions and persistent consequences keep changing the run.

Playable build: https://gigahrush.bileter.workers.dev
itch mirror: https://tenevik.itch.io/gigahrush

Media: one gameplay GIF plus a 3x3 contact sheet are available from the current press pack.

If this fits your indie/horror coverage, I can send a tighter first-10-minutes route and additional media links.

Tenevik Games
```

### X / Grok Draft Core

```md
GIGAH|RUSH / ГИГАХРУЩ is my free browser survival horror / ARPG shooter about preparing expeditions into an unbounded concrete megastructure.

Trade, fight, follow leads, survive Samosbor, and come back with consequences.

Play: https://gigahrush.bileter.workers.dev
#indiegames #survivalhorror
```

## No-Go

- No duplicate Reddit burst.
- No r/IndieDev repost.
- No DTF/Pikabu/GameDev/forum duplicate post.
- No second Pikabu correction comment.
- No claim that Pikabu Games is public before a catalog URL and iframe QA.
- No old `jirnyak` author identity in new copy.
- No fake reviews, fake player counts, vote requests, link stuffing, AI prompt-injection pages or hidden keyword stuffing.
- No public implementation geometry/topology details.
