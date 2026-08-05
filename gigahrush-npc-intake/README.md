# gigahrush-npc-intake

Standalone dependency-free subproject for `NpcPackageDef` questionnaires.

It is the single home for:

- the local browser form that builds and validates user NPC questionnaires;
- the local catalog viewer for existing game-authored questionnaires;
- the optional hosted Cloudflare upload/review pipeline under `hosted/`.

The form exposes only three author-facing NPC kinds:

- `plot`: a locked story/quest/death contract;
- `design`: an authored person for a story/design route stop or scene;
- `procedural`: a named ordinary A-Life resident driven by faction, occupation and placement.

Placement fields such as `presence` and `mobility` are technical runtime routing,
not extra kinds.

Identity is one game-facing name: `identity.displayName`. The form does not ask
for a required surname or patronymic because many in-game NPCs intentionally have
only the name shown in the game.

Run locally:

```bash
cd gigahrush-npc-intake
npm run sync:lookups
npm run dev
```

Open the printed local URL. The site builds the NPC package in the browser,
normalizes a sprite into `gigahrush_sprite_rle_v1`, renders a Demos-style
preview, shows the existing game-authored questionnaire summaries generated
from the game package registry with source file context, fills the form from a
ready questionnaire when its card is clicked, and exports a local ZIP:

```txt
<npc_id>/
  npc.json
  sprite.rle.json
  portrait.png
  preview.png
  consent.json
  source.png
  README.md
```

The main game exposes this subproject from the run setup screen through
`ДОБАВИТЬ ПЕРСОНАЖА`. In Vite dev and production builds that route is
`/npc-intake/`; it opens as a normal browser document outside the game canvas
and pointer-lock loop.

When served from the main online game, the form can POST a validated ZIP to the
same-origin `/api/npc-intake/submit` inbox. That endpoint stores the ZIP in the
configured Cloudflare R2 `NPC_SUBMISSIONS` bucket, stores review metadata in the
configured D1 `NPC_DB` database, and returns a submission id for TENEVIK review.
If those inbox bindings are not configured, the same form still exports a ZIP
for mail, DM, Drive or another manual review channel.

Lookup hints and questionnaire summaries are generated from the game repository
by `scripts/sync-lookups.mjs` and consumed by the form through
`src/data/lookup_hints.js`; the UI does not embed final option lists.

Check everything in this subproject:

```bash
npm run check
```

## Hosted Mode

The optional hosted path lives inside this same folder:

```txt
hosted/worker.mjs
hosted/public/index.html
hosted/public/review.html
hosted/cloudflare/npc_intake.sql
wrangler.example.jsonc
```

Hosted mode receives already validated ZIPs, stores review metadata for
TENEVIK GAMES, and returns the approved game-side destination:

```txt
src/data/npc_packages/community/<npc_id>/
  npc.json
  sprite.rle.json
  README.md
  consent.json
```

To deploy, copy `wrangler.example.jsonc` to `wrangler.jsonc`, configure the R2
bucket, D1 database, review token and optional Turnstile secret, then apply
`hosted/cloudflare/npc_intake.sql`. The hosted review decision is not runtime
trust; accepted packages still need game-side schema validation before commit.
