# PR Campaign Google AI Workflow

Дата: 2026-06-08.
Обновлено: 2026-06-09 для игрового сценарного пайплайна.
Статус: универсальный рабочий документ для агентов PRCampaign и сценарных
партий, которые отправляются во внешний Google AI/Gemini канал.

Роль: выбрать правильную поверхность Google AI/Gemini для PR, видео, картинок,
кода, исследований, промтов, черновиков, игровых сценарных партий и локальных
вспомогательных материалов ГИГАХРУЩА. Этот файл не заменяет `scenarist.md`,
`PRCampaign/image.md` и `PRCampaign/videos.md`: он задает общий маршрутизатор,
а те файлы остаются специализированными пакетами.

## Что проверено

Проверка была сделана по официальным страницам Google и Google Cloud:

- Google AI Studio / Gemini API: `https://ai.google.dev/aistudio`, `https://ai.google.dev/gemini-api/docs/quickstart`, `https://ai.google.dev/gemini-api/docs/aistudio-build-mode`, `https://ai.google.dev/gemini-api/docs/api-key`, `https://ai.google.dev/gemini-api/docs/models`, `https://ai.google.dev/gemini-api/docs/long-context`, `https://ai.google.dev/gemini-api/docs/tokens`.
- Gemini image generation / Imagen: `https://ai.google.dev/gemini-api/docs/imagen-prompt-guide`, `https://cloud.google.com/vertex-ai/generative-ai/docs/image/overview`, `https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/imagen/4-0-generate`.
- Veo / video generation: `https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/veo-video-generation`, `https://blog.google/products/gemini/video-generation/`, `https://blog.google/products/gemini/photo-to-video/`.
- Flow: `https://blog.google/technology/ai/google-flow-veo-ai-filmmaking-tool/`, `https://labs.google/fx/tools/flow/faq`.
- Whisk: `https://labs.google/fx/tools/whisk/faq`, `https://blog.google/technology/google-labs/whisk/`.
- NotebookLM: `https://support.google.com/notebooklm/answer/16454555`, `https://blog.google/innovation-and-ai/models-and-research/google-labs/notebook-lm-audio-video-overviews-more-languages-longer-content/`.
- Google Vids: `https://workspace.google.com/products/vids/`, `https://support.google.com/docs/answer/16143507`, `https://support.google.com/a/users/answer/14819770`.
- Lyria / audio: `https://ai.google.dev/gemini-api/docs/music-generation`, `https://ai.google.dev/gemini-api/docs/audio`.
- Gemini CLI / Jules / Code Assist / Firebase Studio: `https://blog.google/technology/developers/introducing-gemini-cli-open-source-ai-agent`, `https://blog.google/technology/google-labs/jules-now-available/`, `https://cloud.google.com/gemini/docs/codeassist/overview`, `https://firebase.google.com/docs/studio`.
- Google AI Pro / Ultra benefits and credits: `https://support.google.com/googleone/answer/14534406`, `https://support.google.com/googleone/answer/16286513`, `https://support.google.com/googleone/answer/16287445`.

Если агент работает позже 2026-06-09, он должен перепроверить доступность
конкретной функции, лимиты, регион и название модели перед финальным отчетом.
Google часто переносит Labs-функции между Gemini, Flow, Whisk, Vids, API и
Vertex AI.

## Главный принцип

Не существует одной правильной кнопки Gemini. Выбирай поверхность по типу результата:

| Задача | Поверхность по умолчанию | Когда лучше не использовать |
| --- | --- | --- |
| Быстрый PR-текст, заголовки, питч, ответы на комментарии | Gemini app или Gemini API через AI Studio | Финальные факты без проверки по PR docs, README, публичной странице или DOM |
| Игровой сценарий, реплики, слухи, UI-строки, квестовые описания | Gemini API / AI Studio как внешний сценарист по `scenarist.md` | Локальная GPT-правка текста внутри repo; любые авторские переписывания агентом |
| Grounded summary по PR-докам, Хабр-черновику, тредам, KPI | NotebookLM, затем ручная проверка агентом | Как источник новых фактов без цитируемых документов |
| Атмосферный key art, mood, cover, promo scene | Gemini image generation, Imagen, Flow image tools, Whisk if available | Label-heavy diagram, UI callout, текст на картинке, логотипы |
| Финальная диаграмма, схема архитектуры, изображение с подписями | Локальный SVG/PNG/Figma/Canva-style layout | Генерация финального текста/стрелок в AI-картинке |
| Короткий 8-секундный тизер или image-to-video | Gemini video / Veo, Flow | Длинный монтаж с continuity без локального edit pass |
| Трейлерная сцена, серия клипов, персонаж/камера/continuity | Flow с Veo/Imagen/Gemini, затем локальный монтаж | Срочная публикация без отбора дублей и проверки артефактов |
| Workspace-style ролик, explainer, narrated draft | Google Vids | Мрачный trailer/lookdev, где нужен авторский монтаж и точная визуальная ДНК |
| Видео/аудио разбор, transcript, timestamp notes | Gemini API video/audio understanding или NotebookLM | Реальная публикация без ручного фактчека |
| Инструментальная музыка, loop/stem prototype | Lyria RealTime if доступен, иначе внешний music workflow из `videos.md` | Вокальный трек с точными словами: Lyria RealTime ориентирован на instrumental/steering |
| Кодовый черновик, вспомогательный PR script, маленький tool | Gemini CLI, AI Studio Build mode, Gemini Code Assist | Прямые изменения в этом repo без чтения AGENTS/README и локальных проверок |
| Async code task по GitHub/repo | Jules | Любые необозримые изменения, gameplay patches без ревью, секреты, legal/account actions |
| Full-stack prototype или веб-черновик вне игры | Firebase Studio или AI Studio Build mode | Изменение основной zero-runtime игры, добавление зависимостей, публикация с client-side API key |
| Google Cloud production/API access | Vertex AI, Vertex AI Studio, Media Studio | Если нет owner-approved Cloud project, billing/credits, region and data policy |

## Что считать доступным Google AI стеком

Краткий список поверхностей, которые агент может учитывать в PRCampaign:

- `Gemini app`: быстрый мультимодальный помощник для текста, анализа, картинок и короткого видео, если функция доступна в аккаунте/регионе.
- `Google AI Studio`: prompt lab, API key, Build mode, Gemini API experiments, snippets and app prototypes. API keys не коммитить и не вставлять в публичный клиентский код.
- `Gemini API`: programmatic text, code, multimodal input, image generation/editing, video/audio understanding, Lyria RealTime where available.
- `Vertex AI`: Google Cloud production route for Gemini, Imagen, Veo, media APIs, region/storage/IAM control. Использовать только при owner-approved Cloud work.
- `Flow`: filmmaking tool for Veo, Imagen and Gemini. Главная поверхность для trailer clips, continuity, scene iteration, shots, ingredients and camera control when available.
- `Whisk`: Labs visual ideation from subject/scene/style image inputs. Treat as optional and unstable; use for exploration, not final factual diagrams.
- `Google Vids`: Workspace video draft/editor. Good for explainers, narrated update clips and simple social edits, not for final game-trailer look by default.
- `NotebookLM`: source-grounded research workspace for PR docs, reports, article drafts, media packs, comments and long thread context. Useful for Audio/Video Overviews, briefing docs and structured notes.
- `Lyria RealTime`: Google music generation API surface for instrumental/interactive music steering. It is not the same as Suno; keep Suno prompts in `PRCampaign/videos.md` as external fallback.
- `Gemini CLI`: open-source terminal agent. It can help with local support scripts, content transformations and repo-aware analysis, but this repo still follows AGENTS.md and local validation.
- `Jules`: Google async coding agent. Use only for isolated code tasks with clear repo instructions, branch/PR review and no blind merge.
- `Gemini Code Assist`: IDE/cloud coding assistant for completions, tests, debugging and docs.
- `Firebase Studio`: cloud agentic workspace for app prototypes and Firebase/Gemini apps. Not a path for changing the main game build unless explicitly requested.

## PRCampaign rules for AI output

- Public game/store copy must not disclose implementation dimensions or topology. Use `безграничная бетонная структура`, `unbounded concrete megastructure` and similar wording.
- Do not imply AI video/image output is real gameplay. Mark it internally as generated concept/trailer material; disclose AI use wherever a platform requires it.
- Do not change game-page AI disclosure for the playable build merely because PR media was AI-assisted. Change build disclosure only if generated AI content enters the shipped game assets/source.
- Do not feed private account pages, legal forms, API keys, tokens, dashboard secrets or unpublished personal data into consumer AI tools.
- Do not publish text from Gemini/NotebookLM without checking facts against current PR docs, public page state or source files.
- Generated images/videos are candidates, not final assets. Every final asset needs human/agent QA for composition, labels, accidental text, visual DNA and platform policy.
- If a generated asset includes text, logos, maps, UI or code, assume it is wrong until manually inspected.
- Avoid public claims like `AI made the game`. The correct engineering framing is: AI tools may help draft PR material, prompts, translations, media concepts or auxiliary code, while shipped gameplay facts come from the repo and verified builds.

## Игровой Сценарный Пайплайн

`scenarist.md` является законом для игровых текстов. Локальные GPT-агенты не
пишут сценарий ГИГАХРУЩА: они только собирают контекст, отправляют партии во
внешний Gemini/Google AI сценарный канал, механически применяют полученный
`revised` и проверяют кодовую базу.

### Текущие лимиты Gemini для партии

По официальным Gemini API docs, проверено 2026-06-09:

- `gemini-3.5-flash`: input token limit `1_048_576`, output token limit
  `65_536`;
- `gemini-3.1-pro-preview`: input token limit `1_048_576`, output token limit
  `65_536`;
- long context docs описывают модели Gemini с контекстом `1M+` tokens;
- token docs дают грубую оценку: один token примерно равен 4 characters, но
  финальный размер партии считать через `count_tokens`, а не на глаз.

Практический рабочий лимит для сценарной партии:

- до `800_000` counted input tokens вместе с `scenarist.md`, инструкцией,
  выгрузкой строк и контекстом;
- держать запас минимум `200_000` tokens на системную обвязку, возможные
  расхождения токенизации, safety/model overhead и повторный prompt;
- выход просить компактным: не больше `40_000-50_000` tokens за один ответ,
  чтобы не упереться в `65_536` output tokens;
- если партия должна вернуть много длинных `revised`, дробить ее раньше, даже
  если input еще помещается.

Gemini app / consumer UI может иметь отдельные файловые, региональные,
аккаунтные и дневные ограничения. Для надежной массовой сценарной работы
использовать AI Studio / Gemini API и перед отправкой считать tokens.

### Какие форматы давать Gemini

Для сценарной работы основной формат - Markdown или обычный текст. Его легко
ревьюить в git, резать на партии и прикладывать к Gemini как `text/plain`.

Поддерживаемые и полезные форматы по текущим официальным docs:

- inline text / Markdown / JSON as prompt parts for small batches;
- Files API uploads for repeated style/lore packs and payloads larger than the
  safe inline threshold;
- PDF documents up to `50 MB` or `1000` pages when layout, tables or page
  visuals matter;
- image inputs: PNG, JPEG, WEBP, HEIC, HEIF;
- audio inputs: WAV, MP3, AIFF, AAC, OGG Vorbis, FLAC;
- video inputs: MP4, MPEG, MOV, AVI, FLV, MPG, WebM, WMV, 3GPP and public
  YouTube URLs where allowed;
- structured JSON output through `response_mime_type: application/json` and
  JSON Schema for returned `revised` batches.

For GIGAH|RUSH text passes use:

1. `scenarist.md` as law.
2. `../gatbage/reference/scenario_writers/gemini_style_lore_database.md` as
   routing pack and copy-policy contract.
3. For Samosbor-related batches:
   `../gatbage/reference/scenario_writers/samosbor_source_texts_report.md` and
   parser-generated `../gatbage/reference/scenario_writers/samosbor_source_texts.jsonl`.
4. The relevant specialized scenario packet.
5. The current text batch from `game_text_inventory.md`.
6. JSON Schema output contract last.

The optional machine mirror is
`../gatbage/reference/scenario_writers/gemini_style_lore_database.jsonl`.
It is an index, not a prose database. Samosbor source text is collected only by
`node scripts/collect-samosbor-source-texts.mjs`.

### Сбор партии

1. Запустить `npm run l10n:extract`. Он пишет актуальную выгрузку в
   `../gatbage/reference/scenario_writers/game_text_inventory.md`.
2. Взять только player-facing строки. Не отправлять secrets, ключи, приватные
   account pages, токены, dashboard data и персональные данные.
3. Для каждой строки передать:
   - стабильный id партии;
   - путь файла и символ/ключ, если есть;
   - тип строки: UI, bark, rumor, note, quest, item, contract, log, tutorial;
   - говорящего, floor, room, route, quest step or system context where known;
   - текущий `current`;
   - уже утвержденный `revised`, если он есть;
   - placeholders/interpolation markers, например `${...}`, `{count}`, `%s`;
   - технические ограничения: длина UI, пол/число/падеж, HTML/Markdown escape,
     spoilers, save ids, no topology disclosure.
4. В prompt включить полный `scenarist.md`, затем
   `../gatbage/reference/scenario_writers/gemini_style_lore_database.md`, затем
   релевантный специализированный пакет. Не заменять тон-бриф локальной
   интерпретацией агента.

### Запрос к Gemini

Формат запроса:

```text
Ты внешний сценарист ГИГАХРУЩА. Следуй scenarist.md как закону.
Верни только структурированный результат.
Не меняй id, placeholders и технические ключи.
Для каждой строки верни один финальный revised.
Если контекста недостаточно или механика конфликтует с текстом, верни needs_context
и коротко укажи, какой факт нужен. Не придумывай механику.
```

Предпочтительный ответ:

```json
{
  "batch_id": "scenario_text_0001",
  "items": [
    {
      "id": "stable-id-from-inventory",
      "status": "revised",
      "revised": "Финальная строка внешнего сценариста."
    },
    {
      "id": "stable-id-needs-context",
      "status": "needs_context",
      "question": "Нужен точный speaker/floor или ограничение длины UI."
    }
  ]
}
```

### Применение результата

- Вставлять `revised` дословно.
- Локально разрешены только механические операции: escaping кавычек, переносов,
  Markdown/HTML, сохранение placeholders, сортировка apply-файла, TypeScript
  string literal формат.
- Локальные GPT-агенты не пишут примеры реплик, фраз или абзацев для Gemini.
  Для Самосбора source excerpts добавляются только парсером
  `scripts/collect-samosbor-source-texts.mjs`; руками можно менять URL registry,
  теги, copy policy и фильтры, после чего база регенерируется.
- Запрещено локально переписывать реплику, добавлять шутку, смягчать мат,
  сокращать авторский смысл, литературно полировать, чинить "неидеальный" тон
  или склеивать два варианта.
- Если строка ломает код, UI, плейсхолдеры, механику, lore lock или spoiler
  guard, не править ее самому. Вернуть внешний сценаристу с id и точным
  техническим конфликтом.
- После применения запустить минимум `npm run typecheck`; для широких
  текстовых партий предпочесть `npm run check:readonly`.

## Artifact router

### Images

Use `PRCampaign/image.md` for final image QA and Habr diagram rules.

Workflow:

1. Decide whether the asset is mood/key art or label-heavy.
2. For mood/key art, generate 3-6 candidates through Gemini/Imagen/Flow/Whisk.
3. For diagrams, create a local layout brief and build final SVG/PNG locally.
4. Add all labels, arrows, captions and logos locally.
5. Inspect full size and target upload size, especially Habr body width.
6. Record prompt, tool, files, QA and no-public-action/public-action state.

Gemini-safe image prompt skeleton:

```text
Create a 16:9 atmospheric image for GIGAH|RUSH.
Scene: [concrete apartment-block / corridor / clinic / lift / samosbor aftermath].
Subject: [one concrete action or object].
Style: grounded survival suspense, late-20th-century Eastern European concrete interior, low-fi browser raycaster mood, practical lighting, readable silhouettes.
Composition: [foreground / midground / background].
Leave signs blank and reserve clean space for local typography.
```

### Video

Use `PRCampaign/videos.md` as the prompt library for Sora/Veo/Gemini/Flow clips.

Workflow:

1. Start with one 8-10 second clip, not a full trailer.
2. Prefer positive-only Gemini/Veo prompts if safety filters reject the longer horror prompt.
3. Generate multiple candidates for the same shot before changing the shot list.
4. Reject clips that look like modern sci-fi, generic fantasy, clean cyberpunk, AAA fake gameplay, unreadable UI or random Cyrillic.
5. Stitch selected clips locally or in a real editor; do not rely on one giant prompt to create a complete trailer.
6. For public posts, caption generated clips as trailer/concept media if they are not direct gameplay capture.

Gemini/Veo safe video prompt skeleton:

```text
Create an 8-second 16:9 cinematic teaser for GIGAH|RUSH.
Scene: a worn late-20th-century Eastern European concrete apartment-block interior with linoleum, pipes, old lamps, paper notices and a heavy shelter door.
Action: [one visible gameplay-adjacent decision: pack water, enter lift, shelter, retreat, inspect changed corridor].
Style: grounded survival suspense, low-fi browser raycaster inspiration, practical lighting, readable silhouettes, no on-screen text.
Camera: [slow push / static low angle / corridor tracking].
```

### Code and tools

Use code-oriented Google AI only for support work unless the owner explicitly asks for game code changes.

Allowed PRCampaign code tasks:

- generate a local SVG/PNG helper script for campaign images;
- draft a one-off HTML media page or press-kit helper;
- summarize files, transform copy packs, normalize tables;
- prototype a small standalone tool outside the game build.

Rules:

- Read AGENTS.md, README and relevant local docs before touching source.
- Keep zero-runtime-dependency game constraints intact.
- Never commit API keys, OAuth tokens, Google Cloud credentials or generated secrets.
- Do not accept broad refactors from Jules/Gemini CLI/Antigravity without local review.
- Run the normal repo checks for any source change. Docs-only work may use `git diff --check`.

### Research and article drafting

NotebookLM is useful when a PR agent needs to understand many PR docs without hallucinating from memory.

Good NotebookLM source set:

- `PRCampaign/KPI.md`;
- `PRCampaign/campaign_plan_ru.md`;
- latest `PRCampaign/PR_*.md` reports relevant to the task;
- current article draft or copy pack;
- README or architecture docs only when the article is technical;
- public feedback excerpts only if they were actually captured in durable reports.

Output format to ask for:

```text
Summarize only from the uploaded sources.
Return:
1. Verified facts with source file names.
2. Unverified claims or gaps.
3. Suggested PR angle.
4. Risks: moderation, public wording, implementation disclosure, AI disclosure.
Do not invent metrics or public statuses.
```

## Default agent workflow

1. Read `PRCampaign/KPI.md`, `PRCampaign/campaign_plan_ru.md`, latest relevant report and the specialized media doc.
2. Define the artifact: image, video, code, copy, research, music or portal/support material.
3. Pick one Google AI surface from the router.
4. Build a prompt from verified GIGAH|RUSH facts and current PR wording.
5. Generate candidates, not final truth.
6. Inspect outputs manually.
7. Finish labels/captions/editing locally when exactness matters.
8. Record a durable report in `PRCampaign/PR_<n>_...md`.
9. Update KPI/campaign plan if the pass changes reusable workflow, live surfaces, blockers, next actions or produced assets.

## Report template

```md
# PR <n> - Google AI media/workflow pass

Date:
Time window:
Owner instruction:

## Sources checked

- Local docs:
- Official Google sources:

## Result

- Created/updated:
- Tool surfaces selected:
- Why these surfaces:

## QA

- Fact check:
- Visual/audio/code check:
- Public wording check:
- AI disclosure/platform policy check:

## Public action

No public post/upload/comment/vote/DM/moderation action was made.

## Next action

-
```

## Fast choices

- Need a Habr architecture diagram: local SVG/PNG first; Gemini only for background/mood.
- Need a Steam/itch/portal cover mood: Gemini/Imagen/Flow image, then local text.
- Need a 10-second trailer shot: `PRCampaign/videos.md` -> Gemini/Veo/Flow -> local select/edit.
- Need a narrated explainer: Google Vids or NotebookLM Video Overview, then edit.
- Need an article outline from existing docs: NotebookLM or Gemini with uploaded source list, then manual rewrite.
- Need a coding helper: Gemini CLI/AI Studio/Firebase Studio only after repo instructions and with validation.
