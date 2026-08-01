from pathlib import Path

root = Path(r"C:/hades/gigahrush2")
out = []
main = (root / "src/app/main.cpp").read_text(encoding="utf-8", errors="replace")
save_h = (root / "src/game/save.h").read_text(encoding="utf-8", errors="replace")
save_cpp = (root / "src/game/save.cpp").read_text(encoding="utf-8", errors="replace")
rpg_h = (root / "src/game/rpg.h").read_text(encoding="utf-8", errors="replace")

# ATTR1
out.append("==== ATTR1 spend_attr_point ====")
out.append(f"main spend_attr_point={main.count('spend_attr_point')}")
for i, line in enumerate(main.splitlines(), 1):
    if "spend_attr_point" in line or ("attrPoints" in line and ("key" in line.lower() or "GLFW" in line or "press" in line.lower() or "digit" in line.lower() or "GLFW_KEY_1" in line)):
        out.append(f"{i}:{line.rstrip()[:180]}")
# keys 1/2/3
for i, line in enumerate(main.splitlines(), 1):
    if "GLFW_KEY_1" in line or "GLFW_KEY_2" in line or "GLFW_KEY_3" in line or "spend_attr" in line:
        out.append(f"KEY {i}:{line.rstrip()[:180]}")

# AGIMV
out.append("\n==== AGIMV agi_move ====")
out.append(f"main agi_move_speed_mult_e3={main.count('agi_move_speed_mult_e3')}")
for i, line in enumerate(main.splitlines(), 1):
    if "agi_move" in line or "moveSpeed" in line or "kPlayerWalkSpeed" in line:
        out.append(f"{i}:{line.rstrip()[:180]}")

# SAVRPG
out.append("\n==== SAVRPG RpgStats in save ====")
out.append(f"save.h RpgStats={save_h.count('RpgStats')} rpg={save_h.lower().count('rpg')}")
out.append(f"save.cpp RpgStats={save_cpp.count('RpgStats')} rpg={save_cpp.lower().count('rpg')}")
for i, line in enumerate(save_h.splitlines(), 1):
    if "Rpg" in line or "rpg" in line or "craft" in line.lower() or "kSaveVersion" in line:
        out.append(f"h{i}:{line.rstrip()[:180]}")
for i, line in enumerate(save_cpp.splitlines(), 1):
    if "Rpg" in line or "rpg" in line or "craft" in line.lower() or "kSaveVersion" in line:
        out.append(f"c{i}:{line.rstrip()[:180]}")

# save_run_now rpg
out.append("\n==== main save_run_now rpg/craft ====")
for i, line in enumerate(main.splitlines(), 1):
    if "runState." in line and ("rpg" in line.lower() or "craft" in line.lower() or "Rpg" in line):
        out.append(f"{i}:{line.rstrip()[:180]}")
for i, line in enumerate(main.splitlines(), 1):
    if "carriedRpg" in line or "craft_write" in line or "craft_read" in line:
        out.append(f"{i}:{line.rstrip()[:180]}")

# backlog status of these
bl = (root / ".agents/worker_game_audit/BACKLOG.md").read_text(encoding="utf-8", errors="replace")
out.append("\n==== backlog ATTR1 AGIMV SAVRPG ====")
for i, line in enumerate(bl.splitlines(), 1):
    if any(k in line for k in ["ATTR1", "AGIMV", "SAVRPG", "SAVSTAT", "QKILL"]):
        out.append(f"{i}:{line[:200]}")

# progress
pr = (root / ".agents/worker_game_audit/progress.md").read_text(encoding="utf-8", errors="replace")
out.append("\n==== progress mentions ====")
for i, line in enumerate(pr.splitlines(), 1):
    if any(k in line for k in ["ATTR1", "AGIMV", "SAVRPG", "QKILL", "SAVSTAT", "GREEN"]):
        out.append(f"{i}:{line[:200]}")

Path(r"C:/hades/gigahrush2/shots/_probe_attr_agi_sav_out.txt").write_text("\n".join(out), encoding="utf-8")
print("WROTE", len(out))
