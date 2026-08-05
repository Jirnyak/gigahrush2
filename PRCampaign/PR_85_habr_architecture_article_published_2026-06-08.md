# PR 85: Habr Architecture Article Published

Date: 2026-06-08.

Surface: Habr, account `TENEVIK`.

Published URL: https://habr.com/ru/articles/1045220/

Title: `Как устроен ГИГАХРУЩ: клеточный мир, WebGL-рейкастер и A-Life без движка`

Status: published. Habr save API returned `{"post":"1045220","ok":true}` for draft save, publish, and the final body update.

## What Was Published

Published the architecture article from `PRCampaign/habr_architecture_article_habr_ready_2026-06-08.md`.

The article was adjusted before publication to match the owner direction:

- no `Что хочется обсудить` block;
- no `Где архитектура не спасает` / self-deprecating UX section;
- no request-for-feedback framing;
- project is positioned as an already visible local indie/community project;
- image 6 is MESH PASS, not first-minutes UX;
- MESH PASS section explains seeded local mesh radius around the player by cell/seed, inspired by Windows Pipes / водопроводный screensaver, with render-only boundaries.

## Habr Settings

- Flow: `Геймдев` / id `16`.
- Hubs: `Разработка игр`, `TypeScript`, `WebGL`, `JavaScript`, `Canvas`.
- Format: `Ретроспектива`.
- Complexity: `Средний`.
- Tags: `ГИГАХРУЩ`, `gamedev`, `TypeScript`, `WebGL`, `raycasting`, `A-Life`, `процедурная генерация`, `браузерная игра`, `самосбор`, `MESH PASS`.
- Cut button: `Читать дальше`.
- No separate `feedCover` object was set; the article contains native inline images and Habr stores a lead preview separately.

## Uploaded Images

All six article images were uploaded through Habr's `publication/upload` endpoint and then inserted as Markdown image links:

1. Architecture layers / World:
   https://habrastorage.org/getpro/habr/upload_files/292/819/5d8/2928195d866518a49b5676d17356a304.png
2. Cell index layers:
   https://habrastorage.org/getpro/habr/upload_files/c26/d5d/eb5/c26d5deb5bfb262420d5534590d08c96.png
3. Raycaster / DDA split:
   https://habrastorage.org/getpro/habr/upload_files/66d/b41/57d/66db4157d93a3fcc3f736ae6eaf08dd6.png
4. A-Life / Demos identity:
   https://habrastorage.org/getpro/habr/upload_files/fb2/89f/8a0/fb289f8a0b2a708ac241e494f038efe4.png
5. Samosbor before/after:
   https://habrastorage.org/getpro/habr/upload_files/321/341/ba5/321341ba54995bb42080b6b6f05cd249.png
6. MESH PASS:
   https://habrastorage.org/getpro/habr/upload_files/e14/784/19a/e1478419abe8ae8dd5f31c190708b8d7.png

Verification:

- each uploaded PNG returned `200 image/png` by direct HEAD check;
- Habr Markdown preview endpoint returned `200` and rendered inline figures;
- public HTML for `https://habr.com/ru/articles/1045220/` contains all six uploaded filenames;
- public DOM in Chrome tab 4 returned URL `https://habr.com/ru/articles/1045220/`, correct article title, `article figure` count `6`, article figure image count `6`, and `MESH PASS` present;
- public article body starts with the new confident intro after a final update. An intermediate body split put the intro only into Habr lead data, so the post was immediately updated with full text in `text.source`.

Negative checks:

- old phrase `слишком быстро сказали слово` absent from public HTML;
- `Что хочется обсудить` absent from public HTML;
- `Где архитектура не спасает` absent from public HTML.

## Actions Not Taken

No Habr comment, vote, DM, duplicate post, scheduled post, moderation bypass, or link-bump action was made.

The old open editor tab at `https://habr.com/ru/article/new/` still contains stale WYSIWYG/autosave text in Chrome; do not use that tab as source of truth. The public article URL above is the verified source of truth.

## Next Actions

Monitor `https://habr.com/ru/articles/1045220/` for comments, moderation status, link retention, image retention, and reach. Answer only real questions or bug reports; do not ask for votes, do not bump with link-only comments, and do not create a duplicate Habr post.
