## 2026-07-30T01:00:48Z

You are Worker M2_2 for Gigahrush2 Milestone 2: Wire Quests Flow & Save State Persistence.
Working directory: C:\hades\gigahrush2\.agents\worker_m2_2\
Project root: C:\hades\gigahrush2

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Task Description:
Explorer 2's detailed analysis is available at C:\hades\gigahrush2\.agents\explorer_m2_1\handoff.md.
Complete the quest offer/accept wiring and save state persistence in `src/app/main.cpp`:
1. Add state variables for quest offer tracking in `src/app/main.cpp`:
   `game::QuestId questOfferId = game::kInvalidQuest;`
   `game::NpcId questOfferGiver = game::kInvalidNpc;`
   `char questOfferLine[320] = {};`
2. Wire event bus drain loop in `src/app/main.cpp`:
   Call `game::quest_on_kill(quests, static_cast<std::uint8_t>(ev.b));` when `ev.b != 0xFFu`.
   Call `game::quest_on_giver_died(quests, ev.a);` when `ev.a != game::kInvalidNpc`.
3. Wire proximity quest offer & reset in `src/app/main.cpp`:
   Call `quest_offer` and `quest_offer_text` when `sp != game::kInvalidNpc` and update `questOfferId`, `questOfferGiver`, `questOfferLine`.
   Reset quest offer variables on floor travel.
4. Wire accept (`SDL_SCANCODE_E` key) in `src/app/main.cpp`:
   If `questOfferId != game::kInvalidQuest`, call `game::quest_accept(quests, pool, questOfferId, questOfferGiver, currentFloor, ledger)`. Reset quest offer variables on success. If no quest offer is pending, fall back to `contract_accept`.
5. Wire ImGui HUD rendering in `src/app/main.cpp`:
   Render active quests using `quest_line`, pending quest offers, and quest status statistics (`activeQuests`, `quests.completed`, `quests.failed`, `quests.expired`, `quests.orphaned`, `questPaid`).
6. Build and verify:
   Execute `tools\win\build.bat Release` and run `build-win\game_test.exe` and `ctest --test-dir build-win`. Ensure 100% green test passes and 0 failures.

Write your handoff report to `C:\hades\gigahrush2\.agents\worker_m2_2\handoff.md` with complete details of code changes and test execution stdout logs.
