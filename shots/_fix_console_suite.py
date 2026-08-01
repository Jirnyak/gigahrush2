# Fix suite_console.inl: attr tests cleared Fly before Fly|Save|Menu assert.
# Move attr block AFTER the drain of fly/save/menu.
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
p = ROOT / "tests" / "suite_console.inl"
t = p.read_text(encoding="utf-8")

old = """    CHECK(con.exec(ctx, "fly", out, sizeof out));
    CHECK(ctx.requestBits == request_bit(ConsoleRequest::Fly));
    CHECK(con.exec(ctx, "attr str", out, sizeof out));
    CHECK((ctx.requestBits & request_bit(ConsoleRequest::AttrStr)) != 0);
    ctx.requestBits = 0;
    CHECK(con.exec(ctx, "attr agi", out, sizeof out));
    CHECK(ctx.take_requests() == request_bit(ConsoleRequest::AttrAgi));
    CHECK(con.exec(ctx, "attr int", out, sizeof out));
    CHECK(ctx.take_requests() == request_bit(ConsoleRequest::AttrInt));
    CHECK(!con.exec(ctx, "attr", out, sizeof out));
    CHECK(!con.exec(ctx, "attr luck", out, sizeof out));
    CHECK(con.exec(ctx, "save", out, sizeof out));
    CHECK(con.exec(ctx, "menu", out, sizeof out));
    CHECK(ctx.requestBits == (request_bit(ConsoleRequest::Fly) |
                              request_bit(ConsoleRequest::Save) |
                              request_bit(ConsoleRequest::Menu)));
    // take_requests drains: once handed to the app, the bits are gone.
    CHECK(ctx.take_requests() == (request_bit(ConsoleRequest::Fly) |
                                  request_bit(ConsoleRequest::Save) |
                                  request_bit(ConsoleRequest::Menu)));
    CHECK(ctx.requestBits == 0);
    CHECK(ctx.take_requests() == 0);"""

new = """    CHECK(con.exec(ctx, "fly", out, sizeof out));
    CHECK(ctx.requestBits == request_bit(ConsoleRequest::Fly));
    CHECK(con.exec(ctx, "save", out, sizeof out));
    CHECK(con.exec(ctx, "menu", out, sizeof out));
    CHECK(ctx.requestBits == (request_bit(ConsoleRequest::Fly) |
                              request_bit(ConsoleRequest::Save) |
                              request_bit(ConsoleRequest::Menu)));
    // take_requests drains: once handed to the app, the bits are gone.
    CHECK(ctx.take_requests() == (request_bit(ConsoleRequest::Fly) |
                                  request_bit(ConsoleRequest::Save) |
                                  request_bit(ConsoleRequest::Menu)));
    CHECK(ctx.requestBits == 0);
    CHECK(ctx.take_requests() == 0);

    // ATTR1: multi-word attr <str|agi|int> sets one bit each; bare/unknown refused.
    // Kept AFTER the fly|save|menu accumulation so that intermediate clears do
    // not poison the three-bit weld above.
    CHECK(con.exec(ctx, "attr str", out, sizeof out));
    CHECK(ctx.take_requests() == request_bit(ConsoleRequest::AttrStr));
    CHECK(con.exec(ctx, "attr agi", out, sizeof out));
    CHECK(ctx.take_requests() == request_bit(ConsoleRequest::AttrAgi));
    CHECK(con.exec(ctx, "attr int", out, sizeof out));
    CHECK(ctx.take_requests() == request_bit(ConsoleRequest::AttrInt));
    CHECK(!con.exec(ctx, "attr", out, sizeof out));
    CHECK(!con.exec(ctx, "attr luck", out, sizeof out));
    CHECK(ctx.take_requests() == 0);"""

if old not in t:
    print("FAIL block not found")
    # show current test_console_requests region
    idx = t.find("test_console_requests")
    print(t[idx:idx+2000])
    raise SystemExit(1)

t = t.replace(old, new, 1)
p.write_text(t, encoding="utf-8", newline="\n")
print("OK suite_console.inl reordered attr after fly|save|menu")

# CMake pin 219422 -> 219425 (actual count from failed run; CHECKs still fire on fail)
cm = ROOT / "CMakeLists.txt"
ct = cm.read_text(encoding="utf-8")
if "219425" in ct:
    print("SKIP pin already 219425")
elif "219422" in ct:
    ct = ct.replace(
        'PASS_REGULAR_EXPRESSION "game_test: 219422 checks, 0 failures"',
        'PASS_REGULAR_EXPRESSION "game_test: 219425 checks, 0 failures"',
        1,
    )
    ct = ct.replace(
        "219409 -> 219422 (+13)",
        "219409 -> 219425 (+16)",
        1,
    )
    # suite_console was +9 estimate; actual + attr drain CHECK may differ.
    # measured 219425 total.
    if "suite_console +9" in ct:
        ct = ct.replace(
            "suite_console +9, suite_keybind +4.",
            "suite_console +attr bits, suite_keybind +4; measured 219425.",
            1,
        )
    cm.write_text(ct, encoding="utf-8", newline="\n")
    print("OK CMake pin 219422 -> 219425")
else:
    print("WARN no 219422 pin")
    for i, l in enumerate(ct.splitlines(), 1):
        if "game_test:" in l and "checks" in l:
            print(f"  {i}|{l}")
