# PR 62 - Y8 Reply And New Build Outreach

Date: 2026-06-02.

Window: approximately 19:20-20:32 BST.

Scope: owner said the English version / no-lag version was uploaded to itch and the Cloudflare build, asked to reply to Y8, and asked for more posts, emails and public outreach.

No votes, likes, reposts, fake comments, account creation, paid placement, captcha bypass, moderation evasion, Reddit action, duplicate community post or blind portal upload was made.

## Public Verification

| Surface | Fresh check | Result |
| --- | --- | --- |
| Direct Cloudflare build | `curl -I -L https://gigahrush.bileter.workers.dev` at 2026-06-02 19:23 BST | `HTTP/2 200`, Cloudflare cache hit. This was used as the live cloud-build link in the Y8 reply and new pitches. |
| itch.io mirror | Public fetch of `https://tenevik.itch.io/gigahrush` at 2026-06-02 19:23 BST | `HTTP/2 200`; page body now has English description copy, HTML5 embed, tags including `browser-game`, `html5`, `survival-horror`, `webgl`, languages `English` and `Russian`, and public `Updated 02 June 2026 @ 18:11 UTC`. The page still has `<meta name="robots" content="noindex"/>`, so indexing remains a separate blocker. |
| MyIndie | Public web fetch opened `https://myindie.ru/games/game/gigahrush` | Page remains reachable, but the fetched text looked stale/old relative to current PR notes. Use MyIndie as RU/CIS primary, but do not cite it as proof of the 2026-06-02 English/performance update until rechecked in browser/account state. |

## Y8 Reply

Y8 thread was open in Chrome under `tenevik.games@gmail.com`: `Fit check: GIGAH|RUSH - HTML5/WebGL survival horror browser build`.

Context from Y8:

- `Game is not fully translated to English`
- `When the monsters appeared and this screen showed up, my FPS dropped significantly.`
- `Please fix those issue and we would love to add the game on y8.com`

The reply was inserted into the thread above the quote and sent from the Tenevik Gmail account. Gmail showed `Message sent`, and the reply editor closed.

Reply sent:

```txt
Hello,

Thank you for checking the build and for the concrete feedback.

I have now uploaded a new version to both public builds:

Direct browser build: https://gigahrush.bileter.workers.dev
itch mirror: https://tenevik.itch.io/gigahrush

This update addresses the two issues you reported:
- The English version of the playable build is now live, and the itch page metadata/description were updated as well.
- The heavy FPS drop around the monster/encounter screen has been fixed/optimized.

Could your content team please re-check the current build when convenient? If it now looks acceptable for Y8, I can prepare the clean HTML5/WebGL ZIP package, screenshots, controls, content notes and metadata for upload/review.

Thank you again,
Tenevik Games
tenevik.games@gmail.com
```

Follow-up rule: do not upload to Y8 or send another Y8 follow-up until Y8 replies. If they approve, prepare a clean HTML5/WebGL ZIP/package, screenshots, controls, age/content notes and metadata.

## Confirmed New Emails / Submissions

All emails below were sent from `tenevik.games@gmail.com` through the open Gmail account. Each compose was populated and verified before send; each send produced Gmail `Message sent`.

| Surface | Recipient | Subject | Status |
| --- | --- | --- | --- |
| GamerBay | `news@gamerbay.ru` | `ГИГАХРУЩ - обновленная браузерная survival horror / ARPG-версия` | Confirmed sent. |
| BELONGPLAY | `dm@belongplay.ru` | `ГИГАХРУЩ - бесплатный WebGL survival horror для World Of Indie` | Confirmed sent. |
| DUNGEN | `info@dungen.ru` | `ГИГАХРУЩ: обновлен бесплатный браузерный WebGL survival horror` | Confirmed sent. |
| Warp Door | `warpdoor@gmail.com` | `GIGAH|RUSH - strange free browser survival horror in an unbounded concrete megastructure` | Confirmed sent. |
| Blue's News | `news@bluesnews.com` | `News tip: GIGAH|RUSH updated free WebGL browser survival horror build` | Confirmed sent. |
| Indiepocalypse Issue #79 | `indiepocalypse@gmail.com` | `Submission: GIGAH|RUSH - free browser survival horror / ARPG` | Confirmed sent. Deadline-sensitive route; issue page accepts email submissions and closes 2026-06-04 16:00. |

Do not duplicate or quick-follow-up any of these recipients. Watch Gmail for replies/bounces and record exact responses.

## Public Posts / Not Done

No new public post was created in this pass.

Reasons:

- Telegram official channel admin composer remains unverified in current notes; previous pass could only make a public comment.
- Reddit remains on hold because of recent removals and `BAD_CAPTCHA` / account-trust issues.
- Several public routes need owner/browser/captcha/account action: Perelesoq Google Form, Haunted House FearFest Google Forms, HTML5GameDevs account, GcUp/XGM accounts, VK community proposal paths and Y8 upload.
- Posting to 2ch/Corch or similar without solving visible captcha/rules would be blind moderation evasion or a low-quality bump.

## Next Order

1. Watch Gmail for Y8, GamerBay, BELONGPLAY, DUNGEN, Warp Door, Blue's News and Indiepocalypse replies/bounces. Record exact wording and dates.
2. If Y8 says the new build is acceptable, prepare the portal package and metadata. Do not upload before that approval.
3. For a real public post next, use one owner-visible/account route rather than another email wave: #PitchYaGame on 2026-06-05, HTML5GameDevs showcase, GcUp/XGM devlog, or an official Tenevik Telegram/VK post if the account composer is visible.
4. Keep no-duplicate holds for PR55 recipients, Noisy Pixel, ImiGames, BunaGames, Black Lantern, CatGeekBot, Y8, GamerBay, BELONGPLAY, DUNGEN, Warp Door, Blue's News and Indiepocalypse.
