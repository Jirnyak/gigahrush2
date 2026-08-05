# GIGAH|RUSH Media KPI Report - 2026-06-05

## Snapshot

| Surface | Status | Signal | Risk | Action |
| --- | --- | --- | --- | --- |
| Pikabu/GamePush hosting | v4 uploaded and published | GamePush project `28314` now serves `https://s3.eponesh.com/games/28314/` with `HTTP/2 200`, `content-length: 13098262`, `last-modified: Fri, 05 Jun 2026 20:15:05 GMT`. Local ZIP is `5,778,238` bytes, SHA-256 `e44a2af01310df177d37b59f65fbe9c835ef1a1abd9e632216f00d6bc10656a2`, strict `gigahrush-portal=pikabu`, no embedded GamePush credential meta. | Public catalog URL is still not confirmed. Hosting success is not the same as live Pikabu listing. | Wait for moderation/public catalog path, then run iframe/cloud-save/mobile/audio QA before announcing. |
| Pikabu/GamePush distribution | Accepted, still blocked by legal account state | Distribution request `6a1783e042934eef948428ed`, platform `PIKABU`, status `ACCEPTED`, `hasPayments=false`, `hasTranslations=false`, no distribution processes listed. | GamePush moderator says they are moving away from physical-person contracts and wants self-employed status. | Owner must complete or confirm NPD/self-employed setup and fill `My Company` with real personal data after moderator clarification. |
| Moderator chat | Reply sent | Developer message sent at `2026-06-05T20:21:50Z`: v4 build reported and exact Self-employed / `My Company` fields requested. | Need to avoid guessing legal fields or accepting agreements without the owner. | Monitor moderator answer; do not resend the same question. |
| Validation | Browser check passed | `npm run check:browser` passed after the fresh package build; browser smoke reported playable render/HUD/scene pixels. | Full GamePush iframe/cloud-save QA is still pending because this pass verified hosted artifact and browser smoke, not the final Pikabu catalog wrapper. | Run iframe QA when GamePush/Pikabu exposes the wrapper or requests final checks. |

## Good Signs

- The stale v3 hosting state is resolved: a fresh v4 is uploaded and publicly served by GamePush hosting.
- The package has the correct root `index.html`, strict Pikabu portal metadata and no committed GamePush secrets.
- Moderator communication is now active again, with a clear question instead of silent waiting.
- The distribution request remains `ACCEPTED` rather than rejected.

## Bad Signs

- The remaining blocker is owner-only legal/tax setup, not something an agent can complete safely.
- There is still no confirmed public Pikabu Games catalog URL.
- GamePush cloud-save and iframe wrapper behavior remain unverified in the actual publication environment.

## Next Actions

1. Monitor the GamePush moderator chat for the self-employed / `My Company` field list.
2. Owner registers or confirms self-employed / NPD status through official FNS `Мой налог` surfaces, then fills GamePush legal data manually.
3. After GamePush accepts the legal state, run actual iframe QA: launch, console, pause/resume, audio pause, mobile scaling, portal content gates and `progress` cloud-save write/read.
4. Only after a public Pikabu catalog URL exists, add it to campaign surfaces and announce it. Do not duplicate-submit project `28314`.
