# PR 30 - Pikabu Games Submission

Date: 2026-05-28.

Time window: 2026-05-27 23:30-23:56 UTC / 2026-05-28 00:30-00:56 BST.

Scope: owner asked to upload the prepared Pikabu Games archive and publish the game on Pikabu. This pass rebuilt and checked the portal artifact, waited for owner-side GamePush authorization, uploaded the ZIP through the Pikabu form and submitted the game to GamePush moderation.

## Result

Pikabu Games form submission completed after the owner authorized GamePush.

This is not a live public Pikabu catalog publication yet. The Pikabu form confirmation said:

```txt
Готово!

Игра отправлена на модерацию в сервис GamePush.
Следите за статусом в их личном кабинете.
```

GamePush now shows the created project:

- Project title: `ГИГАХРУЩ`
- Project id: `28314`
- Project panel: https://gamepush.com/panel/projects/28314

No public Pikabu game URL was available during this pass. Treat the surface as `submitted / moderation pending`, not `public`.

Do not submit a duplicate application while project `28314` is pending.

## Submitted Form State

Submitted through `https://games.pikabu.ru/add-own-game/form`:

- Title: `ГИГАХРУЩ`
- Categories: `Шутер`, `Ролевые`, `Хорроры`
- Tags: `Выживание`, `Монстры`, `Оружие`, `Рогалик`, `Шутер от первого лица`, `Мобильная`
- Engine: `JavaScript`
- Languages: `Русский`, `Английский`
- Archive: `pikabu/gigahrush-pikabu.zip`
- Archive size: `5 198 403` bytes

The form allowed submission without a separate cover/icon upload in this path. Moderation or the GamePush panel may still request final visual assets later; an exact ready `1024x1024` icon was not found in the active pack during the pre-submit scan.

No additional legal, payment or tax terms were accepted by the agent after the owner completed authorization. If GamePush asks for legal/payment/account details, the owner must handle those prompts.

## Local Artifact State

Commands run before upload:

```bash
npm run check:browser
npm run pikabu:build
```

Results:

- `npm run check:browser` passed. Production build completed and the smoke script reported playable canvas at the local preview URL.
- `npm run pikabu:build` passed and rebuilt the strict portal artifact.
- Fresh archive: `pikabu/gigahrush-pikabu.zip`, `5 198 403` bytes.
- Fresh portal HTML: `pikabu/index.html`, `11 320 754` bytes.
- Fresh canonical dist HTML: `dist/index.html`, `11 320 624` bytes.
- Archive root contains `index.html`.
- Strict portal meta is present in the copied Pikabu artifact.
- GamePush credentials embedded in the archive: no.

Archive listing:

```txt
apple-touch-icon.png
build-size-manifest.json
icon-192.png
icon-512.png
index.html
manifest.webmanifest
sw.js
```

Source URL scan:

- `rg -n "https://|http://" src --glob '*.ts'` found only the GamePush SDK URL in `src/systems/platform_bridge.ts`.

## Official Requirements Rechecked

Current official Pikabu/GamePush pages still matter for moderation follow-up:

- Pikabu technical documentation requires GamePush SDK integration, root `index.html`, no critical console errors, correct scaling, Russian UI, auto-pause/audio behavior, cloud saves and legal/payment readiness before publication.
- Pikabu content rules prohibit adult content, casino-like mechanics and third-party links except allowed support/developer-social exceptions.
- GamePush Pikabu distribution documentation says to register in GamePush, add the game in the GamePush account, choose Pikabu Games in Distribution and send the application for moderation from there.
- GamePush cloud-save documentation requires player fields to be created in the GamePush panel before calling `gp.player.set`, and changes must be confirmed with `gp.player.sync`; total player profile data is limited to `1 MB`, with `10 KB` gzip recommended.

Sources rechecked:

- `https://games.pikabu.ru/page/tehnicheskaya-dokumentatsiya`
- `https://docs.gamepush.com/ru/docs/distribution/pikabu/`
- `https://docs.gamepush.com/ru/docs/player/cloud-saves/`

## Remaining Checks

1. Monitor GamePush project `28314` and wait for moderation status or a public Pikabu catalog URL.
2. Open the GamePush/Pikabu preview iframe when available and verify launch, console errors, pause/resume, audio pause, cloud save write/read, mobile scaling and strict portal content rules.
3. Confirm the GamePush player field `progress` exists before relying on cloud saves. If the project requires embedded `projectId` / `publicToken`, keep credentials in local ignored secrets, rebuild with `npm run pikabu:build` and resubmit only through the official update flow.
4. Prepare final cover/icon assets if moderation requests them, especially an exact `1024x1024` square icon.
5. Do not duplicate-submit from the Pikabu form while project `28314` is pending.
