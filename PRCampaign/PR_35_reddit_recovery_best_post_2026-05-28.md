# PR 35 - Reddit Recovery Best Post

Date: 2026-05-28.

Window: 04:52 UTC / 05:52 BST.

Scope: owner asked why Reddit is "hating" the new Tenevik account and asked to make the best next Reddit post using KPI/campaign experience. No Reddit post, comment, vote, profile edit, modmail or final-click action was made in this pass.

## Diagnosis

This does not look like ordinary audience hate. PR 34 showed two API-accepted posts that were removed immediately before public users could engage:

- Tenevik profile post `t3_1tpt6cp`: `removed_by_category:"content_takedown"`, `removal_reason:"legal"`.
- `r/SurvivalGaming` post `t3_1tptb5c`: `removed_by_category:"reddit"`.

Most likely risk factors:

- Fresh Reddit account with little or no public trust history.
- Immediate external-link-heavy promotion from the account.
- Multiple URLs in the first posts: direct build, itch, MyIndie, Pikabu and media URLs.
- Mixed title/body branding with `GIGAH|RUSH / ГИГАХРУЩ`, Cyrillic and broad promo wording.
- Fast automated/API submissions after browser upload failures.
- A second subreddit attempt soon after an immediate profile removal.

Old Reddit is only a UI. It does not bypass Reddit's site-wide trust/filtering layer. Posting the same thing through old.reddit.com, or replying into old Reddit threads from the new account, can look like evasion or a duplicate bump.

## Recovery Rule

Do not submit another Reddit post today from `u/Educational-Dog-230`.

Best next Reddit move:

1. Cool down for at least 48-72 hours.
2. Verify the account email, add a normal profile/bio/avatar if owner has not done so.
3. Browse and make a few normal no-link comments only where genuinely relevant.
4. Retry with one profile post first, not a subreddit post.
5. Use native Reddit media manually uploaded by the owner through the UI. Do not use remote media URL dumps.
6. Put zero outbound links in the title/body.
7. After the public `.json` and logged-out page show the post is not removed for 30-60 minutes, add one top-level comment with one link.
8. Use only one first link. Recommended first link: `https://tenevik.itch.io/gigahrush`, because it carries screenshots/GIF and the playable page. Use `https://gigahrush.bileter.workers.dev` later if direct browser friction is the feedback target.

## Best Recovery Post

Target: Tenevik profile first. Do not post to `r/SurvivalGaming` until the profile post survives.

Manual attachment:

- Main: `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/02_gif_underhell_maronary_samosbor_loop.gif`
- Fallback still if GIF upload fails: `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/contact_sheet_3x3.png`
- Optional second media only if Reddit gallery upload works cleanly: `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/08_inventory_prep_loadout.png`

Title:

```txt
I made a browser survival horror where preparation matters more than shooting
```

Body:

```md
I am Tenevik Games, the developer.

I am testing a browser survival horror / ARPG shooter about leaving a safer living area, preparing supplies, and deciding when to retreat from an unbounded concrete megastructure.

The first run should be understandable from play alone:

- stock food, water, medicine and ammo
- take a contract or route lead
- enter a hostile floor
- trade, fight, loot or retreat
- survive a Samosbor event if it catches you away from shelter

I need blunt feedback on the first 10 minutes:

- what is unclear after spawn?
- is the HUD readable?
- does preparation feel useful?
- does survival pressure make sense?
- what made you quit?

Developer post. Screenshots/GIF are current gameplay.
```

First comment only after public survival check:

```md
Play / screenshots:
https://tenevik.itch.io/gigahrush

I am keeping the first post light because this is a new developer account and I want feedback, not a link dump.
```

Direct-build comment variant, use only instead of the itch comment if the goal is browser-load feedback:

```md
Browser build:
https://gigahrush.bileter.workers.dev

I am keeping the first post light because this is a new developer account and I want feedback, not a link dump.
```

Do not post both links initially.

## If A Subreddit Retry Is Needed Later

Use only after the profile post remains public.

Candidate title:

```txt
I need feedback on whether my browser survival horror reads as survival, not just a shooter
```

Body:

```md
I am the developer of a browser survival horror / ARPG shooter.

The intended loop is practical:

- prepare supplies in a safer area
- choose a contract or route lead
- go into a hostile floor
- trade, fight, loot or retreat
- survive a Samosbor event if it catches you away from shelter
- return with consequences

I am trying to make preparation matter more than raw shooting.

Questions I need answered:

- does the first objective read clearly?
- does the HUD explain enough without a guide?
- does the survival pressure feel legible?
- does the media make you understand the game before clicking?

Developer post. I can add the play link in a comment if that is useful.
```

First comment after survival check:

```md
Play / screenshots:
https://tenevik.itch.io/gigahrush

I am the developer, posting from the new Tenevik Games account.
```

## What Not To Do

- Do not repost the PR 32 or PR 34 link-heavy copy.
- Do not include MyIndie, direct build, itch, Pikabu and Telegram all in the first Reddit body.
- Do not use `GIGAH|RUSH / ГИГАХРУЩ` in the retry title.
- Do not comment from the new account into old self-promo Reddit threads just to surface the game again.
- Do not use old `jirnyak` identity or old account surfaces for new Tenevik promotion.
- Do not ask for votes, boosts, comments or algorithm help.
- Do not mark a Reddit retry as live until a logged-out/public `.json` check confirms it is not removed.

## Durable Status

Prepared only. Reddit remains on hold after PR 34. The next agent should treat this file as the recovery copy and should not submit it until the owner explicitly chooses to retry after cooldown/account warm-up.
