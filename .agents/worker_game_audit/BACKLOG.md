# BACKLOG — worker_game_audit

Lane: game audit + save/travel seams + content port. NOT render/prop.
Updated: 2026-07-30 ~13:56 Samara

## CLOSED this session
| ID | Item | Proof | Commit |
|----|------|-------|--------|
| F9 | Full F9 load path (bake guard, travel_to_saved_floor, arrival seam, apply_player_snapshot, sync_armour, place_body_at_cell, apply_opened, honest HUD) | main.cpp links GREEN via vcvars64; game_test 100% (309s) incl suite_saveload | landed in 7709b3e (main.cpp hunk; ride-along with particle/CRT commit by concurrent agent) |
| T1 | Travel capture/apply parity keyboard + --shot | prior 702265d + re-grep CLEAN | 702265d |
| A1-9 | suite_audit ledger 1-9 CLOSED pins | audit_test 140 checks | various |

## OPEN / next (priority)
| Pri | ID | Item | Pathspec | Notes |
|-----|----|------|----------|-------|
| P1 | PUSH | origin/main lag | n/a | local ahead 5–6; hung git/ssh pile killed; push retrying. Do not force. |
| P1 | FOR1 | Fresh forensic src/game defect | src/game/** free files | ledger empty of RED; find real bug, pin, fix |
| P2 | CNT1 | Content expand status/craft from old giga | data/*.csv + tables | thin: status.csv (~6 rows); port real rows from C:\hades\gigahrush |
| P2 | PAR1 | Re-grep travel sites after every main.cpp foreign commit | src/app/main.cpp read-only unless hole | line drift from light-grid/loot-emissive |
| P3 | M4 | worker_m4 leftovers if unowned | .agents/worker_m4* peek | only src/game scope |

## LOCKED — do not touch
- src/render/env_detail.* gpu_particle_pass.* gpu_light_grid.* (foreign WIP)
- shaders/**
- main.cpp propPlacer / light-grid sites (surgical save hunks only if needed)
- .agents/** other lanes; root ORIGINAL_REQUEST.md if foreign
- embody.cpp XP path

## Safe zones
- lane docs under .agents/worker_game_audit/**
- src/game/** except embody if foreign-dirty
- data/** content CSV
- tests/suite_audit.inl + audit pin in CMake
- save/load/travel if main.cpp free of foreign WIP
