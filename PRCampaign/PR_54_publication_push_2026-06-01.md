# PR 54 - Publication Push And Owner-Unlocked Queue

Date: 2026-06-01.

Window: 09:35-09:55 BST.

Update later on 2026-06-01: this report's "no authenticated session" blocker was superseded after owner opened VK, Gmail and Telegram. See `PRCampaign/PR_55_owner_unlocked_broad_execution_2026-06-01.md` for the confirmed VK post, Telegram comment and 27 sent Gmail pitches. The GameLuster `mail_failed` and IXBT video-upload blocker remain valid.

Scope: owner asked for more real posts/publications everywhere possible, and concrete links/steps wherever posting is blocked by login, captcha, account rights, media upload or platform rules. This pass did not use votes, ratings, fake comments, duplicate bumps, paid requests, moderation evasion, captcha bypasses or local mail spoofing.

## What Was Actually Done

| Surface / action | Result | Notes |
| --- | --- | --- |
| MyIndie public recheck | Live | `https://myindie.ru/games/game/gigahrush` returned `HTTP/2 200`. Keep it as the primary RU/CIS game URL. |
| Direct build recheck | Live | `https://gigahrush.bileter.workers.dev` returned `HTTP/2 200`. Use as direct playable fallback. |
| itch public recheck | Live but still `noindex` | `https://tenevik.itch.io/gigahrush` returned the page and still contains `<meta name="robots" content="noindex"/>`. Public page now shows `Updated 31 May 2026 @ 21:42 UTC`; support/manual review remains the path. |
| DTF follow-up comment recheck | Live by shell | `https://dtf.ru/indie/5086991-gigahrusha-novaya-versiya-myindie-i-kadry-iz-samosbora?comment=64892114` returned `HTTP/2 200`. No new DTF bump should be made without real feedback or a distinct update. |
| GameLuster contact form attempt | Not sent | Official contact page exposes a Contact Form 7 `Press Releases` form. The REST attempt returned `HTTP/2 200` but JSON status `mail_failed` with message `There was an error trying to send your message. Please try again later.` Do not count this as submitted. Use browser form or displayed editor emails manually. |
| IXBT/НАШЫ ИГРЫ media blocker | Partially removed | Created a short local MP4 trailer from existing campaign GIFs/contact sheet: `../gatbage/tmp/media/prcampaign_2026-06-01_ixbt/gigahrush_ixbt_trailer_20s_2026-06-01.mp4`, duration `17.033333`, size `3574362` bytes. Owner still must upload it to VK Video or YouTube before `@ixbtgamesbot` accepts the trailer field. |

No public post, comment, forum topic, email, Telegram bot message, VK post, Reddit post, portal final-click or successful press-form submission was completed from the current environment. The practical blocker is authenticated publishing access: current tools have shell/web access, but not the logged-in Telegram/VK/Gmail/browser sessions used in earlier PR passes.

## Immediate Owner-Unlocked Publications

These are the highest-signal actions because they create actual public surfaces rather than another private pitch.

| Priority | Surface | Exact link / route | What owner must do | Copy/media |
| --- | --- | --- | --- | --- |
| A | Official Telegram channel | `https://t.me/gigah_rush` | Log in as an admin account with a visible post composer. Attach one GIF or the new MP4, paste the RU short post below, publish, then record the public `t.me/...` message URL. | Use `01_hero_gif_hell_blinking_eyes.gif`, `02_gif_underhell_maronary_samosbor_loop.gif`, or the MP4 trailer. |
| A | VK owned post / clip | `https://vk.com/` and VK Video upload | Log in as Tenevik, upload `gigahrush_ixbt_trailer_20s_2026-06-01.mp4` to VK Video or post it on the owner wall with the RU short post. Copy the final video/post URL. | This also unlocks IXBT trailer requirements. |
| A | YouTube trailer | `https://studio.youtube.com/` | Log in to the Tenevik Google/YouTube channel, upload the MP4 as public or unlisted, title it `ГИГАХРУЩ - браузерный survival horror / samosbor trailer`, copy the YouTube URL. | Use that URL in `@ixbtgamesbot`. |
| A | IXBT / НАШЫ ИГРЫ | `https://t.me/ixbtnashy`, bot `@ixbtgamesbot` | Restart the bot flow cleanly: title `ГИГАХРУЩ`, genre `survival horror / ARPG shooter`, game link `https://myindie.ru/games/game/gigahrush`, 3-5 Russian screenshots, then VK Video/YouTube trailer URL. | Screenshots: `../gatbage/tmp/media/gamepush_promo_2026-05-28/gigahrush_screen_1_underhell_gate_1280x720.png`, `gigahrush_screen_2_living_monster_1280x720.png`, `gigahrush_screen_3_inventory_1280x720.png`, `gigahrush_screen_4_alife_1280x720.png`. |
| A | Индикатор `#РелизыАвторов` | `https://forms.gle/ZomwE6hnHaPyd7vQ9`, channel `https://t.me/IndikatorOnline` | Open the Google Form while logged into the owner Google account if required. Use MyIndie as the game link, Telegram as contact/community, attach/select media only if the form asks. | Use RU release-form copy below. |
| B | X / Twitter | `https://x.com/compose/post` | Log in as the official/Tenevik identity, attach GIF/MP4, publish one EN post. Do not tag random accounts or ask for reposts. | Use EN short post below. |
| B | Bluesky | `https://bsky.app/` | Log in as official/Tenevik identity, attach GIF/MP4, publish one EN post. | Use EN short post below. |
| B | Mastodon | Owner instance compose page | Log in from the official/Tenevik identity, attach GIF/MP4, publish one EN post with content warning if needed. | Use EN short post below. |

## Form / Press Routes Checked

| Surface | Link | Current state | Owner action |
| --- | --- | --- | --- |
| GameLuster | `https://gameluster.com/contact/` | Page explicitly invites developers/PR to request coverage, and has `Editorial`, `Press Releases`, `Interviews` options. Shell submission returned `mail_failed`; no pitch was sent. | Open in a normal browser and submit manually, or use the editor/reviews emails displayed on the page. Use the GameLuster pitch from PR 40 or the EN press copy below. |
| Dread Central | `https://www.dreadcentral.com/contact-us/` | Contact page says it can be used to contact them or submit news; shell found Contact Form 7 plus Google reCAPTCHA v3. Direct email decoded from the page: `info@dreadcentral.com`. | Use browser form or Gmail from `tenevik.games@gmail.com`; do not attempt command-line captcha bypass. |
| Bloody Disgusting | `https://bloody-disgusting.com/contact-us/` | Contact page says editorial inquiries go to the Managing Editor and all other inquiries use the form; shell hit Cloudflare managed challenge. | Open in browser, pass Cloudflare normally, submit one horror-first pitch. |
| Buried Treasure | `https://buried-treasure.org/contact/` | Contact page says to send an email or tweet, and exposes `@game_treasure`; email is obfuscated to crawlers. | Open the contact page in browser or use official X/Twitter identity to send a short, human pitch. |
| GamingOnLinux | `https://www.gamingonlinux.com/email-us/` | Page says quick tips can be emailed; direct email decoded from the page: `contact@gamingonlinux.com`. | Use Gmail only if the pitch is Linux/browser-tech relevant; lead with no-install WebGL browser build working on Linux. |
| PopularGames.io developer portal | `https://developer.populargames.io/` | Page says to email the team with a link to the build and that they accept ready-to-play HTML5 games. | Owner should review revenue/share terms first, then email from `tenevik.games@gmail.com`. |
| Pixlland | `https://pixlland.com/about` | About page says developers/studios can submit HTML5 games; contact email is `hello@pixlland.com`; platform is browser-first and 16+. | Email with content note; do not use kids-safe framing. |
| KickoutGames | `https://kickoutgames.com/developers/` | Has a public submission form but requires at least 3 screenshots, licensing choice and reCAPTCHA. | Owner must choose acceptable licensing option, solve reCAPTCHA, and accept content-fit risk. Do not submit from shell. |
| GameBolt | `https://gamebolt.io/submit` | Page asks developers to email `hello@storerider.com`; requirements say HTML5/JavaScript, mobile-friendly and family-friendly. | Fit risk because GIGAH|RUSH is horror. Only email after owner accepts that the game may not be family-friendly enough. |
| MakeWebGames | `https://makewebgames.io/forum/38-general/`, Game Projects section on the same forum | Forum has `Game Projects` and `Browsergames` areas, but posting requires sign-in/sign-up. | Owner logs in, creates one devlog/feedback topic, not a player-ad link dump. |
| Lemmy `indiegamedev` | `https://lemmy.world/c/indiegamedev` | Login/sign-up required; current norm is more devlog/news than direct ads. | Owner posts a technical devlog with one playable link, no vote asks. |
| Hacker News Show HN | `https://news.ycombinator.com/submit`, rules `https://news.ycombinator.com/newsguidelines.html` | Established logged-in HN account needed; Show HN is bad for drive-by promo. | Only use if owner can answer technical questions for hours. |
| Product Hunt | `https://www.producthunt.com/launch` | Requires maker account and launch assets. | Treat as launch-day task, not same-day post. No vote solicitation. |

## Ready Copy

### RU Short Post

```text
ГИГАХРУЩ - бесплатный браузерный survival horror / ARPG shooter про вылазки в безграничную бетонную структуру.

Готовишь воду, еду, патроны и документы в жилой зоне, уходишь по слуху/квесту/контракту, переживаешь самосбор, вытаскиваешь добычу или последствия.

Играть:
https://myindie.ru/games/game/gigahrush

Прямой билд:
https://gigahrush.bileter.workers.dev

Зеркало itch:
https://tenevik.itch.io/gigahrush

Канал:
https://t.me/gigah_rush
```

### RU Release-Form Copy

```text
ГИГАХРУЩ - бесплатный браузерный survival horror / ARPG shooter от Tenevik Games. Игра запускается прямо в браузере: TypeScript/Vite/WebGL/canvas, без движка и без ассет-пайплайна.

Игрок готовит вылазку в жилой зоне, берет слух, квест или контракт, уходит в безграничную бетонную структуру, сталкивается с фракциями, монстрами, A-Life NPC и самосбором. Сейчас особенно нужен фидбек по первым 10-15 минутам: понятно ли, куда идти, читается ли HUD, хватает ли давления в бою и самосборе.

Primary RU/CIS page: https://myindie.ru/games/game/gigahrush
Direct browser build: https://gigahrush.bileter.workers.dev
itch mirror: https://tenevik.itch.io/gigahrush
Telegram: https://t.me/gigah_rush
```

### EN Short Post

```text
GIGAH|RUSH is a free browser survival horror / ARPG shooter by Tenevik Games.

No install: TypeScript/Vite/WebGL/canvas, procedural visuals/audio, expeditions, factions, A-Life NPC records and samosbor events inside an unbounded concrete megastructure.

Play:
https://gigahrush.bileter.workers.dev

itch mirror:
https://tenevik.itch.io/gigahrush

Community:
https://t.me/gigah_rush
```

### EN Press/Form Copy

```text
Hello,

I am contacting you as the developer/representative of Tenevik Games.

GIGAH|RUSH is a free browser survival horror / ARPG shooter playable with no install. It is built in TypeScript/Vite/WebGL/canvas without a runtime engine or asset pipeline, with procedural textures, procedural sprites, procedural sound, persistent floor state, A-Life NPC records and expeditions into an unbounded concrete megastructure.

Primary playable link: https://gigahrush.bileter.workers.dev
Itch mirror / English page: https://tenevik.itch.io/gigahrush
Russian/CIS page: https://myindie.ru/games/game/gigahrush
Community/contact: https://t.me/gigah_rush

The best first-look angle is a 10-15 minute route: prepare food/water/ammo in the living zone, take an expedition lead, enter hostile corridors, survive a samosbor warning/rebuild, and return with loot or consequences.

Content note: horror violence, unsettling atmosphere, body-horror-adjacent procedural creatures; not NSFW.

If this fits your coverage, I can provide a compact screenshot/GIF sheet, a short first-session guide and extra technical details.

Thank you,
Tenevik Games
```

## Next Safe Order

1. Owner posts the official Telegram update and records the public post URL.
2. Owner uploads the new MP4 to VK Video or YouTube, then completes `@ixbtgamesbot`.
3. Owner fills the Индикатор Google Form with MyIndie first and Telegram contact.
4. Owner sends exactly one browser-form/Gmail press pitch: Dread Central or Bloody Disgusting first; GameLuster only after the form/mail issue is cleared.
5. Then one EN community post only after login: MakeWebGames Game Projects or Lemmy `indiegamedev`.

## Do Not Do

- Do not duplicate VGTimes/App2Top/Мракопедия Telegram bot pitches from PR 53.
- Do not make a fresh DTF/Pikabu/Gamin post until there is a distinct new trailer/catalog/release hook.
- Do not post to Reddit until at least 2026-06-03 and until the owner clears captcha/checkpoint/account trust.
- Do not submit KickoutGames or revenue-share portals without owner approval of licensing and content-fit terms.
- Do not use local `sendmail`/`mail` to spoof `tenevik.games@gmail.com`; use the real Gmail/browser session.
