from pathlib import Path

p = Path(r"C:\hades\gigahrush2\tests\game_test.cpp")
raw = p.read_bytes()
# Detect newline style
nl = b"\r\n" if b"\r\n" in raw else b"\n"
t = raw.decode("utf-8")

marker = "RPG1 pin on second body-swap"
if marker in t:
    print("ALREADY_PATCHED")
    raise SystemExit(0)

down = t.find("Ride back down")
if down < 0:
    print("FAIL: Ride back down not found")
    raise SystemExit(1)

# Find the kills==99 CHECK after the down-ride marker (second body-swap block)
kills_pat = "CHECK(reg.get<PlayerMelee>(p).kills == 99);"
pos = t.find(kills_pat, down)
if pos < 0:
    print("FAIL: kills==99 after Ride back down not found")
    raise SystemExit(1)

line_end = t.find("\n", pos)
if line_end < 0:
    print("FAIL: no newline after kills line")
    raise SystemExit(1)

# Next non-whitespace should be closing brace of test_elevator
rest = t[line_end + 1 :]
# strip leading whitespace/newlines to find }
i = 0
while i < len(rest) and rest[i] in " \t\r\n":
    i += 1
if i >= len(rest) or rest[i] != "}":
    print("FAIL: expected } after kills line, got:", repr(rest[:40]))
    raise SystemExit(1)

close_abs = line_end + 1 + i

insert = """    // RPG1 pin on second body-swap (down ride): sheet must survive both folds.
    CHECK(reg.all_of<RpgStats>(p));
    CHECK(reg.get<RpgStats>(p).xp == 777u);
    CHECK(reg.get<RpgStats>(p).psi == 42);
    CHECK(reg.get<RpgStats>(p).level == 5);
    CHECK(reg.get<RpgStats>(p).attrPoints == 3);
    CHECK(reg.get<RpgStats>(p).attr[static_cast<std::size_t>(Attr::Str)] == 11);
    CHECK(reg.get<RpgStats>(p).attr[static_cast<std::size_t>(Attr::Agi)] == 9);
    CHECK(reg.get<RpgStats>(p).attr[static_cast<std::size_t>(Attr::Int)] == 7);
"""
# Normalize insert newlines to file style
if nl == b"\r\n":
    insert = insert.replace("\n", "\r\n")

new_t = t[:close_abs] + insert + t[close_abs:]
p.write_bytes(new_t.encode("utf-8"))
print("PATCHED at", close_abs)
print("down_idx", down, "kills_pos", pos)
