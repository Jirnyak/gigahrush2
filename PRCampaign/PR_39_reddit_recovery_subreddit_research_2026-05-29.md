# PR 39 - Reddit Recovery And Additional Subreddit Research

Date: 2026-05-29.

Scope: lane 3 only. Owner asked to research safe Reddit recovery and additional subreddit options after Reddit removals and `BAD_CAPTCHA`. No Reddit post, comment, vote, modmail, profile edit, native-media upload, form submission or final-click action was made.

## Decision

Posting today is not safe.

Reasons:

- PR 34 already created two accepted-but-immediately-removed Reddit posts from `u/Educational-Dog-230`: profile post `t3_1tpt6cp` and `r/SurvivalGaming` post `t3_1tptb5c`.
- PR 37 then hit Reddit `BAD_CAPTCHA` on `r/playmygame`. This is an account-trust / human-check blocker, not a subreddit-fit problem.
- Reddit says every community has its own rules on top of Reddit-wide rules; current checks must happen per subreddit before submission.
- Reddit's disruptive behavior policy prohibits vote manipulation, including coordinated voting, automation and multiple accounts. Upvotes and comments remain KPI outcomes only.
- Today is Friday, 2026-05-29, so `r/Games` Indie Sunday is not open.

Only allowed Reddit work today: owner-side manual captcha/checkpoint/account verification and no-link normal participation. Do not submit a promotion post until the account is clear and warmed up.

## Sources Checked

- Reddit general rule model: https://support.reddithelp.com/hc/en-us/articles/360043503951-What-are-Reddit-s-rules
- Reddit disruptive behavior / vote manipulation: https://support.reddithelp.com/hc/en-us/articles/360043066412-What-constitutes-vote-cheating-or-vote-manipulation-%5D
- `r/playmygame` removal-avoidance rules: https://www.reddit.com/r/playmygame/comments/1eg08dh/how_to_avoid_having_your_posts_removed_version_2/
- `r/playmygame` 2025 contribution enforcement: https://www.reddit.com/r/playmygame/comments/1m61887/warning_we_are_now_deleting_posts_from_devs_who/
- `r/SurvivalGaming` 2026 mod note: https://www.reddit.com/r/SurvivalGaming/comments/1ssv3hr/mod_note_a_note_from_the_moderator_team_on_some/
- `r/Games` rules / Indie Sunday: https://www.reddit.com/r/Games/wiki/rules/
- `r/playtesters` post guidelines: https://www.reddit.com/r/playtesters/comments/1jccyez/new_post_guidelines/
- `r/WebGames` public rule summary snapshot: https://redplus.ai/en/r/WebGames/
- `r/gamedevscreens` public audience snapshot: https://gummysearch.com/r/gamedevscreens/
- `r/proceduralgeneration` current self-promo discussion: https://www.reddit.com/r/proceduralgeneration/comments/1o365zc/is_there_a_lot_more_driveby_posting_here_than/

## Exact Subreddit Queue

| Priority | Subreddit | Today | Fit | Rule / risk summary | Exact safe format after recovery |
| --- | --- | --- | --- | --- | --- |
| 0 | Tenevik Reddit profile | No post today | Best recovery surface before any subreddit. | Account already tripped removals and `BAD_CAPTCHA`; profile retry should prove account health first. | Manual native GIF/screenshot post, no outbound links in title/body. Public-check for 30-60 min, then one top-level comment with one itch link only if the post survives. |
| 1 | `r/DestroyMyGame` | Hold | Good first subreddit after profile survival: raw gameplay critique, not traffic. | Recent mod-style removals emphasize breathing room and addressing prior critique before reposting. Community is for critique, not release promotion. | Native gameplay GIF/video. Title asks viewers to destroy readability of first expedition loop. No link in body; one itch link in a comment only after survival check and only if allowed/useful. |
| 2 | `r/gamedevscreens` | Hold | Good media-first dev showcase: screenshots/WIP/readability. | It is a branch for screenshots, WIP and concept art; weaker for playable-link acquisition. | One screenshot/GIF post about HUD/Samosbor/readability. No store/direct build link unless rules/comments allow or someone asks. |
| 3 | `r/proceduralgeneration` | Hold | Good technical visibility: procedural textures/sprites/sound/events. | Current community discussion says the sub is relatively tolerant of self-promo when moderate and community-contributing, but trailer/game ads with minor procgen content are weak. | Technical self-post or native media about procedural readability and generated systems. No player-acquisition framing, no public implementation geometry/topology. |
| 4 | `r/SurvivalGaming` | No | The game has hunger/thirst/survival pressure, so the genre fit is real. | PR 34 already got immediate site-wide removal here. Current mod note defines survival fit, removes clickbait, enforces low-effort removal and says small dev promotions are once per week; mods recommend validation/approval before posting. | Only after profile survives and modmail/user approval. Title/body must name the game, mention hunger/thirst/preparation, and stay survival-first. |
| 5 | `r/playtesters` | Hold | Good if the ask is a real playtest, not promotion. | Guidelines allow only text posts; footage/images embedded in text post; `Unpaid Playtest` needs short description and how feedback is collected. | Text post with embedded media, exact first-10-minutes task, feedback route via Reddit comments or short form. No vote asks, no generic "play my game". |
| 6 | `r/playmygame` | No | Free browser playable fit is strong in theory. | PR 37 hit `BAD_CAPTCHA`. Rules require free play, written description, developer involvement, platform flair, monthly cap, no NDA, direct link, and no low-effort submissions; 2025 enforcement expects devs to give real feedback on other games first. | After captcha clear and contribution warm-up: one direct playable post with description and platform flair; comments can satisfy missing media/description pieces. |
| 7 | `r/WebGames` | No | Browser-game fit is strong. | Public rule snapshot says browser-playable, no downloads/signups/plugins, game name at title start, direct individual-game link, avoid reposting within 3 months unless significant update. Old deleted May 24 post makes a quick retry risky. | Wait for a significant update or at least a separate cooldown; direct build link post with game name first and media in first allowed comment. |
| 8 | `r/Games` Indie Sunday | No | High-reach but strict and only on Sunday. | Rules ban direct web-game links normally; Indie Sunday is Sunday-only, text-post-only, requires footage, description, platform/release info, `Indie Sunday` flair, and same game/dev not more than once every 60 days. | Earliest relevant window is Sunday, 2026-05-31, but not before account recovery; use only if profile survives and the 60-day rule is clean. |
| 9 | `r/indiegames` | Hold / modmail | Allows promotion but risky after current removals. | Mod guidance separates promotion from disguised feedback; store/social links are not allowed for feedback posts. | Only manual media-first promotion, not feedback-bait. Prefer modmail first. |
| 10 | `r/IndieGaming` / `r/IndieDev` | Hold | Large but spam-saturated; `r/IndieDev` already removed a prior post. | Current account trust is not good enough; broad indie subs are likely to classify this as another promo. | Revisit after visible non-promo account history and a real milestone. |

## Cooldown And Warm-Up Plan

1. 2026-05-29: no promotion posts. Owner clears Reddit captcha/checkpoint/login manually. Account makes only normal no-link use.
2. 2026-05-30 to 2026-06-01: 3-5 real no-link comments across relevant subs. For `r/playmygame`, play and give useful feedback on at least 3 other games before posting there.
3. First retry: Tenevik profile native-media post from PR 35, no outbound links in title/body. Check logged-out URL and `.json` after 30-60 minutes.
4. If profile post survives 24 hours: add one link comment if not already added and answer real comments.
5. Next subreddit: exactly one of `r/DestroyMyGame`, `r/gamedevscreens` or `r/proceduralgeneration`, selected by objective. Do not blast.
6. Wait 72 hours after any subreddit attempt before another subreddit. If removed, record reason and stop; do not replace it same day.

## Short Owner Instructions

1. Open Reddit in the same real browser/profile used for `u/Educational-Dog-230`.
2. Log in, solve any captcha/checkpoint, verify email if prompted.
3. Open `https://www.reddit.com/appeals`; if it allows an appeal, submit a short honest appeal for the removed posts/account restriction.
4. Add a normal avatar/bio to the profile.
5. Open the profile create-post UI and confirm the image/GIF upload button works. Do not publish.
6. Reply in chat: `Reddit clear`.

Future native-media post must be manual UI upload from `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/`, not remote media URLs and not Reddit API/automation.

## Current Copy To Use Later

Use PR 35 for the first profile recovery post. Use PR 36 for `r/DestroyMyGame`, `r/gamedevscreens` and `r/proceduralgeneration` drafts. Do not reuse PR 32/PR 34 link-heavy drafts and do not reuse deleted old Reddit threads.
