# PR 64 - RU Platform Expansion / Architecture Positioning

Date: 2026-06-03.

Window: 16:00-17:25 BST.

Owner instruction: continue PR campaign because reach is growing; search broadly for Russian platforms; publish where possible; when not possible, leave exact links, login/blocker notes and next-agent instructions. Owner also supplied a good project-positioning comment and emphasized the final paragraph about web, anonymous access and Самосбор/imageboard culture as the new public influence angle.

No public post, registration, login action, form submit, email, private message, upload, vote, like, captcha action, payment, paid-ad request or moderation evasion was made in this pass. Current environment has web/shell access but no safe authenticated Telegram/VK/DTF/forum/Gmail composer. All public-platform actions below require owner-side account access or a real editor/form session.

## Public Surface Recheck

| Surface | Result | Evidence | Next action |
| --- | --- | --- | --- |
| MyIndie | Live and current | `https://myindie.ru/games/game/gigahrush` public HTML shows `Web version`, version `0.55`, `Web (HTML5)`, `RU, EN`, publication `26.05.2026`, update `02.06.2026`, safe wording `безграничная бетонная структура`, clickable itch/direct/Telegram links and visible counters `123 / 19 / 255 / 0 / 0` with labels not exposed in shell. | Keep as RU/CIS primary link. Do not infer exact counter labels from shell; browser/account can label them later. |
| Direct build | Live | `curl -I -L https://gigahrush.bileter.workers.dev` returned `HTTP/2 200` at `2026-06-03 16:20 BST`. | Use as frictionless playable link in every pitch where direct links are allowed. |
| itch.io | Live, updated, still noindex | `curl -I -L https://tenevik.itch.io/gigahrush` returned `HTTP/2 200`; HTML still has `<meta content="noindex" name="robots"/>`. Public HTML shows `Updated 03 June 2026 @ 15:31 UTC`, HTML5, EN/RU languages, direct build link and embedded game iframe. | Use as EN mirror, but keep indexing support watch. |
| GameDev.ru release topic | Live | `curl -I -L 'https://gamedev.ru/projects/forum/?id=295635'` returned `HTTP/2 200`; HTML still contains MyIndie, direct build, itch and Telegram anchors. | Monitor replies/moderation/link retention. Do not create another GameDev topic without a new release hook. |

## New Positioning Rule

Use the owner-supplied framing as a reusable public angle, especially for architecture/devlog posts:

```text
Мы используем web для мультиплатформенности и максимально широкой доступности игры. Поскольку Самосбор как культурный феномен родился в интернете и анонимных онлайн-сообществах, ГИГАХРУЩ продолжает эту традицию: это бесплатный, анонимный браузерный опыт, а не закрытый лаунчер или витрина с барьерами входа. Новые игроки могут через ГИГАХРУЩ прикоснуться к хаотичной культуре анонимных имиджборд и мифологии Самосбора без установки, регистрации и предварительной подготовки.
```

Keep the public wording as `безграничная бетонная структура` / `безграничная структура`. Do not publish implementation geometry such as map size or torus topology. It is fine to talk about WebGL/canvas raycaster, no runtime engine/dependencies, active-floor simulation and frozen off-floor population as architecture decisions when the platform is developer-facing and the post is a real technical/devlog article rather than store copy.

## Fresh RU Targets Found / Reconfirmed

| Priority | Surface | URL / contact | Fit | Current route | Blocker | Exact next action |
| --- | --- | --- | --- | --- | --- | --- |
| A | Indie Hub | `https://t.me/indie_hub`; bot `@indie_hub_bot`; current public evidence: `https://telemetr.io/ru/channels/2401124400-indie_hub/posts` | Strong for weird/free indie. Recent posts include horror, survival, itch/free games and subscriber-suggested projects. | Public channel text says games can be proposed through `@indie_hub_bot`; it asks for title, genre, short description, why it is interesting, game link and a few screenshots. | Telegram login/bot composer required. | Owner/agent with Telegram access sends the ready Indie Hub copy below once, with MyIndie first, direct build second, and 2-3 screenshots/GIF from `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/`. |
| A | ИНДИ.РФ / Indie Spotlight | `https://xn--d1ahbs.xn--p1ai/`; Telegram link from site footer; VK link from site footer | Strong RU indie discovery audience; site describes the channel as about little-known worthy indie projects. | Landing page exposes registration/login and rights-confirmation flow; public search/landing routes mention game proposal. | Needs site login or Telegram/VK/editor route visible in browser; no safe unauthenticated shell submit. | Owner opens the site, uses `Предложить игру` if visible, or registers/logs in and submits through the game/right-confirmation flow. If Telegram route is easier, send a compact proposal and media pack once. |
| A | GcUp / Форум игроделов | `https://gcup.ru/forum/`, section `Ваши проекты -> Проекты в разработке` | High dev-feedback fit; public forum text explicitly allows beta/demo project information, raw versions, screenshots and changelog. | Create one thread under `Проекты в разработке`; later updates go into same thread. | Account required; captcha unknown. | Create a Tenevik thread with title `ГИГАХРУЩ - браузерный survival horror / ARPG shooter без движка`, attach media, MyIndie/direct/itch links, and ask for first 5-10 minute feedback. |
| A | XGM.guru | `https://xgm.guru/`; `https://xgm.guru/p/xgm/how-xgm-works`; project create route visible as `Создать проект` | Good devlog/project hub. XGM describes projects as a way to show content and resources as posts/news/video/game/docs. | Create one project, then one resource/article in Game Dev. | Account required. | Create project `ГИГАХРУЩ`, then publish one resource using the architecture angle: no engine, WebGL/canvas, browser access, A-Life, Самосбор. |
| A | StopGame Blogs | `https://stopgame.ru/site_help`; FAQ `https://stopgame.ru/faq/show/19187/ya_razrabatyvayu_igru_mozhno_vesti_log_razrabotki_v_blogah_eto_narushaet_pravila_sayta` | Strong if treated as a real development article, not an ad. | FAQ says gamedev blogs are borderline but acceptable if mostly about what was built, how and why, with few links. | Account required; article quality/moderation risk. | Publish a substantial devlog: `Почему ГИГАХРУЩ сделан браузерным и без движка`. Put playable links at the end only. |
| A | PlayGround.ru user post/forum | `https://www.playground.ru/about/rules/post/` | Broad RU gaming audience; can work as a native-media article. | Rules require at least one image/video for posts, correct category, structured text, and no rough copied wall of text. | Account required; ad/referral rules; must avoid link dump. | Prepare one article with a screenshot/GIF first, 1-2 playable links at the end, and the architecture/browser angle. Do not post as a bare release note. |
| B | Kanobu Pub / редакция | `https://kanobu.ru/community-rules/`; editorial contact `promo@kanobu.ru` | Broad media; lower hit rate but useful for a polished architecture/culture angle. | Pub allows user posts on media/games topics; rules ban off-topic/pure spam. Editorial email is listed publicly. | Account or Gmail required. | Use only after polishing the architecture post and media pack. Send one targeted pitch to `promo@kanobu.ru` or make one Pub article, not both in the same short window. |
| B | Unity3D Book / Разработка игр | `https://t.me/s/Unity3DBook?before=438` | Small dev channel; public channel says developers can suggest posts about their game in channel PM. | DM/post proposal route. | Telegram login required; channel is Unity-branded, so no-engine angle must be framed respectfully. | Send a short devlog proposal: `почему я сознательно не использую движок и делаю браузерный WebGL/canvas survival horror`. |
| B | gamedev events / Indie Varvar showcase path | `https://t.me/s/gamedev_events_SPb`; Indie Varvar forwarded forms | Event/showcase route, not a normal post. Useful for live feedback and later social proof. | Current public posts show showcase registration forms inside general event registration and instructions to show your game. | Event windows are date-specific; needs form/browser account and likely physical/online availability. | Monitor current event posts. When a live showcase form is open, submit a media/gameplay packet and say the build is browser-playable without install. |
| C | CoreMission +1PR / indie support | `https://coremission.net/gamedev/pr-dlya-indie-bez-izdatelya/`; contact in article `s.coremission@gmail.com` | Old but relevant indie-support route if still monitored. | Article invites indie developers to write/contact about game, interviews and cooperation. | Gmail required; 2019 initiative may be stale. | One low-pressure email only after higher-priority A routes. Mention playable browser build and ask if the initiative or successor format still exists. |

## Ready Copy - Indie Hub Bot / Indie Spotlight Proposal

```text
Название: ГИГАХРУЩ / GIGAH|RUSH

Жанр: browser survival horror / ARPG shooter, выживание, шутер, RPG, процедурный хоррор.

Кратко: бесплатная браузерная игра про вылазки в живую безграничную бетонную структуру. Игрок готовит воду, еду, патроны, аптечки, документы и оружие, выходит из жилой зоны, берет слух/контракт/квест, торгуется, дерется, прячется, переживает САМОСБОР и пытается вернуться с добычей и последствиями.

Почему интересно: это не Unity/UE-проект и не набор ассетов. Игра сделана как собственная web-система на TypeScript, WebGL/canvas, процедурных текстурах, спрайтах и звуке. Мир живет без игрока: NPC, фракции, торговля, слухи, контейнеры, смерть персонажей и последствия вылазок связаны в одну песочницу.

Особенно важный угол: ГИГАХРУЩ остается бесплатным и анонимным браузерным опытом. Самосбор как культурный феномен родился в интернете и анонимных сообществах, поэтому игра намеренно запускается без установки и без регистрации, чтобы новые игроки могли сразу прикоснуться к этой хаотичной культуре.

Играть:
https://myindie.ru/games/game/gigahrush

Прямой браузерный билд:
https://gigahrush.bileter.workers.dev

itch / EN mirror:
https://tenevik.itch.io/gigahrush

Telegram проекта:
https://t.me/gigah_rush

Контент-нота: survival horror, оружие, кровь, трупы, монстры, сирены, тревожные события и элементы body-horror. Не NSFW/adult.
```

Attach 2-3 media items from:

- `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/01_hero_gif_hell_blinking_eyes.gif`
- `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/02_gif_underhell_maronary_samosbor_loop.gif`
- `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/contact_sheet_3x3.png`
- `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/08_inventory_prep_loadout.png`

## Ready Outline - Architecture Article For StopGame / XGM / GcUp / PlayGround / DTF

Use this only where a real article/devlog is acceptable. Do not post it as a duplicated release note.

Title options:

1. `Почему ГИГАХРУЩ сделан как бесплатный браузерный survival horror без движка`
2. `ГИГАХРУЩ: web, САМОСБОР и живая структура без готового движка`
3. `Как устроен ГИГАХРУЩ: браузерный хоррор, A-Life и обычный жилец вместо героя-бога`

Structure:

1. Human opener: "На комментарии отвечает разработчик, а не маркетинговый аккаунт."
2. Raycaster/no-engine decision: WebGL/canvas, 2.5D raycaster and procedural media are chosen to keep the world system clean, cheap and browser-native.
3. Simulation scope: full simulation only on the active floor; off-floor population is intentionally frozen/folded into compact facts, otherwise a living structure with a huge population would not remain playable.
4. Player promise: current weakness is onboarding; the game is a sandbox/life-sim of a gigastructure, but first 5-10 minutes still need a clearer hook and loop.
5. System unity: features are meant to be part of one monolithic world logic, not isolated minigames; breadth is the risk, but every update ties the picture together.
6. Player role: the player is not a god or admin, just one ordinary resident, and not the strongest one.
7. Web/culture paragraph from the positioning rule above.
8. Links and feedback ask: MyIndie, direct build, itch, Telegram; ask for concrete feedback, not likes/votes.

Short close:

```text
Если вы запускаете текущую сборку, мне особенно нужны первые 5-10 минут: где непонятно, зачем идти в вылазку, что не читается в HUD/карте/инвентаре, где браузер проседает, и на каком моменте хочется закрыть вкладку. Не прошу апов, рейтингов или голосов - нужны места, которые можно чинить.
```

## Immediate Order For Next Agent

1. Telegram first if owner session is available: `@indie_hub_bot`, then ИНДИ.РФ / Indie Spotlight route, then only one small channel such as Unity3D Book if time remains.
2. Forum/devlog second: GcUp thread or XGM project. Do not open both with identical copy; make GcUp feedback-oriented and XGM architecture/project-oriented.
3. Article platforms third: StopGame or PlayGround with the architecture article, native image/video and links at the end.
4. Kanobu/CoreMission only after the article/media pack is polished; do not send a quick duplicate while the June 1-2 email waves are still warm.
5. Keep these on hold unless unlocked: DTF OAuth, VK logged-in composer, Telegram official channel admin composer, forum.indie.ru login, Gmail recipient follow-ups, Reddit cooldown.

## Owner Blockers To Clear

- Telegram: log in to Web Telegram or allow native Telegram focus/click/paste automation; then bot routes can be completed quickly.
- VK: open logged-in VK in the controllable browser before any VK group/profile route.
- DTF: approve/resolve Yandex OAuth only if the owner is comfortable with the unverified app consent and selected identity.
- Forum accounts: create or unlock Tenevik accounts on GcUp/XGM/StopGame/PlayGround if those routes are desired.
- Media: upload `../gatbage/tmp/media/prcampaign_2026-06-01_ixbt/gigahrush_ixbt_trailer_20s_2026-06-01.mp4` to VK Video or YouTube before restarting IXBT bot.
