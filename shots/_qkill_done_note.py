from pathlib import Path

p = Path(r"C:/hades/gigahrush2/.agents/worker_game_audit/progress.md")
t = p.read_text(encoding="utf-8")
note = """
## 2026-08-01 QKILL verify
- Wire present in HEAD 3e3f18f main.cpp NpcDied drain: quest_on_kill + quest_on_giver_died next to contract hooks.
- API+unit tests already in quest.cpp / suite_quest.inl; OPEN backlog empty.
- gigahrush2 Debug+Release build OK after verify.
- CMake pin remains 219716 checks, 0 failures.
"""
if "2026-08-01 QKILL verify" not in t:
    p.write_text(t + note, encoding="utf-8")
    print("progress updated")
else:
    print("progress already has note")
