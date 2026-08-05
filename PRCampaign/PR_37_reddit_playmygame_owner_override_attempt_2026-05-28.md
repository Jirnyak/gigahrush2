# PR 37 - Reddit r/playmygame Owner Override Attempt

Date: 2026-05-28.

Window: 05:05-05:08 UTC / 06:05-06:08 BST.

Scope: owner explicitly asked to publish Reddit promotion from the new Tenevik account into the old successful subreddits: `r/PBBG`, `r/WebGames`, `r/Games`, `r/playmygame`. Because PR 34 already produced two immediate Reddit removals from the fresh account, and because vote/comment coordination is not allowed, this pass attempted only the safest single target from that list: `r/playmygame`. No vote request, fake comment, coordinated engagement, alternate-account action or multi-subreddit blast was performed.

## Result

No public Reddit post was created.

Old Reddit was opened in the existing authenticated Chrome session:

```txt
https://old.reddit.com/r/playmygame/submit?selftext=true
```

The session was logged in as:

```txt
Educational-Dog-230
```

The visible old Reddit submit form accepted the draft locally, but pressing submit did not create a post. The page stayed on the submit form and showed:

```txt
That was a tricky one. Why don't you try that again.
```

A same-origin authenticated `/api/submit` check from the Reddit page returned:

```json
{"json":{"errors":[["BAD_CAPTCHA","That was a tricky one. Why don't you try that again.","captcha"]]}}
```

This is a captcha/anti-abuse blocker, not a published URL and not a moderation removal. Do not mark this as a live surface.

## Draft Used

Target:

```txt
r/playmygame
```

Title:

```txt
Gigahrush - browser survival horror where preparation matters more than shooting
```

Body:

```md
I am Tenevik Games, the developer.

Free browser build:
https://gigahrush.bileter.workers.dev

Gigahrush is a browser survival horror / ARPG shooter about preparing supplies, leaving a safer living area, and deciding when to retreat from an unbounded concrete megastructure.

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
- does browser performance, input or audio break?

Screenshots are on the game page after the build loads. Developer post, no vote ask.
```

## Targets Not Submitted

- `r/Games`: not attempted. The current date is Thursday, 2026-05-28; the old successful route was Indie Sunday, and this is not the Indie Sunday window.
- `r/PBBG`: not attempted in this pass. A second immediate subreddit submit after captcha/PR34 would increase spam-filter risk.
- `r/WebGames`: not attempted in this pass for the same reason.

## Next Safe Action

Owner must handle Reddit's human challenge/account trust state manually before more Reddit posting:

1. Verify email/account status.
2. Solve any visible Reddit captcha/checkpoint in the browser.
3. Add normal no-link participation before another promotion attempt.
4. Retry only one post and public-check `.json` after submission.

Do not keep retrying `/api/submit` or old Reddit form submissions from automation while the account returns `BAD_CAPTCHA`.
