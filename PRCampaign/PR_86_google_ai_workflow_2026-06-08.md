# PR 86 - Google AI / Gemini PRCampaign workflow

Date: 2026-06-08.
Time window: 2026-06-08 23:41 BST.
Owner instruction: make the PRCampaign AI/media document universal for working with Gemini and Google AI, including video, code, images and related Google services; account for the existing video prompt document.

## Sources checked

Local:

- `README.md`.
- `items.md` to confirm it is the active game item-system document and should not be repurposed into a PR AI runbook.
- `PRCampaign/KPI.md`.
- `PRCampaign/campaign_plan_ru.md`.
- `PRCampaign/kpi_report_2026-06-05.md`.
- `PRCampaign/next_wave_schedule_ru.md`.
- `PRCampaign/image.md`.
- `PRCampaign/videos.md`.

Official Google / Google Cloud sources:

- Google AI Studio, Gemini API quickstart, Build mode and API key docs.
- Gemini image generation / Imagen docs.
- Vertex AI Imagen and Veo docs.
- Gemini app video generation and photo-to-video posts.
- Flow and Whisk official pages.
- NotebookLM Video Overview / Audio Overview docs.
- Google Vids help and product pages.
- Lyria RealTime and Gemini audio understanding docs.
- Gemini CLI, Jules, Gemini Code Assist and Firebase Studio docs.
- Google AI Pro / Ultra benefits and AI credits help pages.

## Result

Created:

- `PRCampaign/google_ai.md`: a universal Google AI/Gemini workflow for agents, with routing by artifact type, official-source links, PRCampaign safety rules, prompt skeletons, code-agent boundaries and a report template.

Updated:

- `PRCampaign/image.md`: now points to `PRCampaign/google_ai.md` for broader Google AI routing while retaining image-specific QA rules.
- `PRCampaign/videos.md`: now points to `PRCampaign/google_ai.md` for selecting Gemini/Veo/Flow/Vids/NotebookLM/API surfaces while retaining the video prompt library.

Decision:

- Root `items.md` was not rewritten because it is the active shipped item/weapon/resource/production contract for the game. Repurposing it would corrupt the project documentation map. The reusable PR AI document belongs under `PRCampaign/`.

## QA

- The new workflow distinguishes mood/key-art generation from final label-heavy diagrams.
- It includes video routes for Gemini/Veo/Flow/Vids and keeps `PRCampaign/videos.md` as the prompt library.
- It includes code routes for Gemini CLI, Jules, Gemini Code Assist, AI Studio Build mode and Firebase Studio, with AGENTS.md/repo-validation boundaries.
- It includes NotebookLM/source-grounded research and Lyria/audio routes.
- It preserves PRCampaign rules: no public implementation geometry, no fake gameplay claims, no secret/API-key exposure, no platform disclosure shortcuts.

## Public action

No public post, upload, publication, comment, vote, DM, moderation action or Google AI generation was made in this pass. This was documentation/workflow work only.

## Next action

Use `PRCampaign/google_ai.md` before any future Gemini/Google AI media or coding pass, then generate 2-3 controlled trailer/image candidates from `PRCampaign/videos.md` or `PRCampaign/image.md` and record the tool, prompt, files and QA in a new PR report.
