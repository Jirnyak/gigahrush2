# 00 — Механический скан мёртвых символов (кросс-репо)

Метод: из всех заголовков `src/**/*.h` извлечены 636 кандидатов-функций. Затем из
**всех** `.cpp/.h/.inl` в `src/` вырезаны комментарии (`sed 's://.*::'`), и для каждого
символа посчитаны ссылки только по коду. Комментарии вырезаны намеренно: в этом репозитории
комментарий, утверждающий, что функция вызывается, — типовая форма вранья
(см. `interaction_step` ниже).

Правило принадлежности: символ считается мёртвым, если **все** ссылки на него в `src/`
лежат в его собственном заголовке и его собственном `.cpp`.

## Итог

| Тир | Что это | Штук | Доля от 636 |
|---|---|---|---|
| **Тир 1** | Ноль вызовов где-либо в `src/`: есть только объявление в `.h` и определение в `.cpp`. Живут исключительно за счёт тестов. | **93** | 15 % |
| **Тир 2** | Вызывается только внутри своего `.cpp`. Это не мёртвый код, но и не публичный API — должно быть `static` / в анонимном namespace. | **139** | 22 % |
| Итого под нож или под понижение видимости | | **232** | **36 %** |

Больше трети публичного API игрового слоя не имеет ни одного потребителя за пределами
своего модуля.

## Тир 1 по модулям (кто держит больше всего мёртвого API)

| Модуль | Мёртвых функций |
|---|---|
| `src/game/monster_traits.h` | 11 |
| `src/game/event_bus.h` | 8 |
| `src/game/rpg.h` | 7 |
| `src/game/ai.h` | 7 |
| `src/game/economy.h` | 6 |
| `src/world/destruct.h` | 3 |
| `src/sim/diffusion.h` | 3 |
| `src/game/prop_system.h` | 3 |
| `src/game/nav_cache.h` | 3 |
| прочие (по 1–2) | 42 |

`monster_traits.h` — 11 из 11 своих публичных запросов мёртвые: `trait_move_mult`,
`trait_damage_mult`, `trait_incoming_mult`, `trait_has_vulnerability`, `trait_takes_bait`,
`trait_takes_bait_any`, `trait_allows_wet_spawn`, `monster_traits_default`,
`monster_trait_authored_count`, `monster_traits_unauthored_reason`, `has_bait`. Весь модуль
черт монстров ни на что не влияет в игре — он влияет только на `suite_monster.inl`.

`rpg.h` — те же 7 из 7: `total_xp_for_level`, `adjusted_psi_cost`, `clamp_rpg_attribute`,
`int_contract_reward_mult_e3`, `int_document_reward_mult_e3`, `int_psi_duration_bonus_sec`,
`str_durability_wear_mult_e3`. То есть характеристики персонажа не меняют ни один исход.

## Показательные единичные находки

| Символ | Файл | Тестов | Что это значит |
|---|---|---|---|
| `route_step` | `src/world/nav.h:154` | **33** | Главный запрос навигации («я в клетке X, куда шаг?»). Ноль вызовов в игре. Вся ветка L2 fine-nav (64 потока потока, многопоточный бейк, дисковый кэш) построена и не подключена. |
| `interaction_step` | `src/game/prop_system.h:200` | 20 | Три отдельных комментария (`prop_system.h:109`, `:161`, `main.cpp:4173`) советуют «предпочитать `interaction_step` на горячем пути». Вызывающих — ноль. Комментарий описывает намерение как факт. |
| `seed_floor_population` | `src/game/population.h:39` | 18 | Заселение этажа. `save.h:26` и `floor_stream.h:95` строят на нём формат сейва («NPC не пишем, потому что `seed_floor_population` их воспроизведёт»). Функция не вызывается. |
| `net_worth`, `bank_deposit`, `bank_withdraw`, `bank_repay`, `bank_take_loan`, `wealth_tier` | `src/game/economy.h` | 19/23/8/9/14/13 | Банк, сданный 2026‑08‑17 как «банк целиком». Вся арифметика счёта вызывается только из `suite_economy.inl`. |
| `needs_advance`, `apply_consumable`, `consumable_hp_cost`, `needs_hp_rate`, `needs_speed_scale`, `needs_warn_mask`, `needs_failed_mask` | `src/game/needs.h` | 17/17/18/12/5/8/8 | Потребности. |
| `diffusion_step`, `diffusion_at`, `diffusion_add`, `diffusion_refresh_walkable` | `src/sim/diffusion.h` | 42/17/19/19 | 1043 строки (`.cpp`+`.h`). |
| `carve_at`, `carve_roll`, `carve_hash`, `sub_material_at`, `set_sub_material` | `src/world/destruct.h` | 6/6/3/5/4 | Разрушение. |
| `score_intents`, `select_intent`, `select_intent_raw` | `src/game/ai.h` | 36/9/11 | Ядро utility‑AI: подсчёт и выбор намерения. |
| `speech_situation`, `speech_line_index`, `speech_text`, `speech_line_count` | `src/game/speech.h` | 37/9/3/5 | Речь NPC. |
| `feed_line`, `feed_drain`, `feed_tick`, `event_line`, `event_floor`, `event_relation`, `publish_*` | `src/game/event_bus.h` | 18/17/12/6/10/4/1–3 | Шина событий: издателей и подписчиков в игре нет. |
| `quest_state`, `quest_def`, `quest_eligible`, `quest_grant_item`, `quest_brief`, `quest_name`, `quest_objective_text`, `quest_time_text` | `src/game/quest.h` | 16/12/10/6/2/2/1/3 | Квесты. |
| `nav_cache_write/read/evict/usage/bytes/parse_name`, `load_nav_cache_sections`, `nav_cache_error_text` | `src/game/nav_cache.h` | 14/4/7/6/13/4/2/**0** | Весь дисковый кэш навигации. |
| `check_projectile_prop_hits` | `src/game/prop_system.h:174` | **0** | Полностью мёртвая: снаряды не проверяют попадание в антураж. |
| `room_bit` | `src/game/room_zone.h` | **66** | Самый тестируемый символ репозитория. Ноль вызовов в игре. |

## Полностью мёртвые (0 в `src/`, 0 в тестах)

`fast_sin`, `soft_clip` (`src/audio/dsp_math.h`); `hash_u64` (`src/core/rng.h`);
`fnv_fold`, `channel_seed`, `jitter_signed`, `mem_kind_is_actor` (`src/game/ai.h`);
`cell_key` (`src/game/combat.h`); `has_bait` (`src/game/monster_traits.h`);
`type_tag` (`src/world/field.h`); `prop_name`, `prop_id_str`, `prop_id_by_string`
(`src/game/prop_table.h`); `drag_area` (`src/sim/drag.h`); `regime_up`, `axis_frame`
(`src/world/gravity.h`); `chain_bytes` (`src/render/vk_texture.h`); `snapshot_floor`,
`apply_floor_snapshot` (`src/game/save.h`); `samosbor_rand`, `samosbor_rand01`
(`src/game/samosbor.h`); `flicker_hash11` (`src/game/flicker.h`); `dominant_faction`
(`src/game/rumour.h`); `floor_ground_cell` (`src/game/floor_gen.h`); `needs_roll_resident`
(`src/game/needs.h`); `despawn_layer_fog_mobs` (`src/game/mob_spawn.h`);
`material_subvoxel_mass_kg` (`src/world/material_props.h`); `roll_mob_loot_slots`
(`src/game/loot.h`); `antourage_face_pack` (`src/game/antourage/antourage.h`);
`nav_cache_error_text` (`src/game/nav_cache.h`); `check_projectile_prop_hits`
(`src/game/prop_system.h`).

## Ложные срабатывания, которые скан отсеял (проверено вручную)

- `padic_apply_rules`, `blame_apply_rules`, `generate_blame_floor`, `generate_padic_floor` —
  подключены **таблицей указателей на функции** в `floor_gen.cpp:191-207`, а не прямым
  вызовом. Живые.
- `status_def`, `gravity_frames`, `coarse_next`, `intent_room_mask`, `role_for`,
  `faction_color`, `mat4_perspective`, `item_desc`, `item_by_string`, `mob_token`,
  `prop_emits_light` — по одному настоящему вызову вне модуля. Живые.

Порог «≤ 2 ссылки» без проверки владельца файла даёт эти ложняки; итоговые списки
Тир 1 / Тир 2 строятся по владельцу и от них свободны.

## Замечание о форме гнили

В `src/` **ноль** `#if 0`, **ноль** `if (false)`, **ноль** закомментированных блоков и
ровно **один** `TODO` на 73 393 строки. Это не признак чистоты: `tools/check_source_rules.cmake`
запрещает эти маркеры. Запрет не убрал отключённый код — он убрал *метки* отключённого кода.
Гниль переехала в формы, которые грепом по маркеру не ловятся: функция без вызывающих,
поле, которое пишут и не читают, константа, обнуляющая ветку, и комментарий, описывающий
намерение в настоящем времени.

Артефакты скана: `/tmp/markoaudit/TIER1.txt`, `/tmp/markoaudit/TIER2.txt`,
`/tmp/markoaudit/DEAD_FINAL.txt`, `/tmp/markoaudit/candidates.txt`.
