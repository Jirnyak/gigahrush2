# PR 73 - Pikabu/GamePush v4 update and self-employed blocker

Date: 2026-06-05 20:05-20:25 UTC / 21:05-21:25 BST.

## What Happened

- Rebuilt the strict Pikabu/GamePush package with `npm run pikabu:build`.
- Ran `npm run check:browser`; the browser smoke passed.
- Uploaded `pikabu/gigahrush-pikabu.zip` to GamePush project `28314` and published it from draft to hosting v4.
- Verified public hosting at `https://s3.eponesh.com/games/28314/`: `HTTP/2 200`, `content-length: 13098262`, `last-modified: Fri, 05 Jun 2026 20:15:05 GMT`.
- Verified the local upload ZIP: `5,778,238` bytes, SHA-256 `e44a2af01310df177d37b59f65fbe9c835ef1a1abd9e632216f00d6bc10656a2`, root `index.html`, `gigahrush-portal=pikabu`, no embedded GamePush credential meta.
- Rechecked GamePush distribution: request `6a1783e042934eef948428ed`, project `28314`, platform `PIKABU`, status `ACCEPTED`, `hasPayments=false`, `hasTranslations=false`, no distribution processes listed.
- Sent a moderator-chat reply at `2026-06-05T20:21:50Z`: reported the new v4 build and asked which `My Company` / Self-employed fields or documents are required for the self-employed transition.

## Moderator Context

GamePush/Pikabu previously wrote that they are happy to take the game, but are moving away from physical-person contracts because that route is uneconomical for them. They asked the owner to switch to self-employed status.

The outgoing message did not claim that self-employed status is already active. It only said that the legal-status transition is being clarified and asked for exact fields/documents before delaying publication.

## Owner-Only Blocker

Do not automate or fake this step. The remaining blocker is personal legal/tax setup:

- Register or confirm self-employed / NPD status through official FNS surfaces such as `https://npd.nalog.ru/app/` or `https://npd.nalog.ru/web-app/`.
- Wait for GamePush moderator answer about the exact `My Company` fields and documents.
- Fill `My Company` as Self-employed only with the owner present and only with real personal data.
- Do not accept distribution/legal/payment agreements by agent automation.

Useful official FNS references checked on 2026-06-05:

- `https://npd.nalog.ru/app/`
- `https://npd.nalog.ru/web-app/`
- `https://npd.nalog.ru/check-status/`

## Current State

Pikabu/GamePush is no longer blocked by a stale build. The current external blockers are moderation response, owner-side self-employed legal setup, `My Company` completion, and real iframe/cloud-save QA after GamePush exposes a usable preview or publication path.

No public Pikabu catalog URL was found or announced in this pass. No duplicate Pikabu submission, public announcement, vote/rating, legal acceptance or payment setup was performed.
