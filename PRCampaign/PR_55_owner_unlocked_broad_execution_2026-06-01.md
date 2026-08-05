# PR 55 - Owner-Unlocked Broad Publication Execution

Date: 2026-06-01.

Window: approximately 10:00-10:36 BST.

Scope: owner explicitly opened VK, Gmail and Telegram Desktop/Web and asked for many real publications/posts wherever possible. This pass used the authenticated browser sessions where they were visible. It did not ask for votes, ratings, reposts, fake comments or likes; it did not bypass captchas or moderation gates; it did not use unrelated local mail/spam tooling.

## Confirmed Public / Sent Actions

| Surface | Status | Evidence / URL |
| --- | --- | --- |
| VK owned profile post | Published | `https://vk.com/wall1116822249_2`. Browser DOM showed the post in the VK feed as `Tenevik Games`, `just now`, with clickable VK away-links for MyIndie, direct build, itch and Telegram. |
| Telegram `@gigah_rush` comments | Sent | Web Telegram showed the official channel/comments thread `https://web.telegram.org/a/#-1003940981518_19`, `1 Comment`, timestamp `10:33`, the sent update text, and clickable links to MyIndie, direct build and itch. This is a public comment under the latest channel post, not a main channel post. |
| Gmail press/editorial wave | Sent | Gmail UI or Sent search confirmed `Message sent` / sent conversation for 27 recipients listed below. |

## Gmail Wave - Confirmed Recipients

| # | Recipient | Subject | Confirmation |
| --- | --- | --- | --- |
| 1 | `info@dreadcentral.com` | `GIGAH\|RUSH - free browser survival horror / ARPG shooter` | Gmail showed `Message sent`. |
| 2 | `contact@gamingonlinux.com` | `GIGAH\|RUSH - no-install WebGL survival horror playable on Linux browsers` | Gmail showed `Message sent`. |
| 3 | `hello@pixlland.com` | `GIGAH\|RUSH - free HTML5/WebGL browser survival horror` | Gmail showed `Message sent`. |
| 4 | `pitch@pantaloon.io` | `GIGAH\|RUSH - strange free browser survival horror` | Gmail showed `Message sent`. |
| 5 | `admin@indie-hive.com` | `GIGAH\|RUSH - free browser survival horror / ARPG shooter` | Gmail showed `Message sent`. |
| 6 | `contact@umigari.com` | `GIGAH\|RUSH - free browser horror / ARPG playable now` | Gmail showed `Message sent`. |
| 7 | `melissa@horrorgeeklife.com` | `GIGAH\|RUSH - free browser survival horror by Tenevik Games` | Gmail showed `Message sent`. |
| 8 | `info@horrorobsessive.com` | `GIGAH\|RUSH - free browser survival horror / ARPG shooter` | Gmail showed `Message sent`. |
| 9 | `contact@horrorpress.com` | `GIGAH\|RUSH - no-install browser survival horror` | Gmail showed `Message sent`. |
| 10 | `info@keycreators.com` | `GIGAH\|RUSH - free browser survival horror / ARPG shooter` | Gmail Sent search for `to:info@keycreators.com in:sent newer:2026/06/01` showed one sent result. |
| 11 | `hello@storerider.com` | `GIGAH\|RUSH - HTML5/WebGL browser game fit check` | Gmail showed `Message sent`. |
| 12 | `news@gamebomb.ru` | `ГИГАХРУЩ - бесплатный браузерный survival horror / ARPG shooter` | Gmail showed `Message sent`. |
| 13 | `contact@shazoo.ru` | `ГИГАХРУЩ - бесплатный браузерный survival horror / ARPG shooter` | Gmail showed `Message sent`. |
| 14 | `press@mirf.ru` | `ГИГАХРУЩ - браузерный survival horror про самосбор и вылазки` | Gmail showed `Message sent`. |
| 15 | `Press@corpguru.ru` | `ГИГАХРУЩ - бесплатный браузерный survival horror / ARPG shooter` | Gmail showed `Message sent`. |
| 16 | `news@3dnews.ru` | `ГИГАХРУЩ - WebGL/browser survival horror без движка` | Gmail showed `Message sent`. |
| 17 | `news@cgspeak.ru` | `ГИГАХРУЩ - процедурный WebGL survival horror без движка` | Gmail showed `Message sent`. |
| 18 | `hello@gamespew.com` | `GIGAH\|RUSH - free browser survival horror for coverage consideration` | Gmail showed `Message sent`. |
| 19 | `tips@pcgamer.com` | `Tip: GIGAH\|RUSH - free no-install browser survival horror` | Gmail showed `Message sent`. |
| 20 | `inbox@gamespress.com` | `Press release: GIGAH\|RUSH - free browser survival horror playable now` | Gmail showed `Message sent`. |
| 21 | `welcome@gameworldobserver.com` | `GIGAH\|RUSH - solo TypeScript/WebGL browser survival horror` | Gmail showed `Message sent`. |
| 22 | `news@gamingtrend.com` | `News tip: GIGAH\|RUSH - free WebGL browser survival horror` | Gmail showed `Message sent`. |
| 23 | `pr@indiegamewebsite.com` | `Preview pitch: GIGAH\|RUSH - strange free browser survival horror` | Gmail showed `Message sent`. |
| 24 | `gloria@80.lv` | `Feature idea: zero-runtime TypeScript/WebGL survival horror built in browser` | Gmail showed `Message sent`. |
| 25 | `editor@gameffine.com` | `Preview request: GIGAH\|RUSH - free PC browser survival horror` | Gmail showed `Message sent`. |
| 26 | `editors@dtf.ru` | `ГИГАХРУЩ - браузерный survival horror / ARPG shooter от Tenevik Games` | Gmail showed `Message sent`. |
| 27 | `mail@nim.ru` | `ГИГАХРУЩ - бесплатный браузерный survival horror / ARPG shooter` | Gmail showed `Message sent` after a second send-button dispatch. |

## Blocked / Not Counted

| Surface | Result | Concrete next action |
| --- | --- | --- |
| Telegram main channel post | Not available | Web Telegram opened `@gigah_rush`, but the current session exposed only `Leave a comment`, not an admin channel-post composer. To make a main channel post, owner must open/promote an account with admin posting rights and a visible channel compose field. |
| Corch `/games/` thread | Not published | Attempted to reply in the existing GIGAH|RUSH thread `https://corch.net/games/res/68`; the form contains `CAP-WIDGET`, empty `cap-token` and `kcaptcha_answer`. The click did not create a new post. Owner must solve the visible `Ботохуета` / captcha in browser, then click `Ответить`. |
| IXBT / НАШЫ ИГРЫ bot | Still blocked | Bot still asks for a YouTube or VK Video trailer URL. Upload `../gatbage/tmp/media/prcampaign_2026-06-01_ixbt/gigahrush_ixbt_trailer_20s_2026-06-01.mp4` to VK Video or YouTube, then paste that URL into `@ixbtgamesbot` with 3-5 Russian screenshots. |
| GameLuster form | Still not sent | PR 54 REST attempt returned JSON `mail_failed`. Use normal browser form or a displayed editor/reviews email; do not count the previous HTTP 200 as sent. |
| Unrelated local `spamer` process | Not used | A separate `/Users/jirnyak/Mirror/spamer` process was running for unrelated outreach under another Gmail identity. It was not used for GIGAH|RUSH PR. |

## Copy Actually Published

VK used a RU short post with MyIndie first, direct build second, itch mirror third and Telegram contact. Telegram comment used a shorter update and the three playable links. Public wording used `безграничная бетонная структура` / browser-survival-horror framing and did not reveal implementation geometry.

## Next Actions

1. Watch Gmail for replies/bounces from the 27-recipient wave; do not send quick follow-ups.
2. Monitor `https://vk.com/wall1116822249_2` for link retention, comments and moderation.
3. If Telegram admin posting becomes available, post a main `@gigah_rush` channel update once; do not duplicate the comment text blindly.
4. Owner solves Corch captcha only if that community update is still desired; use the already drafted short update with VK link and first-10-minutes feedback ask.
5. Upload the local MP4 to VK Video or YouTube, then finish IXBT.
