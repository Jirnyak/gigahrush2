# Account-Gated Login Route Scout - 2026-05-23

Scope: DevTribe, Pikabu, Game Jolt, IndieDB, Reddit, TIGSource and HTML5GameDevs. No browser/UI automation was used, no login was attempted, no content was posted. This is a public web/source scout for future owner-approved manual or automated account checks.

Primary campaign links to keep available in drafts: itch.io `https://tenevik.itch.io/gigahrush`, direct build `https://gigahrush.bileter.workers.dev`, Telegram `https://t.me/gigah_rush`, Game Jolt `https://gamejolt.com/games/gigahrush/1072064`, IndieDB `https://www.indiedb.com/games/gigahrush`.

## Summary

| Surface | Login / Form URLs | Web-visible provider options | Expected blocker | Should browser automation attempt it? |
| --- | --- | --- | --- | --- |
| DevTribe | `https://devtribe.ru/auth`, `https://devtribe.ru/register` | Native username/email/password registration with Google reCAPTCHA; public register page also exposes VK auth at `/auth/vk`. No Yandex or Google login found; Google appears only as fonts/reCAPTCHA, Yandex only as Metrika. | CAPTCHA plus possible stale/low-activity community. Posting/project creation path must be found after login. | Conditional yes for login/register reconnaissance only after owner confirms account path; no final publish clicks. Low automation value if CAPTCHA appears. |
| Pikabu / gamedev community | `https://pikabu.ru/`, `https://pikabu.ru/community/gamedev`, `https://pikabu.ru/oauth.php?type=ya`, `https://pikabu.ru/oauth.php?type=vk` | Public auth modal exposes Yandex ID and VK ID; native login by username/email/phone plus password. Pikabu help says Google, Apple, Facebook and X/Twitter social login are no longer supported; Yandex ID and VK remain. | Account trust/reputation, anti-spam moderation, possible phone/email confirmation, editor final-click risk. External-link posts are sensitive; use DTF-like media/devlog pattern, not link dump. | Yes only if owner is already logged in and explicitly asks for draft setup. Do not automate publish; stop before final submit. Yandex login is a plausible owner path; Google is not. |
| Game Jolt | `https://gamejolt.com/login`, `https://gamejolt.com/join`, live game page `https://gamejolt.com/games/gigahrush/1072064` | Current auth JavaScript exposes username/password login plus `Sign in with Google` and `Sign up with Google`. Linked-account callback routes exist for Facebook, Google and Twitch, but login/join UI found only Google plus native credentials. No Yandex found. | CAPTCHA, device approval, or account safety challenge; existing page is already public, so future work should be devlog/gallery only with a real update angle. | Yes for safe draft/devlog route discovery in the already trusted account session; avoid duplicate release spam and no final publish without owner confirmation. |
| IndieDB | `https://www.indiedb.com/members/login`, `https://login.moddb.com/`, game page `https://www.indiedb.com/games/gigahrush` | Shell fetch of IndieDB login and shared ModDB login is Cloudflare-challenged. Search-visible ModDB/IndieDB login copy indicates username/email plus password; no reliable current Yandex or Google button confirmed. | Cloudflare challenge blocks shell; previous campaign notes already require browser/account check. Listing exists, so form path is article/news or dashboard, not initial submission. | Conditional yes only in a real browser session after Cloudflare clears. Automation should inspect and draft, then stop before publish. Do not assume Google/Yandex. |
| Reddit | `https://www.reddit.com/login/`, `https://www.reddit.com/r/WebGames/` | Reddit Help says web login supports Continue with Google, Continue with Apple, Continue with Phone Number, or email/username plus password. No Yandex. Shell requests to Reddit login were blocked by network policy. | Account age/karma, subreddit-specific self-promo rules, anti-spam heuristics and same-day cross-post risk from fresh r/playmygame post. | Not today for posting. Later, browser automation may prepare a direct-link r/WebGames draft only after the recommended pause and owner approval; final submit must remain manual/explicit. |
| TIGSource DevLogs | `https://forums.tigsource.com/index.php?action=login`, `https://forums.tigsource.com/index.php?action=register`, likely target board `https://forums.tigsource.com/index.php?board=27.0` | Login/register shell fetch hits Cloudflare challenge. Search-visible forum pages show classic forum `login or register`; no web-visible OAuth, Google or Yandex provider found. | Cloudflare challenge, old-forum account registration, forum culture expects a long-running devlog rather than one-off ad. | Conditional yes for login/register reconnaissance only if owner wants a long devlog thread. Stop before creating a thread; no one-off release blast. |
| HTML5GameDevs Showcase | `https://www.html5gamedevs.com/login/`, likely target `https://www.html5gamedevs.com/forum/8-game-showcase/` | Login shell fetch hits Cloudflare challenge. No reliable public confirmation of Google/Yandex login found from fetched page/search; treat provider options as unknown until browser-visible. | Cloudflare challenge, possible inactive/low-moderation forum state, account validation. Best angle is HTML5/WebGL performance feedback, not generic ad. | Conditional yes for browser-visible route scout only; stop before post creation/publish. Do not assume OAuth. |

## Notes By Surface

### DevTribe

Public pages loaded without a browser challenge. The header has `/register` and `/auth`; the registration form asks for username, email and password and includes Google reCAPTCHA. The only external auth button visible on the registration page is VK (`/auth/vk`). No Yandex ID or Google account login was found in the HTML.

Safe future path: open `/register` or `/auth`, confirm whether an existing owner account is available, then inspect whether project/devlog creation exists under `/projects` after login. Because CAPTCHA is present, automation should not try to create an account unattended.

### Pikabu

Pikabu is the clearest Yandex candidate. The public auth modal includes `https://pikabu.ru/oauth.php?type=ya` and `https://pikabu.ru/oauth.php?type=vk`; the native form supports username/email/phone and password. Pikabu help explicitly says fast login through Google, Apple, Facebook and X/Twitter is no longer supported, while VK and Yandex ID remain.

Safe future path: owner logs in via Yandex ID/VK/native credentials, agent may prepare a gamedev-community draft with media and developer disclosure, then stop before final publish. Use a native longpost, not a link-only repost.

### Game Jolt

The public `/login` shell page loads the auth bundle. The current login/join components expose native username/password and Google sign-in/sign-up. The same bundle contains linked-account callback routes for Facebook, Google and Twitch, but the visible login/join call path found in the bundle uses Google only. No Yandex route was found.

Safe future path: use the existing live game page. Only prepare a Game Jolt devlog if there is a real update angle or media/gallery improvement. Avoid duplicate launch spam.

### IndieDB

`www.indiedb.com/members/login`, `www.indiedb.com/members` and `login.moddb.com` returned Cloudflare challenge pages to shell. Search-visible login snippets for the shared ModDB/IndieDB account system show username/email and password fields and say IndieDB accounts can sign in through ModDB, but current OAuth buttons could not be confirmed publicly. No current Yandex/Google route was verified.

Safe future path: use a real browser/account session for dashboard/article route discovery only. Since the game page already exists, the safe candidate is an IndieDB article/news post, not a duplicate listing.

### Reddit

Shell fetches to Reddit login were blocked by Reddit network policy, but Reddit Help documents the current login options: Google, Apple, phone number, or email/username plus password. There is no Yandex option. Campaign context still says r/playmygame is fresh, so a second Reddit post should wait.

Safe future path: after the 24-48h pause, prepare one distinct r/WebGames direct-link post to the Cloudflare build if current subreddit rules still fit and account age/karma are sufficient. No autoposting or final-click automation.

### TIGSource

The forum login/register endpoints are Cloudflare-challenged from shell. Public search result snippets show standard forum login/register language. No OAuth/Yandex/Google provider evidence was found. Treat it as a classic forum account path.

Safe future path: browser route scout only if the owner wants to maintain an ongoing devlog. The draft should be process/design-heavy and not a one-off ad.

### HTML5GameDevs

The `/login/` route is Cloudflare-challenged from shell. No reliable current provider options were visible without a browser. Treat OAuth as unknown; do not assume Google/Yandex support.

Safe future path: browser route scout only. If viable, the post angle should ask for HTML5/WebGL/canvas performance feedback and explain the zero-runtime TypeScript/Vite build.

## Source Trail

- DevTribe public pages checked: `https://devtribe.ru/`, `https://devtribe.ru/auth`, `https://devtribe.ru/register`.
- Pikabu public page checked: `https://pikabu.ru/`; Pikabu help checked: `https://help.pikabu.ru/article/68014`.
- Game Jolt public auth checked: `https://gamejolt.com/login`, `https://s.gjcdn.net/assets/auth-Dpox-F8m.js`, `https://s.gjcdn.net/assets/Bn_DPMAU2.js`, `https://s.gjcdn.net/assets/CRh1Q5yb2.js`.
- IndieDB / ModDB login routes checked: `https://www.indiedb.com/members/login`, `https://www.indiedb.com/members`, `https://login.moddb.com/`; search-visible ModDB login result checked for shared account wording.
- Reddit login route checked: `https://www.reddit.com/login/`; Reddit Help checked: `https://support.reddithelp.com/hc/en-us/articles/28620245447572-How-do-I-log-in-and-out-of-my-Reddit-account`.
- TIGSource routes checked: `https://forums.tigsource.com/index.php?action=login`, `https://forums.tigsource.com/index.php?action=register`.
- HTML5GameDevs route checked: `https://www.html5gamedevs.com/login/`.
