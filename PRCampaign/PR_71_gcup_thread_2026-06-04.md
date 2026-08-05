# PR 71 - GcUp Thread Published

Date: 2026-06-04.

Window: 00:50-01:05 BST.

Purpose: owner said the GcUp account was authorized and asked to post there. This pass used the existing Chrome session and did one GcUp forum publication only. No likes, votes, fake comments, duplicate forum posts, paid placements, captcha bypass or moderation evasion were made.

## Result

| Surface | Result | Evidence | Notes |
| --- | --- | --- | --- |
| GcUp / `Ваши проекты -> Проекты в разработке` | Public thread created | `https://gcup.ru/forum/9-110636-1` | Title: `ГИГАХРУЩ - браузерный survival horror / ARPG shooter без движка`. Description: `Playable build, нужен фидбек по первым 5-10 минутам`. Post #1 by `TENEVIK` at GcUp local time `03:00`, message id `779350`. |

## Account / Permission State

Before activation, GcUp still showed `TENEVIK | Группа "Неактивные"` and the banner `Внимание! Вы не активировали аккаунт! Пройдите ТЕСТ, подтвердите почту...`. The test/email step completed during this pass; the forum then showed `TENEVIK | Группа "Пользователи"`.

After reload, permissions on `https://gcup.ru/forum/9` were:

- `Вы можете создавать темы`
- `Вы можете создавать опросы`
- `Вы не можете прикреплять файлы`
- `Вы можете отвечать на сообщения`

Because file attachments are still disabled, the post was published without uploading `contact_sheet_3x3.png`. The local exact copy source is `PRCampaign/gcup_thread_post_2026-06-04.md`.

## Public Recheck

Logged-out shell fetch of `https://gcup.ru/forum/9-110636-1` returned `HTTP/1.1 200 OK`. Public HTML retained:

- page title `ГИГАХРУЩ - браузерный survival horror / ARPG shooter без движка - Ваши проекты - Проекты в разработке - Форум игроделов`
- topic description in meta description
- post #1 by `TENEVIK`
- MyIndie link through `/go?https://myindie.ru/games/game/gigahrush`
- direct browser build link through `/go?https://gigahrush.bileter.workers.dev`
- itch mirror link through `/go?https://tenevik.itch.io/gigahrush`
- Telegram link through `/go?https://t.me/gigah_rush`

## Copy Summary

The post is dev-feedback oriented, not a link dump:

- developer disclosure: `Tenevik Games`
- game identity: `ГИГАХРУЩ / GIGAH|RUSH`
- current build features: preparation, expeditions, procedural/authored floors, NPCs, trade, containers, documents, rumors, contracts, factions, economy, A-Life, combat, monsters, Samosbor and browser saves
- technical angle: TypeScript/Vite, WebGL/canvas raycaster, procedural textures/sprites/sound, no finished engine
- public wording uses `безграничная бетонная структура`, avoiding implementation topology
- explicit feedback ask: first 5-10 minutes, HUD, map, inventory, journal, preparation and first meaningful decision
- content note: horror, weapons, blood, corpses, monsters, sirens and disturbing procedural events; not NSFW/adult

## Next Actions

1. Monitor `https://gcup.ru/forum/9-110636-1` for replies, moderation, link retention and views.
2. Reply only to concrete questions or feedback; do not bump with a duplicate promo reply.
3. If attachment rights unlock later, add media only as a meaningful update, not an immediate self-bump.
4. XGM remains blocked by login; do not publish the same text there unchanged. If XGM becomes available, use the architecture/project angle and rewrite.
