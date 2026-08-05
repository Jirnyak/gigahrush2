# EN Community Post Wave - 2026-05-23

Status: draft-only, publish-ready copy. No browser/UI actions were used for publishing, and nothing was posted.

Scope: r/WebGames, TIGSource DevLogs, HTML5GameDevs Showcase, GameDev.net.

Media source for every target: `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/`

## Rule Check Snapshot

- r/WebGames: use the local campaign rule notes from `PRCampaign/next_wave_targets_2026-05-23.md` as the working preflight: direct browser link, game name first in title, account at least 7 days old and 10 comment karma. Public rule fetch redirected to Reddit moderator rules UI and did not expose readable rule text in shell, so the owner should open the subreddit rules manually before final submit.
- TIGSource DevLogs: public site context confirms the forum/devlog culture is long-running development discussion, not one-off advertising. Treat this as a devlog thread with process notes and future updates.
- HTML5GameDevs Game Showcase: public forum description says the board is for finished and in-development games and asks to include screenshots if you want promotion; a pinned topic says non-HTML5 games are deleted. GIGAH|RUSH fits because it is HTML5/WebGL/canvas.
- GameDev.net: current community guidelines say to search before duplicates, use clear titles and context, avoid low-effort bumps/repetitive posts, and put project announcements in showcase spaces.

Rule/source URLs checked:

- https://www.reddit.com/r/WebGames/about/rules/
- https://forums.tigsource.com/
- https://www.html5gamedevs.com/forum/8-game-showcase/
- https://www.gamedev.net/guidelines/

## Shared Media Pack

Primary media, in order:

1. `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/01_hero_gif_hell_blinking_eyes.gif`
2. `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/contact_sheet_3x3.png`
3. `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/08_inventory_prep_loadout.png`
4. `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/07_contract_quest_log.png`
5. `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/11_factions_alife_rank_panel.png`

Extra gallery options:

- `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/02_gif_underhell_maronary_samosbor_loop.gif`
- `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/04_active_samosbor_monsters.png`
- `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/06_underhell_gate_pack.png`
- `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/08_living_full_map.png`
- `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/09_trade_grid.png`
- `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/10_full_map_route_context.png`
- `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/12_living_monster_ring_clean.png`

Do not use `.DS_Store`. Do not use Newgrounds, Querygame, GamHub, Fake Portal, FreeZonePlay, Gamemoor or broken itch devlog permalink links in these posts.

## r/WebGames

Decision: conditional ready. Safer timing is 2026-05-24 or 2026-05-25, not same-day 2026-05-23, because r/playmygame is fresh and already live.

Post type: direct link post to the Cloudflare build.

Title:

```text
GIGAH|RUSH - free browser survival horror inside an endless concrete apartment block
```

URL field:

```text
https://gigahrush.bileter.workers.dev
```

Optional comment body by developer:

```text
I am the developer of GIGAH|RUSH. It is a free browser survival horror / ARPG shooter about expeditions inside a huge Soviet-style concrete apartment block.

You prepare food, water, ammo, medicine, documents and weapons, then leave the safer living area for hostile floors with factions, traders, monsters, quests, rumors and Samosbor events. NPCs trade, sleep, fight, hide and can die permanently; factions react to your actions and consequences persist.

itch.io mirror: https://tenevik.itch.io/gigahrush
Game Jolt mirror: https://gamejolt.com/games/gigahrush/1072064

Content note: survival horror atmosphere, monsters, combat, death, corpses, blood, sirens and disturbing procedural events. It is not NSFW.

If you try it, the most useful feedback is where the first run becomes confusing, slow, unreadable or too dark.
```

Attachment paths:

- No attachment for a pure Reddit link post.
- If Reddit requires/encourages media instead, use `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/01_hero_gif_hell_blinking_eyes.gif` and put the direct build in the body/comment.

Link order:

1. `https://gigahrush.bileter.workers.dev`
2. `https://tenevik.itch.io/gigahrush`
3. `https://gamejolt.com/games/gigahrush/1072064`
4. `https://t.me/gigah_rush` only if someone asks for updates/contact.

Tags/flair/category:

- Use no flair unless the subreddit UI requires one.
- If a flair picker exists, choose the closest to `Web Game`, `HTML5`, `Game`, or `Self Promotion`; do not mislabel as trailer/news.

Timing/cooldown risks:

- Medium-high if posted on 2026-05-23 because r/playmygame was already posted the same day.
- Safer window: 2026-05-24 or 2026-05-25.
- Do not repost to r/playmygame for one month.
- Do not ask for upvotes, ratings, comments, follows or wishlists.
- Before final manual submit, owner should confirm the visible r/WebGames rules and account age/comment karma.

## TIGSource DevLogs

Decision: ready as a long-running devlog thread, not a one-off release ad.

Category:

```text
Forums > Townhall / DevLogs
```

Title:

```text
[DevLog] GIGAH|RUSH - browser survival horror in an endless concrete apartment block
```

Body:

```text
Hi, I am Tenevik Games, the developer of GIGAH|RUSH.

GIGAH|RUSH is a free browser survival horror / ARPG shooter about expeditions inside an endless Soviet-style concrete apartment block. The current build runs in the browser with WebGL/canvas rendering, procedural textures, procedural sprites, procedural sound and browser saves.

The main loop is preparation and expedition:

- prepare food, water, ammo, medicine, documents and weapons;
- leave the safer living area through the lift route;
- scavenge hostile floors with factions, traders, monsters, quests, rumors and Samosbor events;
- return with supplies, information and consequences, or die and leave persistent changes behind.

The project is built as a zero-runtime-dependency TypeScript/Vite browser game. Publicly, the world is an unbounded concrete megastructure, with flat entity arrays, typed-array world storage and procedural visuals instead of imported asset packs. NPCs can trade, sleep, fight, hide and die permanently; factions track player behavior; Samosbor events can lock down routes and make familiar space unsafe.

Playable build:
https://tenevik.itch.io/gigahrush

Direct browser build:
https://gigahrush.bileter.workers.dev

Game Jolt mirror:
https://gamejolt.com/games/gigahrush/1072064

I am opening this thread as a devlog, not only a release announcement. The next useful feedback for me is very concrete:

- does the first expedition goal become clear quickly enough?
- where does the UI become unreadable or too dense?
- does the browser build load reliably on your machine?
- does the survival loop feel tense before it becomes confusing?

Content note: survival horror atmosphere, monsters, combat, death, corpses, blood, sirens and disturbing procedural events. It is not NSFW.
```

Attachment paths:

1. `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/01_hero_gif_hell_blinking_eyes.gif`
2. `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/contact_sheet_3x3.png`
3. `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/08_inventory_prep_loadout.png`
4. `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/11_factions_alife_rank_panel.png`

Link order:

1. `https://tenevik.itch.io/gigahrush`
2. `https://gigahrush.bileter.workers.dev`
3. `https://gamejolt.com/games/gigahrush/1072064`
4. `https://www.indiedb.com/games/gigahrush`
5. `https://t.me/gigah_rush`

Tags/flair/category:

- Forum category: DevLogs.
- Suggested tags if available: `devlog`, `browser`, `html5`, `webgl`, `survival-horror`, `procedural`, `arpg`, `shooter`.

Timing/cooldown risks:

- Low if treated as a devlog and updated only when there is real progress.
- Do not bump without screenshots, changelog, technical notes or answered feedback.
- First follow-up should be a real update after feedback or a new build, not earlier than several days unless people reply.

## HTML5GameDevs Showcase

Decision: ready. Strong fit because the game is HTML5/WebGL/canvas.

Category:

```text
HTML5 Game Coding > Game Showcase
```

Title:

```text
GIGAH|RUSH - free HTML5/WebGL survival horror ARPG shooter
```

Body:

```text
Hi everyone,

I am Tenevik Games, the developer of GIGAH|RUSH. It is a free HTML5/WebGL browser survival horror / ARPG shooter set inside an endless Soviet-style concrete apartment block.

The build is playable in the browser:
https://tenevik.itch.io/gigahrush

Direct build:
https://gigahrush.bileter.workers.dev

GIGAH|RUSH is made with TypeScript, Vite, WebGL raycasting and canvas HUD rendering. There are no runtime framework dependencies and no imported asset packs: textures, sprites, sound and many map details are procedural.

Current gameplay includes:

- preparation with food, water, ammo, medicine, documents and weapons;
- expeditions through hostile floors;
- trading, inventory, contracts, quests and rumors;
- factions and reputation;
- A-Life NPCs with persistent deaths and consequences;
- monsters, combat, Samosbor lockdown events and procedural floor variants;
- browser saves.

I would especially appreciate HTML5/WebGL feedback:

- does the first load reach the game reliably?
- any blank canvas, audio unlock or fullscreen issues?
- is the HUD readable on your display?
- does performance hold after entering hostile floors?

Content note: survival horror atmosphere, combat, corpses, blood, sirens and disturbing events. It is not NSFW.
```

Attachment paths:

1. `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/contact_sheet_3x3.png`
2. `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/01_hero_gif_hell_blinking_eyes.gif`
3. `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/02_gif_underhell_maronary_samosbor_loop.gif`
4. `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/08_inventory_prep_loadout.png`
5. `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/10_full_map_route_context.png`

Link order:

1. `https://tenevik.itch.io/gigahrush`
2. `https://gigahrush.bileter.workers.dev`
3. `https://www.indiedb.com/games/gigahrush`
4. `https://gamejolt.com/games/gigahrush/1072064`
5. `https://t.me/gigah_rush`

Tags/flair/category:

- Category: Game Showcase.
- Suggested tags: `html5`, `webgl`, `typescript`, `browser-game`, `survival-horror`, `shooter`, `procedural`.

Timing/cooldown risks:

- Low if posted once with screenshots.
- Do not post if account cannot attach/show screenshots; the forum explicitly values screenshots for promotion.
- Do not cross-post a second HTML5GameDevs thread for the same build.
- Reply only to real technical/gameplay feedback.

## GameDev.net

Decision: ready for Showcase/Project space. Avoid general discussion areas.

Category:

```text
Showcase > Projects > Games and tools
```

Alternative if a forum post is required:

```text
Forums > Your Announcements / Showcase-equivalent project area
```

Title:

```text
GIGAH|RUSH - free browser survival horror / ARPG shooter
```

Body:

```text
Hello GameDev.net,

I am Tenevik Games, the developer of GIGAH|RUSH. It is a free browser survival horror / ARPG shooter about expeditions inside an endless Soviet-style concrete apartment block.

Playable page:
https://tenevik.itch.io/gigahrush

Direct browser build:
https://gigahrush.bileter.workers.dev

The project is a zero-runtime-dependency TypeScript/Vite browser game using WebGL raycasting, canvas HUD rendering, procedural textures, procedural sprites and procedural sound. The current build is focused on one playable survival loop rather than a trailer-only page.

What is in the current build:

- safe-area preparation with food, water, ammo, medicine, documents and weapons;
- hostile floor expeditions through a lift route;
- trading, inventory, contracts, quests and rumors;
- factions, reputation and consequences;
- A-Life NPCs that can sleep, trade, fight, hide and die permanently;
- combat, monsters, Samosbor events and procedural floor variants;
- browser saves.

I am looking for practical feedback from other developers:

- first-run clarity and onboarding;
- browser loading reliability;
- UI readability on desktop/laptop displays;
- performance or canvas/WebGL issues;
- whether the preparation -> expedition -> return loop communicates itself without too much explanation.

Content note: survival horror atmosphere, monsters, combat, death, corpses, blood, sirens and disturbing procedural events. It is not NSFW.

Additional mirrors:
https://gamejolt.com/games/gigahrush/1072064
https://www.indiedb.com/games/gigahrush
```

Attachment paths:

1. `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/contact_sheet_3x3.png`
2. `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/01_hero_gif_hell_blinking_eyes.gif`
3. `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/07_contract_quest_log.png`
4. `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/09_trade_grid.png`
5. `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/11_factions_alife_rank_panel.png`

Link order:

1. `https://tenevik.itch.io/gigahrush`
2. `https://gigahrush.bileter.workers.dev`
3. `https://gamejolt.com/games/gigahrush/1072064`
4. `https://www.indiedb.com/games/gigahrush`
5. `https://t.me/gigah_rush`

Tags/flair/category:

- Category: Showcase / Projects / Games and tools.
- Suggested tags: `browser`, `html5`, `webgl`, `typescript`, `survival horror`, `arpg`, `shooter`, `procedural`.

Timing/cooldown risks:

- Low-medium if posted to Showcase/Projects with enough context.
- High if posted as a generic advertisement in discussion forums.
- Search for an existing GIGAH|RUSH entry before posting to avoid duplicate showcase content.
- Do not bump without a real changelog, bugfix, media update or reply to feedback.

## Recommended Order

1. HTML5GameDevs Showcase: best technical/platform fit and low overlap with current Reddit activity.
2. TIGSource DevLogs: best for a durable devlog thread, but only if the owner intends to return with updates.
3. GameDev.net Showcase: useful developer feedback surface; keep it in project/showcase areas.
4. Reddit after PR 13: r/PBBG, r/WebGames and r/Games Indie Sunday are live; r/IndieDev was removed. Keep Reddit monitoring-only unless the owner explicitly requests a new target, and require a platform-compliant playable/media plan for any future public post.

## Global Guardrails

- Manual posting only; no agent automation, no blind final-click, no UI publishing in this pass.
- Developer affiliation must stay explicit.
- No vote/karma/rating/upvote/follow asks.
- No duplicate body copy across platforms after publication; these drafts are already tailored, but manual posters should not paste the same intro everywhere if editing live.
- Use survival horror content warning; do not label as NSFW/adult unless the platform forces a stricter category.
- Prefer itch.io first on forum/devlog platforms because it is a stable landing page, but prefer direct Cloudflare first on r/WebGames because that subreddit is for direct browser play.
- Keep Newgrounds out of active links until the RIP/9B upload blocker is resolved.
- Keep the broken itch devlog permalink out of all posts; use the game page or devlog index only if needed.
