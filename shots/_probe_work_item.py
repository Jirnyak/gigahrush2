from pathlib import Path
import re, subprocess

root = Path(r"C:/hades/gigahrush2")
out = []

def read(p):
    p = Path(p)
    return p.read_text(encoding="utf-8", errors="replace") if p.exists() else ""

# save version
sh = read(root/"src/game/save.h")
sc = read(root/"src/game/save.cpp")
out.append("==== kSaveVersion ====")
for i,l in enumerate(sh.splitlines(),1):
    if "kSaveVersion" in l or "questCount" in l or "questFingerprint" in l:
        out.append(f"h{i}:{l}")
for i,l in enumerate(sc.splitlines(),1):
    if "kSaveVersion" in l or "quest_log" in l or "questCount" in l:
        out.append(f"c{i}:{l}")

# quest_offer_text in main dialog
main = read(root/"src/app/main.cpp")
out.append(f"\nquest_offer_text main={main.count('quest_offer_text')}")
out.append(f"questOfferLine main={main.count('questOfferLine')}")
# how offer line is filled
for i,l in enumerate(main.splitlines(),1):
    if "questOffer" in l or "quest_offer" in l:
        out.append(f"{i}:{l[:180]}")

# floorstream test - is it the long one?
out.append("\n==== floorstream suite ====")
for p in (root/"tests").glob("*floor*"):
    t=read(p)
    out.append(f"{p.name} lines={len(t.splitlines())} bytes={len(t)}")
    # large loops
    for i,l in enumerate(t.splitlines(),1):
        if re.search(r"for\s*\(.*\d{5,}|\bwhile\s*\(|100000|50000|20000", l):
            out.append(f"  {i}:{l[:160]}")

# suite_floorstream in game_test order position
gt=read(root/"tests/game_test.cpp")
calls=[]
for i,l in enumerate(gt.splitlines(),1):
    m=re.search(r"\b(test_\w+)\s*\(", l)
    if m and "void" not in l:
        calls.append((i,m.group(1)))
# find diffusion / floorstream indices
for name in ["test_npcpool_all","test_diffusion","test_floorstream","test_stream","test_quest","test_save"]:
    hits=[(i,n) for i,n in calls if name in n]
    out.append(f"call {name}: {hits}")

out.append(f"\nTotal test calls: {len(calls)}")
# remaining after diffusion
idx=None
for j,(i,n) in enumerate(calls):
    if "diffusion" in n:
        idx=j
if idx is not None:
    out.append("After diffusion:")
    for i,n in calls[idx:idx+25]:
        out.append(f"  {i}:{n}")

# GT live
out.append("\n==== GT live ====")
p=root/"shots/_gt_long_out.txt"
if p.exists():
    t=p.read_text(encoding="utf-8",errors="replace")
    out.append(f"out size={len(t)}")
    out.append(t[-600:])
p=root/"shots/_gt_long_err.txt"
if p.exists():
    t=p.read_text(encoding="utf-8",errors="replace")
    out.append(f"err size={len(t)}")
    out.append(t[-400:])
p=root/"shots/_gt_long_rc.txt"
out.append(f"rc exists={p.exists()} content={p.read_text(encoding='utf-8',errors='replace') if p.exists() else ''}")

# HEAD and whether QKILL still present
r=subprocess.run(["git","-C",str(root),"rev-parse","--short","HEAD"],capture_output=True,text=True)
out.append(f"HEAD {r.stdout.strip()}")
main2=read(root/"src/app/main.cpp")
out.append(f"quest_on_kill={main2.count('quest_on_kill')} quest_on_giver_died={main2.count('quest_on_giver_died')}")

# Look for FIXME/TODO/HACK in src/game and src/app (actionable)
out.append("\n==== FIXME/TODO in src/game+app ====")
for p in list((root/"src/game").rglob("*"))+list((root/"src/app").rglob("*")):
    if p.suffix.lower() not in {".h",".cpp",".inl",".hpp"}: continue
    t=read(p)
    for i,l in enumerate(t.splitlines(),1):
        if re.search(r"\b(FIXME|TODO|XXX|HACK|BUG)\b", l) and not l.strip().startswith("// frozen"):
            out.append(f"{p.relative_to(root)}:{i}:{l.strip()[:140]}")

Path(r"C:/hades/gigahrush2/shots/_probe_work_item_out.txt").write_text("\n".join(out), encoding="utf-8")
print("ok", len(out))
