# Reddit / PBBG Publicity Pack - 2026-05-24

Pass time: 2026-05-24 16:33 UTC / 17:33 BST.

Scope: owner asked for English Reddit publicity now that the game has English localization, with screenshots/GIFs, especially for `r/PBBG`, plus other suitable platforms. This pass used six read-only subagents and public rule checks. Initial state was draft-only: no Reddit post, vote, comment, repost, final submit, password access or cookie/token extraction was performed.

Publication update: after owner explicitly said "ПУБЛИКУЙ ВЕЗДЕ", PR 13 executed the safe reachable subset. See `PRCampaign/PR_13.md`.

| Surface | Outcome |
| --- | --- |
| r/PBBG | Published: https://old.reddit.com/r/PBBG/comments/1tmhjtz/gigahrush_a_singleplayer_persistent_browser/ |
| r/WebGames | Published: https://old.reddit.com/r/WebGames/comments/1tmhk3l/gigahrush_free_browser_survival_horror_arpg_in_an/ |
| r/Games Indie Sunday | Published: https://old.reddit.com/r/Games/comments/1tmhl9l/gigahrush_tenevik_games_browser_survival_horror/ |
| r/IndieDev | Posted then removed by moderator/automoderation: https://old.reddit.com/r/IndieDev/comments/1tmhkq5/gigahrush_a_typescriptwebgl_survival_horror_where/ |
| PBBG.com | Submitted for review; not public yet. |
| r/indiegames | Skipped because current rules require media-first handling and create external-link/AI-related ambiguity. GIGAH\|RUSH has playable links; the risk is where/how links may be placed, not the existence of playable links. |

Correction: the earlier r/indiegames wording was imprecise. `r/indiegames` is media-first and restricts external website/store/social links in promotion/feedback-style posts; GIGAH|RUSH itself has playable links. Any future `r/indiegames` attempt must be a native gameplay GIF/screenshot gallery post first, with playable links only where the rules allow. PR 13 also corrected the live Reddit posts by adding direct itch GIF/screenshot URLs to r/PBBG, r/WebGames and r/Games comments.

Existing context:

- Current `r/playmygame` post: https://www.reddit.com/r/playmygame/comments/1tku91k/gigahrush/
- Current 2ch thread: https://2ch.org/b/res/333348764.html
- Direct browser build: https://gigahrush.bileter.workers.dev
- itch.io page: https://tenevik.itch.io/gigahrush
- Current media source: `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/`

## Decision

Superseded by PR 13. The owner explicitly requested publication, so the safe reachable subset was executed: r/PBBG, r/WebGames and r/Games Indie Sunday are live; PBBG.com is submitted for review; r/IndieDev was removed; r/indiegames remains skipped/hold.

Current decision after owner correction: monitor only, no new Reddit posts, no repost of r/IndieDev, and no r/indiegames attempt unless there is a manual media-first rewrite or modmail. Every public post now requires a platform-compliant playable/media plan.

## Current Rule Checks

`r/PBBG`:

- Current public rules welcome developers promoting their PBBGs if the post adds value, tells readers about the game and developer, and the developer engages with questions and criticism.
- Visible current flairs include `Game Advertisement`, `Development`, `Game Update!`, `Showcase` and `Game Review`.
- Risk: audience may expect account/server persistence, clans, multiplayer, idle loops or PvP. Avoid claiming those.

`r/WebGames`:

- Must be a browser-playable web game, direct single-game link, no download, no referral links, no nonstandard plugin/device requirement, no signup gate beyond minimal optional username/password, and title must begin with the game name.
- Best format is a direct link post to `https://gigahrush.bileter.workers.dev`; media belongs in a comment only if useful.

`r/indiegames`:

- Promotion needs native image/GIF/video/gallery gameplay footage.
- Do not disguise promotion as feedback-bait. No question titles like "would you play this?"
- Current public rules also create a high risk around external store/site/social links and generative-AI-related posts. Because campaign notes say English localization and some NPC text used AI assistance/review, skip immediate posting unless the owner rewrites manually or asks mods.

`r/IndieDev`:

- Conditional later target. The audience is peer developers, not general players.
- Prefer a process/tech/readability post with GIFs/screenshots, not a naked play-my-game post.

`r/Games Indie Sunday`:

- Only in the Sunday window, self-post, `Indie Sunday` flair, gameplay footage in the body, developer-only submission, cooldown for the same game/developer. Do not submit a direct link post.

## Media Matrix

Base path: `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/`

| Target | First media | Fallback | Notes |
| --- | --- | --- | --- |
| `r/PBBG` | `contact_sheet_3x3.png` | `11_factions_alife_rank_panel.png` | Lead with systems/persistence: `11`, `07`, `09`, `08_inventory`, `10`; optional motion hook `02_gif_underhell_maronary_samosbor_loop.gif`. |
| `r/WebGames` | none | `01_hero_gif_hell_blinking_eyes.gif` in comment only | Post itself should be the direct browser-game URL. |
| `r/IndieDev` | `10_full_map_route_context.png` or `contact_sheet_3x3.png` | `02_gif_underhell_maronary_samosbor_loop.gif` | Use process/scale/system angle. |
| `r/indiegames` | `01_hero_gif_hell_blinking_eyes.gif` | `04_active_samosbor_monsters.png` | Defer because of link/AI-rule risk. |
| `r/Games Indie Sunday` | `01_hero_gif_hell_blinking_eyes.gif` | `02_gif_underhell_maronary_samosbor_loop.gif` | Gameplay footage is required; static screenshots are support only. |
| PBBG.com directory | `11_factions_alife_rank_panel.png` | `04_active_samosbor_monsters.png` | Final accepted submission used `11_factions_alife_rank_panel.png`; earlier larger contact sheet path hit upload-size trouble. |
| HTML5GameDevs / TIGSource / GameDev.net | `contact_sheet_3x3.png` | `01_hero_gif_hell_blinking_eyes.gif` | Long-form/devlog platforms can include more screenshots. |

## Recommended Order - superseded by PR 13

1. Monitor r/PBBG, r/WebGames and r/Games Indie Sunday.
2. Recheck PBBG.com for approval/public listing URL.
3. Do not repost r/IndieDev immediately.
4. Keep r/indiegames on hold unless owner/manual rewrite or modmail clears external-link/AI-related ambiguity.
5. Use HTML5GameDevs Showcase or TIGSource only as a media-rich devlog/process post with playable links, not as a duplicate Reddit ad.

## r/PBBG Draft

Recommended post type: media/text post if Reddit composer allows text plus images. Attach `contact_sheet_3x3.png` first, then `11_factions_alife_rank_panel.png`, `07_contract_quest_log.png`, `09_trade_grid.png`, `08_inventory_prep_loadout.png`, `10_full_map_route_context.png`, and optionally `02_gif_underhell_maronary_samosbor_loop.gif`.

Recommended flair: `Game Advertisement` if available.

Title:

```text
GIGAH|RUSH - a single-player persistent browser survival horror with A-Life NPCs, factions, and disasters
```

Body:

```text
Hi r/PBBG. I am the developer of GIGAH|RUSH.

This may be an edge case for the sub, so I want to be clear up front: it is a browser-based persistent game, but it is currently single-player, not an MMO or PvP game. The current build now has English localization.

The PBBG-adjacent part is the world simulation. You start in a safer living zone, prepare food, water, ammo, medicine, documents and weapons, then take lifts into hostile floors. NPCs trade, sleep, fight, hide during disasters and can die permanently. Factions control zones, reputation shifts, prices change, quests/contracts send you into dangerous routes, and consequences can remain in the world through browser saves.

The main disaster is Samosbor: doors can seal, fog pushes through cracks, monsters become active, and a floor can change after the alarm ends.

Current build includes preparation, expeditions, combat, trading, inventory, contracts, factions, procedural and authored floors, browser saves, and A-Life NPC persistence.

It is rough in the places dense browser sims are usually rough: onboarding, UI readability, and first-expedition clarity. I have already seen that feedback elsewhere and I am actively using it.

My specific question for this sub: does the persistence / A-Life / expedition loop make this interesting to PBBG players even without MMO or PvP, or would you expect a different direction for it to really belong here?
```

First comment:

```text
Play in browser:
https://gigahrush.bileter.workers.dev

itch.io page / mirror:
https://tenevik.itch.io/gigahrush

No install and no account required. If one host loads slowly, try the other.

I am happy to answer questions about the persistence model, A-Life NPCs, Samosbor, or the tech stack. The most useful feedback would be: where the first expedition becomes confusing, whether the UI is readable, and whether the persistent consequences are visible enough.

Content note: survival horror, combat, corpses, blood, sirens and disturbing procedural events. It is not adult/NSFW.

Gameplay GIFs/screenshots:
https://img.itch.zone/aW1hZ2UvNDU4NzE2MC8yNzQwNDQ4OS5naWY=/original/LTioNh.gif
https://img.itch.zone/aW1hZ2UvNDU4NzE2MC8yNzQwNDQ5MC5naWY=/original/xkmr2K.gif
https://img.itch.zone/aW1hZ2UvNDU4NzE2MC8yNzQwNDQ5OC5wbmc=/original/aAQDl7.png
https://img.itch.zone/aW1hZ2UvNDU4NzE2MC8yNzQwNDQ5OS5wbmc=/original/ZUMFjW.png
```

Why this is not a link dump: it discloses developer affiliation, explains the systems, acknowledges the PBBG fit caveat, asks one community-specific question, and keeps links compact in the comment.

## r/WebGames Draft

Post type: direct link post.

Title:

```text
GIGAH|RUSH - free browser survival horror / ARPG in an endless concrete apartment block
```

Link:

```text
https://gigahrush.bileter.workers.dev
```

First comment:

```text
Developer note: I am affiliated with GIGAH|RUSH. This is an in-development browser build made with TypeScript, WebGL/canvas and procedural assets.

The current build has English localization plus preparation, expeditions, combat, trading, quests, factions, procedural floors, browser saves and A-Life NPCs. It is survival horror, not adult/NSFW.

If you try it, the most useful feedback is browser performance, readability, and where the first expedition becomes confusing.

itch.io mirror:
https://tenevik.itch.io/gigahrush

Gameplay GIFs/screenshots:
https://img.itch.zone/aW1hZ2UvNDU4NzE2MC8yNzQwNDQ4OS5naWY=/original/LTioNh.gif
https://img.itch.zone/aW1hZ2UvNDU4NzE2MC8yNzQwNDQ5MC5naWY=/original/xkmr2K.gif
https://img.itch.zone/aW1hZ2UvNDU4NzE2MC8yNzQwNDQ5Ni5wbmc=/original/jkZMuU.png
https://img.itch.zone/aW1hZ2UvNDU4NzE2MC8yNzQwNDQ5Ny5wbmc=/original/3s0gVC.png
```

## r/IndieDev Draft

Recommended post type: native GIF/video or image gallery. Use `10_full_map_route_context.png`, `contact_sheet_3x3.png`, `11_factions_alife_rank_panel.png`, `07_contract_quest_log.png`, and `02_gif_underhell_maronary_samosbor_loop.gif`.

Title option A:

```text
GIGAH|RUSH: a TypeScript/WebGL survival horror where the building keeps simulating after you leave
```

Title option B:

```text
I am building a browser survival horror where preparation, factions and disasters matter as much as shooting
```

Body:

```text
Hi, I am the developer of GIGAH|RUSH. The attached GIF/screenshots are from the current browser build.

It is a survival horror / ARPG shooter inside an unbounded concrete apartment block. The player prepares food, water, ammo, medicine, documents and weapons, then leaves the safer living area for hostile floors with traders, factions, contracts, monsters and Samosbor disasters.

Tech side: TypeScript/Vite, WebGL raycaster, canvas HUD, procedural textures/sprites/sound, typed-array world storage, no runtime game engine dependency.

Current build has English localization, preparation, expeditions, combat, trading, quests, factions, procedural and hand-made floors, browser saves, A-Life NPC routines and persistent deaths.

I am mainly looking for developer feedback on first-run readability: HUD, map, inventory, and whether the footage communicates the loop before someone clicks through.
```

First comment:

```text
Playable links:

Direct browser build:
https://gigahrush.bileter.workers.dev

itch.io:
https://tenevik.itch.io/gigahrush

I am affiliated with the project. Content note: survival horror, combat, blood, corpses, sirens and disturbing procedural events; not adult/NSFW.

Transparency note: the screenshots/GIFs are captured from the live build, not AI-generated media. Avoid broad "no AI used" claims; disclose if asked that English localization and some NPC text have used AI assistance/review.
```

## r/Games Indie Sunday Draft

Use only during the active Sunday window and only if choosing this instead of `r/PBBG` / `r/WebGames` for the day.

Title:

```text
GIGAH|RUSH - Tenevik Games - browser survival horror / ARPG in a living concrete megastructure
```

Body:

```text
Gameplay footage:
https://img.itch.zone/aW1hZ2UvNDU4NzE2MC8yNzQwNDQ4OS5naWY=/original/LTioNh.gif

Hi r/Games. I am the developer of GIGAH|RUSH, a browser survival horror / ARPG shooter about expeditions inside an endless Soviet-style concrete apartment block. The current build now has English localization.

The player starts from a safer living area, prepares food, water, ammo, medicine, documents and weapons, then leaves for hostile floors with factions, traders, monsters, rumors, quests and shifting routes.

The world keeps moving independently. NPCs trade, sleep, fight, hide from disasters and can die permanently. Factions react to player actions, zones change control, market prices shift, and consequences remain in the world.

The main disaster is Samosbor. It can seal doors, push fog through cracks, wake monsters and alter the floor after the alarm ends.

Current build includes preparation and expeditions, combat, trading, inventory, quests, factions and reputation, procedural and hand-made floors, browser saves, A-Life NPCs and persistent consequences.

The game is playable now in browser and is still in active development. The current goal is to improve expedition pacing, UI readability, survival pressure and the danger curve around Samosbor.

itch.io:
https://tenevik.itch.io/gigahrush

Direct web build:
https://gigahrush.bileter.workers.dev
```

First comment:

```text
Thanks for taking a look. A few notes that may help set expectations:

- The build is free and playable in browser.
- It is not a linear level demo; the intended loop is preparation, expedition, consequences, return.
- The setting and terminology come from Russian-language survival horror/Samosbor fiction, so some names are intentionally unfamiliar in English.
- The feedback I am most interested in is whether the first expedition is readable, whether Samosbor feels threatening, and whether the UI explains enough without slowing the game down.
```

## r/indiegames No-Go Draft Hold

Do not post this immediately. If used later, the owner should rewrite manually or ask mods first because current rules are risky around generated-AI-related posts and external links.

Title option A:

```text
GIGAH|RUSH turns an endless concrete apartment block into a survival horror expedition
```

Title option B:

```text
Samosbor hits in GIGAH|RUSH, my browser survival horror set in a living concrete megastructure
```

Body:

```text
Hi, I am the developer of GIGAH|RUSH. The attached gameplay GIF/screenshots are from the current browser build.

The loop is preparation, expedition, consequences: pack food, water, ammo, medicine, documents and weapons, then leave the safer living area for hostile floors with factions, traders, monsters, contracts, rumors and Samosbor events.

NPCs trade, sleep, fight, hide during disasters and can die permanently. Faction control, market pressure, opened containers and reputation consequences persist across the run.
```

First comment:

```text
Developer note: keeping this media-only because the current r/indiegames promotion rules are strict around store/site/social links. This is survival horror, not adult content; the attached media is captured gameplay from the current build.
```

## PBBG.com Directory Copy

Use only after checking login/form state in a real browser.

Name:

```text
GIGAH|RUSH
```

Primary URL:

```text
https://gigahrush.bileter.workers.dev
```

Secondary URL for description:

```text
https://tenevik.itch.io/gigahrush
```

One-line pitch:

```text
Single-player persistent browser survival horror / ARPG inside an endless concrete apartment block.
```

Short description:

```text
GIGAH|RUSH is a free browser survival horror / ARPG shooter about expeditions inside an endless concrete apartment block. The current build has English localization. You prepare food, water, ammo, medicine, documents and weapons, then leave the safer living area for hostile floors with factions, traders, monsters, contracts and Samosbor disasters. NPCs trade, sleep, fight, hide and can die permanently; faction control, prices, opened containers, reputation and deaths persist through browser saves. It is currently single-player, not an MMO/PvP game.
```

Suggested tags:

```text
browser, survival horror, rpg, arpg, shooter, single-player, persistent, simulation, procedural, webgl
```

Main image used in final PBBG.com submission:

```text
../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/11_factions_alife_rank_panel.png
```

## Owner Needed

- Reddit is monitoring-only after PR 13 unless the owner explicitly requests a new target.
- Before any future final submit, confirm the selected subreddit, post type, flair, playable links and media plan in the live composer.
- Future public posts must have a platform-compliant playable/media plan; direct playable-link submissions satisfy the playable route, with media added through the first allowed comment, gallery, profile/media field, native upload or documented exception.
- After posting, record exact post URL, flair, media used, time, visible score/comment/removal state and whether AutoModerator replied.
- Do not replace removal with an immediate repost. Record removal reason first.

## Sources

- r/PBBG current page/rules: https://www.reddit.com/r/PBBG/
- r/WebGames current page/rules: https://www.reddit.com/r/WebGames/
- r/indiegames current page/rules: https://www.reddit.com/r/indiegames/
- r/IndieDev current page/rules: https://www.reddit.com/r/IndieDev/
- r/Games Indie Sunday/rules context: https://www.reddit.com/r/Games/wiki/rules/
- PBBG.com directory: https://pbbg.com/
