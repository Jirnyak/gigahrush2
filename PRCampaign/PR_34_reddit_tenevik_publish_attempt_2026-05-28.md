# PR 34 - Reddit Tenevik Publish Attempt

Date: 2026-05-28.

Window: 04:36-04:44 UTC / 05:36-05:44 BST.

Scope: owner said they were already logged in through Chrome/Chromium and asked to publish on Reddit from the new Tenevik Reddit account. The active Reddit session was `u/Educational-Dog-230`. Actions were made only through the authenticated Chrome Reddit session and Reddit's own submit APIs; no votes, bumps, modmail, mass posting or hidden/fake engagement were performed.

## Result

No live Reddit surface survived public verification.

Two posts were accepted by Reddit's create API, but both were removed immediately by Reddit site-wide filtering before they became usable public posts:

| Target | API result | Public verification | Status |
| --- | --- | --- | --- |
| Tenevik profile / `u/Educational-Dog-230` | `CreateProfilePost` returned `ok:true`, post id `t3_1tpt6cp`, permalink `/user/Educational-Dog-230/comments/1tpt6cp/gigahrush_гигахрущ_free_browser_survival_horror/`. | Public `.json` returned title `[ Removed by Reddit ]`, `selftext:"[removed]"`, `removed_by_category:"content_takedown"`, `removal_reason:"legal"`, `is_robot_indexable:false`, score `1`, comments `0`. Canonical public URL redirects to `https://www.reddit.com/r/u_Educational-Dog-230/comments/1tpt6cp/removed_by_reddit/`. | Removed by Reddit. Do not repost the same profile copy. |
| `r/SurvivalGaming` | `CreatePost` returned `ok:true`, post id `t3_1tptb5c`, permalink `/r/SurvivalGaming/comments/1tptb5c/i_released_gigahrush_a_free_browser_survival/`. | Public `.json` returned `selftext:"[removed]"`, `removed_by_category:"reddit"`, `removal_reason:null`, `is_robot_indexable:false`, over_18 `false`, score `1`, comments `0`. | Removed by Reddit. Do not duplicate or crosspost today. |

## What Was Tried

- Native Reddit image upload from local screenshots was attempted first. It was blocked by browser/platform constraints: synthetic `FileList` assignment reset, local fetch from a temporary `127.0.0.1` media server failed from the Reddit page, and macOS UI scripting for the file picker is blocked because `osascript` does not have Assistive Access.
- The profile self-post therefore used direct playable links plus public itch-hosted screenshot/GIF URLs. Reddit accepted the API request but removed the post immediately.
- A cleaner profile retry was attempted as a link-oriented post with only itch/direct/MyIndie links. Reddit's new profile route returned `PROFILE_SUBREDDIT_NOEXIST`, and the old `/api/submit` endpoint returned `403`; those retry attempts did not create public posts.
- One planned subreddit post was made to `r/SurvivalGaming` with a survival/first-expedition feedback angle, developer disclosure, direct build link and itch page for screenshots/GIF. Reddit accepted the API request but removed the post immediately.
- The temporary local media server used during upload testing was stopped after the pass.

## Posted Copy Summary

Profile post angle:

- Developer disclosure: `I am Tenevik Games`.
- Project: `GIGAH|RUSH / ГИГАХРУЩ`.
- Game description: free browser survival horror / ARPG shooter about expeditions into an unbounded concrete megastructure.
- Links included: direct build, itch mirror, MyIndie, Pikabu devlog, three public itch media URLs.

`r/SurvivalGaming` angle:

- Developer disclosure in the first line.
- Survival loop: preparation, contracts/rumors, hostile floor entry, trade/fight/loot/retreat, Samosbor, consequences.
- Links included: direct build and itch page for screenshots/GIF.
- Feedback ask: first objective clarity, UI readability, survival pressure, browser performance and first-expedition comprehension.

## Interpretation

This looks like Reddit site-wide filtering on a fresh account and/or external-link-heavy posts, not subreddit moderator feedback:

- The profile post was removed with `removed_by_category:"content_takedown"` / `removal_reason:"legal"`.
- The `r/SurvivalGaming` post was removed with `removed_by_category:"reddit"`.
- Neither public verification showed useful text, media or clickable links after removal.

Do not keep retrying with the same account today. More attempts would look like duplicate spam and may make the account harder to recover.

## Next Safe Actions

1. Put Reddit on hold for at least a cooldown period; do not repost the same copy to profile or subreddits.
2. Owner should verify the Reddit account, add a normal profile/bio, browse/comment normally, and check whether Reddit shows account warnings, shadow restrictions or removal notices.
3. If Reddit is retried later, use one very small post first: one itch link or one direct build link, no media URL dump, no broad subreddit target, then verify public `.json`.
4. Use other surfaces for today's attention push instead: Tenevik-owned X/Grok-visible post, EN media pitches, or RU/CIS community surfaces where the Tenevik identity is already trusted.
5. Keep the removed post URLs in logs for traceability, but do not promote them as live surfaces.
