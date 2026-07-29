# Branch port -- pending adaptation

These files came from `origin/nav-routing-diffusion` in the merge that brought the
macro-society simulation onto main. They are PARKED here, not deleted: they compile
against the branch hand-written item/mob enum catalogs, and main won that argument
with a csv-generated 446-item / 69-mob pipeline plus a `source_rules` row-count gate.

They live under tools/ because src/game is GLOB_RECURSE-compiled, so anything left in
the source tree is in the build whether it works or not.

Each needs its branch API references rewritten against main tables, then moves back
to src/game/. Nothing here is throwaway -- macro_sim in particular is the whole
reason for the merge.

- `loot_table.h` -- references branch item enums (ItemScrapMetal, ItemRawMeat, ...); main has 446 csv rows, ids 1-based
- `loot_table.cpp` -- same -- 101 compile errors against main item_table
- `ai.h` -- references branch mob_table API
- `ai.cpp` -- same -- 33 compile errors
- `macro_sim.h` -- needs FactionMatrix, which main does not have (main uses FactionRelations)
- `macro_sim.cpp` -- same
- `faction.cpp` -- implements the branch 6-faction FactionMatrix; main faction.h has 5 factions and main already ships faction_relations.cpp for inter-faction attitudes
