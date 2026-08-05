# GIGAH|RUSH Media KPI Report - 2026-05-25

## Snapshot

| Surface | Status | Signal | Risk | Action |
| --- | --- | --- | --- | --- |
| Six-agent PR pass | Completed with caveats | Six lanes launched; four completed, one portal lane exhausted context, one monitoring lane timed out and was replaced by local checks. Full log: `PRCampaign/PR_15.md`. | Subagent output alone is not durable; exact publication still depends on owner login and platform rules. | Use PR 15 as the current operating queue. |
| itch.io game page | Live but still `noindex` | Public check 2026-05-25 05:49-06:10 UTC: `https://tenevik.itch.io/gigahrush` returned `200 OK`, expected title and `noindex`. Devlog index returned `200`, direct permalink `/devlog/1530909/-` returned `404`. | Search/indexing still blocked; duplicate page/devlog activity could worsen moderation/support state. | Wait for itch support/indexing; do not recreate or duplicate announcements. |
| PBBG.com | Partial public amplification | `https://pbbg.com/games` publicly contains the r/PBBG post title and Reddit link; `https://pbbg.com/games/gigahrush` remains `404`. | The dedicated directory listing is not live yet. | Recheck later; do not duplicate-submit while pending. |
| Live portal links | Stable | DiscoverGG, iDev.Games and MyIndie returned `200 OK`; DTF returned `200 OK` with public counters still increasing. | Monitoring only; duplicate bumps can look like spam. | Keep as active campaign links; answer only real feedback. |
| Pending portal submissions | Waiting | GamHub `/game/gigahrush/` and `/game/gigah-rush/` remain `404`; Fake Portal `/games/gigahrush/` remains `404`; FreeZonePlay `/gigahrush/` remains `404`. | Review queues/contact submissions may not publish; duplicate submissions would be low quality. | Wait or use support only after a reasonable review window. |
| Best RU next posts | Login needed | Pikabu `gamedev` / `indie_games`, `forum.indie.ru`, Indie Spotlight and СИКРИ are the best non-duplicate RU surfaces. | Requires owner login/Telegram; link-dump copy would likely fail. | Owner logs in or authorizes Telegram pitch; agent prepares unique media-first copy. |
| Best EN next posts | Login needed | GameDev.net Projects + Indie Showcase, TIGSource Playtesting/DevLogs, HTML5GameDevs, MakeWebGames, itch Get Feedback, Lemmy/Mastodon. | Same-text cross-posting and forum bumping are the main risks. | Owner unlocks one or two accounts, then publish after preview. |
| Best media/creator batch | Ready draft queue | Rely on Horror, Big Boss Battle, The Indie Informer, Dread Central, Get Indie Gaming, Splattercat. | Email blasting, paid promo upsells, creator AI-asset policies. | Send 4-6 tailored messages only; no quick follow-up before 7-14 days. |
| Portal tech queue | Not quick PR | CrazyGames, Poki, Yandex Games, Pikabu Games, GamePix are real but require SDK/QA/account/business review. | Submitting current build blindly could fail QA or pollute the zero-runtime build. | Treat as separate portal adapter / Basic Launch tasks. |

## Good Signs

- PBBG.com is already amplifying the r/PBBG post on its public games page, even though the dedicated listing is not live.
- DiscoverGG, iDev.Games, MyIndie and DTF remain public campaign surfaces.
- The next queue now has concrete owner-unlock URLs instead of vague “find more places.”
- The campaign has fresh non-Reddit surfaces, which reduces the risk of another Reddit removal.

## Bad Signs

- itch.io still has `noindex` on the public game page and devlog index on 2026-05-25.
- IndieDB shell fetch still hits Cloudflare `403`; browser/account check is needed for the news authorisation state.
- Several promising next posts are blocked by login, Terms, reCAPTCHA or account trust.
- One portal subagent failed from context exhaustion and one monitoring subagent timed out; their gaps were filled locally, but not all candidate portals were deeply inspected in-browser.

## Feedback Themes

- First-run comfort and controls remain the most repeated risk.
- New posts should ask for concrete first-10-minute feedback, not generic ratings.
- Browser/performance/readability expectations need to be stated clearly on webgame/PBBG-like surfaces.
- Current campaign copy should avoid implying MMO/PvP/server persistence.

## Next Actions

1. Owner chooses one immediate community lane and logs in: Pikabu, forum.indie.ru, HTML5GameDevs, GameDev.net or TIGSource.
2. Agent prepares one unique media-first post for that lane using `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/`, shows preview copy, then publishes only after owner confirms final submit.
3. Recheck IndieDB news authorisation in browser/account context.
4. Recheck PBBG.com dedicated game URL later; do not resubmit.
5. Send the next media/creator email batch only if owner approves outbound email use: Rely on Horror, Big Boss Battle, The Indie Informer, Dread Central, Get Indie Gaming, Splattercat.
6. Treat CrazyGames/Poki/Yandex/Pikabu Games as separate technical portal tasks, not today’s quick PR.

## Owner Needed

- Do not send passwords, cookies, OAuth redirect links, 2FA backup codes or QR codes in chat.
- For HTML5GameDevs: log in/register and open `https://www.html5gamedevs.com/forum/8-game-showcase/?do=add`, then say `HTML5GameDevs готово`.
- For Pikabu: log in at `https://pikabu.ru/community/gamedev`, then say `Пикабу готово`.
- For GameDev.net: log in/register at `https://gamedev.net/login/`, open `https://gamedev.net/projects/`, then say `GameDev.net готово`.
- For TIGSource: log in/register and open Playtesting or DevLogs, then say `TIGSource готово`.
- For forum.indie.ru: log in/register at `https://forum.indie.ru/`, then say `forum.indie.ru готово`.
