import os, subprocess, re
os.chdir(r"C:\hades\gigahrush2")
ps = subprocess.run(["tasklist"], capture_output=True, text=True)
print("TEST_RUNNING" if "game_test.exe" in ps.stdout else "TEST_DONE")
for p in [r"shots\_rpgcmbt_test_out.txt", r"shots\_rpgcmbt_run_log.txt"]:
    print("---", p, "size", os.path.getsize(p) if os.path.exists(p) else -1)
    if not os.path.exists(p):
        continue
    t = open(p, "rb").read().decode("utf-8", "replace")
    m = re.search(r"game_test: (\d+) checks, (\d+) failures", t)
    print("MATCH", m.groups() if m else None)
    for ln in t.splitlines():
        if "===EXIT=" in ln or ("EXIT=" in ln and "ELAPSED" in ln):
            print("FOOTER", ln)
        if "FAIL" in ln or "failed" in ln.lower():
            if "0 failures" in ln:
                continue
            print("FAILINE", ln[:240])
    print("TAIL:")
    print("\n".join(t.splitlines()[-25:]))

for md in ["shots/_critique_rpgcmbt.md", "shots/_audit_unwired.md", "shots/_proof_plan_rpg.md"]:
    print("\n========", md, "========")
    if os.path.exists(md):
        print(open(md, encoding="utf-8", errors="replace").read()[:4000])
    else:
        print("MISSING")
