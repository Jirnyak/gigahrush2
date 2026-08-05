# Habr architecture article - images only checklist - 2026-06-08

Use these images for the Habr architecture draft. This is intentionally only pictures/captions.

## Existing usable files

1. Architecture layer diagram
   - File: `PRCampaign/habr_architecture_layers_world_2026-06-08.png`
   - Source SVG: `PRCampaign/habr_architecture_layers_world_2026-06-08.svg`
   - Caption: `Общий контракт: генераторы строят World, системы меняют состояние, рендер только читает.`

2. Cover / hero
   - File: `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/01_hero_gif_hell_blinking_eyes.gif`
   - Use in article body, not as feed cover if Habr makes the listing too heavy.
   - Static feed-cover fallback: `../gatbage/tmp/media/habr_post_2026-05-31/habr_cover_samosbor_780x440.jpg`

3. World/map layer diagram
   - File: `PRCampaign/habr_world_cell_layers_map_2026-06-08.png`
   - Source SVG: `PRCampaign/habr_world_cell_layers_map_2026-06-08.svg`
   - Caption: `Один индекс клетки связывает геометрию, комнаты, признаки, туман, территорию и рендер.`

4. Inventory / first route / preparation
   - File: `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/08_inventory_prep_loadout.png`
   - Caption: `Первый маршрут должен быть читаемым: еда, вода, патроны, выход, опасность, решение.`

5. A-Life / factions / rank
   - File: `PRCampaign/habr_alife_demos_identity_2026-06-08.png`
   - Source SVG: `PRCampaign/habr_alife_demos_identity_2026-06-08.svg`
   - Caption: `A-Life хранит identity и последствия, а не просто рендерит NPC рядом с игроком.`

6. Samosbor before/after
   - File: `PRCampaign/habr_samosbor_before_after_2026-06-08.png`
   - Source SVG: `PRCampaign/habr_samosbor_before_after_2026-06-08.svg`
   - Caption: `САМОСБОР важен не как фильтр на экране, а как изменение состояния места.`

7. Samosbor GIF fallback
   - File: `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/02_gif_underhell_maronary_samosbor_loop.gif`
   - Caption: `Локальная мутация пространства важнее самого экранного эффекта.`

8. Raycaster / DDA split image
   - File: `PRCampaign/habr_raycaster_dda_split_2026-06-08.png`
   - Source SVG: `PRCampaign/habr_raycaster_dda_split_2026-06-08.svg`
   - Caption: `Геометрия остается клеточной, WebGL строит 2.5D-проекцию специализированным raycasting pass.`

9. MESH PASS / seeded local volume
   - File: `PRCampaign/habr_mesh_pass_seeded_radius_2026-06-08.png`
   - Source SVG: `PRCampaign/habr_mesh_pass_seeded_radius_2026-06-08.svg`
   - Caption: `MESH PASS добавляет объемные трубы и детали вокруг игрока, не превращая World в 3D-сцену.`

## Need to make manually

No required manual diagram remains for the current architecture images.

## Minimal article set

If you only want the minimum:

1. Feed cover: `habr_cover_samosbor_780x440.jpg`
2. Architecture diagram: `habr_architecture_layers_world_2026-06-08.png`
3. Map/world layer diagram: `habr_world_cell_layers_map_2026-06-08.png`
4. Raycaster/DDA split image: `habr_raycaster_dda_split_2026-06-08.png`
5. A-Life screenshot/diagram: `habr_alife_demos_identity_2026-06-08.png`
6. Samosbor before/after: `habr_samosbor_before_after_2026-06-08.png`
7. MESH PASS: `habr_mesh_pass_seeded_radius_2026-06-08.png`
