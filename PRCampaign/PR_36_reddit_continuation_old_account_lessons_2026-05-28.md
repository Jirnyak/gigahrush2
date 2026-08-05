# PR 36 - Reddit Continuation From Old Account Lessons

Date: 2026-05-28.

Window: 04:59 UTC / 05:59 BST.

Scope: owner asked to continue Reddit work because older account posts had better survival, and said the campaign needs Reddit posts, upvotes and comments. This pass used four read-only subagents, local campaign docs and public Reddit/Reddit-policy checks. No Reddit post, comment, vote, profile edit, modmail, final click or account action was made.

## Hard Guardrail

Upvotes are a KPI outcome, not an action request.

Allowed:

- publish rule-compliant posts after cooldown/account warm-up;
- attach native gameplay media;
- ask concrete gameplay feedback questions;
- reply to real comments as the developer;
- record score/comment/removal states.

Not allowed:

- asking for upvotes, boosts, visibility or algorithm help;
- coordinating votes or comment piles through friends, Telegram, Discord, agents or alternate accounts;
- fake player comments, paid votes, bots, vote exchanges or karma farms;
- reposting removed content immediately or using old Reddit/API routes as enforcement evasion.

Reference: Reddit's `Disrupting Communities` policy prohibits manual/programmatic vote manipulation and coordinated voting; Reddiquette says not to hint at asking for votes, not to send messages asking people to vote, and not to create mass vote campaigns.

## Current Public Recheck Of Old Reddit Posts

The old-account posts are useful as lessons, but not as current live surfaces.

Public `.json` recheck on 2026-05-28 showed these posts now as deleted by the author/account:

| Surface | URL | Current public state | Useful signal |
| --- | --- | --- | --- |
| `r/playmygame` | https://www.reddit.com/r/playmygame/comments/1tku91k/gigahrush/ | `author:"[deleted]"`, `selftext:"[deleted]"`, `removed_by_category:"deleted"`, score `1`, one AutoModerator comment. | The subreddit accepted the post format originally, but no useful human comment remains. |
| `r/PBBG` | https://old.reddit.com/r/PBBG/comments/1tmhjtz/gigahrush_a_singleplayer_persistent_browser/ | `author:"[deleted]"`, `selftext:"[deleted]"`, `removed_by_category:"deleted"`, score `1`, upvote ratio `0.6`, comments `1`. | One visible real question asks about screen-reader accessibility. Use accessibility as a future honest response/theme, not as a bump. |
| `r/WebGames` | https://old.reddit.com/r/WebGames/comments/1tmhk3l/gigahrush_free_browser_survival_horror_arpg_in_an/ | `author:"[deleted]"`, `selftext:"[deleted]"`, `removed_by_category:"deleted"`, score `1`, comments `0`. | Direct browser-game link format fit the subreddit when the account was trusted. |
| `r/Games` Indie Sunday | https://old.reddit.com/r/Games/comments/1tmhl9l/gigahrush_tenevik_games_browser_survival_horror/ | `author:"[deleted]"`, `selftext:"[deleted]"`, `removed_by_category:"deleted"`, score `2`, upvote ratio `0.53`, comments `0`. | Indie Sunday format worked enough to survive initial checks, but large-sub reach remained weak. |

Do not revive these threads with the new account. A new Tenevik account commenting under old deleted self-promo posts can look like evasion or a duplicate bump.

## What Worked Before

Reusable pattern:

- visible developer disclosure;
- non-NSFW survival-horror framing;
- one clear playable route;
- media or media comment;
- audience-specific angle;
- concrete feedback ask;
- no vote requests.

Specific lessons:

- `r/WebGames` wants a direct browser-playable link and a title that starts with the game name.
- `r/PBBG` needs a precise caveat: single-player/local persistence, not MMO/PvP/server economy.
- `r/Games` only fits the Indie Sunday format/window and should not be repeated casually.
- `r/IndieDev` failed as a release-promo attempt; if reused, it needs a process/readability/technical critique angle.

## Next Safe Reddit Order

1. Do not post more Reddit today from `u/Educational-Dog-230`.
2. Warm up and verify the Tenevik account first.
3. Run the PR 35 profile-native-media recovery post.
4. Public-check the profile post logged-out and via `.json`.
5. If the profile post survives, use exactly one subreddit attempt, not a blast.
6. First subreddit after survival check: `r/DestroyMyGame`.
7. Second wave after a separate cooldown: `r/gamedevscreens` or `r/proceduralgeneration`, depending on whether the goal is player feedback or technical visibility.

## Ranked Reddit Targets

| Rank | Target | Status | Angle | Guardrail |
| --- | --- | --- | --- | --- |
| 1 | `r/DestroyMyGame` | Best next feedback fit after profile survival. | Raw gameplay critique: can viewers tell what matters in the first expedition? | Native GIF/video only, no release title, no link body, engage with critique. |
| 2 | `r/gamedevscreens` | Good media-first dev-showcase candidate. | HUD/Samosbor/readability screenshot or GIF. | No direct build link as the point of the post; link only if rules/comments allow or someone asks. |
| 3 | `r/proceduralgeneration` | Good technical visibility candidate. | Procedural textures, sprites, sound, A-Life placement and events. | No player-acquisition framing and no public implementation-geometry details. |
| 4 | `r/IndieGaming` | Hold until the account has age/history. | Original gameplay GIF/devlog. | Avoid feedback-bait titles; no store/social link in feedback-style post. |
| 5 | `r/roguelikedev` | Conditional thread-only candidate. | Sharing Saturday / Feedback Friday if framed as procedural WIP feedback. | Do not overclaim "roguelike"; avoid `r/roguelikes` promo. |
| 6 | `r/SurvivalHorror` | Modmail-first. | Browser survival horror with current gameplay GIF. | Do not post without permission. |
| 7 | `r/HorrorGaming` | No-go unless mods approve and release footing is stronger. | Horror-game showcase, not playtest. | Current feedback-seeking build is too risky as a normal post. |
| 8 | `r/html5games` | Lower reach fallback. | Direct HTML5/WebGL browser build. | Use only after trusted-account recovery; `r/WebGames` already covered the better version. |

Hold/no-go:

- `r/indiegames`: hold. It allows promotion, but current rule discussions distinguish promotion from feedback-bait and restrict store/social links in feedback posts; the GenAI rule/risk also needs manual care.
- `r/gamedev` / `r/GameDevelopment`: no release-promo. Use only for a genuine educational/postmortem article.
- `r/playtesters`: only if the ask is a real playtest request, not promotion.

## Draft 1 - r/DestroyMyGame

Use after PR 35 profile post survives. Native media first:

- Main: `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/02_gif_underhell_maronary_samosbor_loop.gif`
- Backup: a 20-40 second raw gameplay clip if owner records one.

Title:

```txt
Destroy the first expedition loop: can you tell what matters from this gameplay?
```

Body:

```md
I am the developer. I need critique on readability, not praise.

This is a browser survival horror / ARPG shooter about preparing supplies, leaving a safer area and deciding when to retreat from an unbounded concrete megastructure.

The intended loop is:

- prepare food, water, medicine and ammo
- choose a contract or route lead
- enter a hostile floor
- trade, fight, loot or retreat
- survive a Samosbor event if it catches you away from shelter
- return with consequences

Please destroy the footage:

- can you tell what the player should care about?
- is the HUD too dense?
- does combat read clearly?
- does it look like survival pressure or just visual noise?
- what would make you close the tab?

Developer post. I will answer critique and can add one play link in a comment if useful.
```

Single comment only if allowed and only after the post survives public checks:

```md
Play / screenshots:
https://tenevik.itch.io/gigahrush

I am keeping this focused on critique, not traffic. The most useful notes are about first-run readability, HUD density and why you would quit.
```

## Draft 2 - r/gamedevscreens

Native media:

- Main: `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/04_active_samosbor_monsters.png`
- Optional: `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/08_inventory_prep_loadout.png`

Title:

```txt
Working on readability for a browser survival horror expedition loop
```

Body:

```md
I am the developer of GIGAH|RUSH, a browser survival horror / ARPG shooter.

The game is built around a practical loop: prepare supplies, enter a hostile floor, trade or fight, survive Samosbor if it hits, and get back with consequences.

I am trying to make the screenshots readable before anyone clicks a build:

- does the threat read clearly?
- is the HUD too dense?
- can you tell inventory/preparation matters?
- does the screen look like a survival situation, not just a shooter?

Current gameplay media, developer post.
```

No link in the body. Add a single itch link only if rules allow or someone asks for it.

## Draft 3 - r/proceduralgeneration

Native media:

- Main: `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/contact_sheet_3x3.png`
- Optional: `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/10_full_map_route_context.png` only if cropped/captioned without revealing implementation geometry as the public hook.

Title:

```txt
Procedural textures, sprites, sound and events for a browser survival horror
```

Body:

```md
I am building a browser survival horror / ARPG shooter where the visuals and sound are generated by code rather than imported asset packs.

The procedural side has to support gameplay decisions, not just decoration:

- materials need to communicate room type and danger
- sprites need to read at raycaster distance
- sound cues need to hint at Samosbor and nearby threats
- generated rooms and events need to produce reasons to prepare, retreat or risk another route
- NPC/faction state needs to leave visible consequences

The setting is an unbounded concrete megastructure, so I am avoiding public implementation-geometry details and focusing on player-facing readability.

I am looking for feedback on whether the procedural look communicates threat, materials and interactable space clearly enough.
```

Optional single comment:

```md
Build / screenshots:
https://tenevik.itch.io/gigahrush

I am interested in procedural readability and browser performance feedback more than traffic.
```

## Comment Hooks That Can Create Real Discussion

Use these instead of asking for comments/upvotes:

- "What is unclear after spawn?"
- "Does preparation feel useful before the first expedition?"
- "Is the HUD readable, or does it become noise?"
- "Where would you quit, and what happened right before that?"
- "Does this read as survival horror, or just a shooter with meters?"
- "What browser/device did you use, and did canvas/input/audio break?"
- "Could this ever be screen-reader accessible, or should I treat that as a separate mode?"

## Current Next Action

Reddit public action remains on hold after PR 34 unless owner explicitly accepts the risk of another removal. The productive work from this pass is the target queue, three safer post drafts and a clear engagement boundary: get comments by asking concrete player/developer questions, not by coordinating engagement.
