# GIGAHRUSH NPC Hosted Intake

Optional hosted submission/review pipeline for community NPC questionnaire
packages. This folder is part of the single `gigahrush-npc-intake` subproject.
The local ZIP export remains the required first path; this service only
receives already validated ZIPs and stores review metadata for TENEVIK GAMES.

## Chosen Path

Cloudflare Worker/Pages-style frontend:

```txt
public upload page
  -> POST /api/submit
  -> R2 bucket NPC_SUBMISSIONS for ZIP/image files
  -> D1 database NPC_DB for metadata/status/rate limits
  -> optional Turnstile server-side validation
  -> private /api/review/* endpoints for TENEVIK review
```

No game runtime source, root `wrangler.jsonc`, game save shape, or NPC importer
code is changed when this folder is deployed as a separate service. The main
game Worker can also reuse the same handler behind `/api/npc-intake/*` so the
online `/npc-intake/` form can submit directly to the developer inbox.

## Bindings And Privacy

Required bindings:

- `NPC_SUBMISSIONS`: private R2 bucket. Stores submitted ZIPs, optional source sprite and optional preview PNG.
- `NPC_DB`: D1 database with `cloudflare/npc_intake.sql`.
- `TENEVIK_REVIEW_TOKEN`: private review token. Set as a Cloudflare secret/variable, not in committed config.
- `TURNSTILE_SECRET_KEY`: optional but expected for production. When present, `/api/submit` validates the token server-side.

Private contact is stored only in D1 review metadata. It is not returned by public submit responses and must not be copied into `npc.json`. Accepted folders still carry `consent.json` for reviewer provenance.

Takedown or correction requests should be handled through the private contact stored on the authenticated review page. Public credits can be changed during review without exposing the private contact in the exported game package.

## Submission API

`POST /api/submit` accepts `multipart/form-data`:

```txt
metadataJson   required JSON string
packageZip     required ZIP file, max 2 MB
sourceSprite   optional image file, max 512 KB
previewPng     optional PNG preview, max 256 KB
turnstileToken optional locally, required when TURNSTILE_SECRET_KEY is configured
```

`metadataJson` fields:

```json
{
  "packageId": "stable_snake_case",
  "authorDisplayName": "name shown to reviewer",
  "authorContactPrivate": "private contact for moderation only",
  "publicCreditName": "public credit line",
  "consentAccepted": true,
  "consentAcceptedAt": "2026-06-05T12:00:00.000Z",
  "schemaVersion": 1,
  "packageHash": "sha256 of uploaded ZIP",
  "spriteHash": "sha256 of sprite.rle.json",
  "preview": {
    "publicLine": "short Demos-style bio",
    "floorLabel": "preferred route/floor label",
    "faction": "faction id or label",
    "occupation": "occupation id or label",
    "age": 41,
    "sex": "male",
    "relationBand": "neutral",
    "samplePost": "sample Demos post",
    "sampleTalk": "sample ambient talk line"
  }
}
```

Validation rejects missing consent, oversized uploads, non-ZIP package MIME/magic, non-image source uploads, bad schema version, mismatched package hash, bad sprite hash, invalid package id, and public text containing implementation terms such as map dimensions, toroidal topology, source paths or save-shape internals.

## Review API

All review endpoints require either:

```txt
Authorization: Bearer <TENEVIK_REVIEW_TOKEN>
```

or:

```txt
X-Tenevik-Review-Token: <TENEVIK_REVIEW_TOKEN>
```

Endpoints:

```txt
GET  /api/review/submissions
POST /api/review/submissions/<submissionId>/status
GET  /api/review/submissions/<submissionId>/download
GET  /api/review/submissions/<submissionId>/export
```

Statuses:

```txt
submitted -> needs_review -> accepted | rejected -> imported
```

`/export` works only for `accepted` or `imported` submissions and returns the approved game-repo destination:

```txt
src/data/npc_packages/community/<npc_id>/
  npc.json
  sprite.rle.json
  README.md
  consent.json
```

The hosted review decision is not runtime trust. The game-side importer still validates `npc.json`, `sprite.rle.json` and consent before the package can be committed.

## Setup

1. Copy `../wrangler.example.jsonc` to the subproject root as `wrangler.jsonc`.
2. Create R2 bucket `gigahrush-npc-submissions`.
3. Create D1 database `gigahrush-npc-intake`.
4. Replace the D1 database id in `wrangler.jsonc`.
5. Apply `hosted/cloudflare/npc_intake.sql` to the D1 database.
6. Set `TENEVIK_REVIEW_TOKEN` and production `TURNSTILE_SECRET_KEY` in Cloudflare.
7. Deploy this folder as the separate intake Worker/Pages project.

Useful Cloudflare docs verified for this scaffold:

- Pages Functions bindings: https://developers.cloudflare.com/pages/functions/bindings/
- R2 Workers API: https://developers.cloudflare.com/r2/api/workers/
- D1 prepared statements: https://developers.cloudflare.com/d1/worker-api/prepared-statements/
- Turnstile server-side validation: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

## Google MVP Fallback

If Cloudflare account setup is blocked, keep the local ZIP export and receive files manually:

```txt
Google Form with file upload
  -> private Drive folder
  -> Sheet index with packageId, publicCreditName, contact, consent timestamp, status
  -> manual TENEVIK review
  -> copy accepted ZIP contents into src/data/npc_packages/community/<npc_id>/
```

The fallback must still require consent before upload and must not expose private contact in the game package.
