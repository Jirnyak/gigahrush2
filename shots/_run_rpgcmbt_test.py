"""Run game_test unbuffered, capture full output + exit code."""
import subprocess, sys, os, time
os.chdir(r"C:\hades\gigahrush2")
out_path = r"shots\_rpgcmbt_test_out.txt"
exe = r"build-win\Release\game_test.exe"
t0 = time.time()
with open(out_path, "wb") as f:
    p = subprocess.Popen(
        [exe],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        cwd=r"C:\hades\gigahrush2",
    )
    assert p.stdout is not None
    # line-buffer drain so file grows live
    while True:
        chunk = p.stdout.read(65536)
        if not chunk:
            break
        f.write(chunk)
        f.flush()
    rc = p.wait()
elapsed = time.time() - t0
# append footer
with open(out_path, "ab") as f:
    f.write(f"\n===EXIT={rc} ELAPSED={elapsed:.1f}s===\n".encode())
print(f"EXIT={rc} ELAPSED={elapsed:.1f}s size={os.path.getsize(out_path)}", flush=True)
# print tail
data = open(out_path, "rb").read()
tail = data[-4000:].decode("utf-8", "replace")
print(tail)
sys.exit(0 if rc == 0 else 1)
