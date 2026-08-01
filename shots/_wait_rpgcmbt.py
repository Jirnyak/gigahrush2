import os, time, subprocess
p = r"shots\_rpgcmbt_test_out.txt"
for i in range(48):
    time.sleep(10)
    ps = subprocess.run(["tasklist"], capture_output=True, text=True)
    running = "game_test.exe" in ps.stdout
    sz = os.path.getsize(p) if os.path.exists(p) else -1
    print(f"t={i*10}s running={running} size={sz}", flush=True)
    if not running:
        data = open(p, "rb").read() if os.path.exists(p) else b""
        print(data[-3000:].decode("utf-8", "replace"))
        break
else:
    print("STILL_RUNNING_AFTER_480s")
