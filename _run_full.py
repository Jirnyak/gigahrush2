import os, subprocess, time, sys
root = r"C:\hades\gigahrush2"
exe = os.path.join(root, "build-win", "Release", "game_test.exe")
outp = os.path.join(root, "_test_out.txt")
logp = os.path.join(root, "_run_full_log.txt")

def log(msg):
    with open(logp, "a", encoding="utf-8") as f:
        f.write(msg + "\n")
    print(msg, flush=True)

# kill leftovers
subprocess.run(["taskkill", "/F", "/IM", "game_test.exe"], capture_output=True)
time.sleep(1)

open(outp, "w").close()
open(logp, "w").close()
log("starting game_test")

# Start detached-ish: Popen with stdout to file, unbuffered via env
env = os.environ.copy()
# MSVC CRT: setvbuf should already be in main; force line buffering via python reader
proc = subprocess.Popen(
    [exe],
    cwd=root,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    bufsize=0,  # unbuffered binary
)

# Stream to file
start = time.time()
last_report = start
nlines = 0
with open(outp, "wb") as out:
    while True:
        chunk = proc.stdout.read(4096)
        if not chunk:
            if proc.poll() is not None:
                break
            time.sleep(0.05)
            continue
        out.write(chunk)
        out.flush()
        nlines += chunk.count(b"\n")
        now = time.time()
        if now - last_report > 30:
            log(f"t={int(now-start)}s bytes={out.tell()} rc_pending lines~{nlines}")
            last_report = now
        # safety: 25 min max
        if now - start > 1500:
            log("TIMEOUT killing")
            proc.kill()
            break

rc = proc.wait(timeout=30)
elapsed = time.time() - start
log(f"DONE rc={rc} elapsed={int(elapsed)}s bytes={os.path.getsize(outp)}")

# Extract summary
text = open(outp, encoding="utf-8", errors="replace").read()
for line in text.splitlines():
    if "game_test:" in line or "FAIL" in line or "failure" in line.lower():
        log("SUM: " + line)

# tail
tail = "\n".join(text.splitlines()[-30:])
open(os.path.join(root, "_test_tail.txt"), "w", encoding="utf-8").write(tail)
log("tail written")
sys.exit(rc if rc is not None else 1)
