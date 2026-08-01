# ATTR1 + AGIMV + RPGCMBT-SHOT wire-up
from pathlib import Path
import sys
import re

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        if new.strip() and new in text:
            print(f"SKIP already {path.name} [{label}]")
            return
        print(f"FAIL missing needle in {path} [{label}]")
        key = old.split("\n")[0][:50]
        for i, l in enumerate(text.splitlines(), 1):
            if key[:25] in l:
                print(f"  near {i}: {l[:120]}")
        sys.exit(1)
    n = text.count(old)
    if n != 1:
        print(f"FAIL needle count={n} in {path} [{label}]")
        sys.exit(1)
    path.write_text(text.replace(old, new, 1), encoding="utf-8", newline="\n")
    print(f"OK {path.relative_to(ROOT)} [{label}]")


# 1. keybind.h digits
replace_once(
    ROOT / "src/game/keybind.h",
    "    kW = 26, kX = 27, kEscape = 41, kTab = 43, kSpace = 44, kLeftBracket = 47,\n"
    "    kRightBracket = 48, kGrave = 53, kF1 = 58, kF5 = 62, kF9 = 66,\n"
    "    kLCtrl = 224;",
    "    kW = 26, kX = 27, kEscape = 41, kTab = 43, kSpace = 44, kLeftBracket = 47,\n"
    "    kRightBracket = 48, kGrave = 53, kF1 = 58, kF5 = 62, kF9 = 66,\n"
    "    // Digit row (SDL_SCANCODE_1/2/3). ATTR1 spends unspent points on STR/AGI/INT.\n"
    "    k1 = 30, k2 = 31, k3 = 32,\n"
    "    kLCtrl = 224;",
    "keybind digits",
)

# 2. keybind.cpp
replace_once(
    ROOT / "src/game/keybind.cpp",
    '    ok &= t.add({"scrap", "scrap", scan::kX, 0});\n'
    "    // Run persistence.\n"
    '    ok &= t.add({"save", "save", scan::kF5, 0});',
    '    ok &= t.add({"scrap", "scrap", scan::kX, 0});\n'
    "    // ATTR1: spend one unspent attribute point (console `attr str|agi|int`).\n"
    '    ok &= t.add({"attr_str", "attr str", scan::k1, 0});\n'
    '    ok &= t.add({"attr_agi", "attr agi", scan::k2, 0});\n'
    '    ok &= t.add({"attr_int", "attr int", scan::k3, 0});\n'
    "    // Run persistence.\n"
    '    ok &= t.add({"save", "save", scan::kF5, 0});',
    "keybind attr rows",
)

# 3. console.h enum
replace_once(
    ROOT / "src/game/console.h",
    "    Craft, Scrap,            // crafting window / scrap cheapest junk\n"
    "    Count\n"
    "};",
    "    Craft, Scrap,            // crafting window / scrap cheapest junk\n"
    "    AttrStr, AttrAgi, AttrInt, // ATTR1: spend one unspent point on STR/AGI/INT\n"
    "    Count\n"
    "};",
    "ConsoleRequest Attr*",
)

replace_once(
    ROOT / "src/game/console.h",
    "// action (fly, save, load, heal, eat, drink, door, possess, interact, sell,\n"
    "// vendor, resupply, craft, scrap, hud, menu, console, mouselook, quit).",
    "// action (fly, save, load, heal, eat, drink, door, possess, interact, sell,\n"
    "// vendor, resupply, craft, scrap, attr str/agi/int, hud, menu, console,\n"
    "// mouselook, quit).",
    "console.h comment",
)

# 4. console.cpp cmd_attr
cc_path = ROOT / "src/game/console.cpp"
cc = cc_path.read_text(encoding="utf-8")
if "cmd_attr" not in cc:
    needle = (
        '    {"scrap", "scrap the cheapest junk carried", ConsoleRequest::Scrap},\n'
        "};\n"
    )
    if needle not in cc:
        print("FAIL kRequestRows tail")
        sys.exit(1)
    insert = r'''    {"scrap", "scrap the cheapest junk carried", ConsoleRequest::Scrap},
    // ATTR1 bits are set by cmd_attr (multi-word), not bare request rows.
};

// ATTR1: `attr str|agi|int` — spend one unspent point. The app drains the
// matching ConsoleRequest bit and calls spend_attr_point with pool HP ptrs.
bool cmd_attr(ConsoleContext& ctx, int argc, const char* const* argv,
              char* out, std::size_t cap) {
    if (argc < 2 || !argv[1] || !argv[1][0]) {
        if (out && cap) std::snprintf(out, cap, "usage: attr <str|agi|int>");
        return false;
    }
    ConsoleRequest bit = ConsoleRequest::Count;
    const char* a = argv[1];
    if (std::strcmp(a, "str") == 0 || std::strcmp(a, "STR") == 0)
        bit = ConsoleRequest::AttrStr;
    else if (std::strcmp(a, "agi") == 0 || std::strcmp(a, "AGI") == 0)
        bit = ConsoleRequest::AttrAgi;
    else if (std::strcmp(a, "int") == 0 || std::strcmp(a, "INT") == 0)
        bit = ConsoleRequest::AttrInt;
    else {
        if (out && cap) std::snprintf(out, cap, "attr: want str|agi|int, got %s", a);
        return false;
    }
    ctx.requestBits |= request_bit(bit);
    if (out && cap) std::snprintf(out, cap, "attr %s: requested", a);
    return true;
}

std::uint32_t complete_attr(const ConsoleContext&,
                            int argIndex, const char* prefix,
                            const char** out, std::uint32_t cap) {
    if (argIndex != 1 || !out || cap == 0) return 0;
    static constexpr const char* kOpts[] = {"str", "agi", "int"};
    std::uint32_t n = 0;
    const std::size_t plen = prefix ? std::strlen(prefix) : 0;
    for (const char* o : kOpts) {
        if (plen && std::strncmp(o, prefix, plen) != 0) continue;
        if (n >= cap) break;
        out[n++] = o;
    }
    return n;
}
'''
    cc = cc.replace(needle, insert, 1)
    reg_needle = (
        "    // Every request row shares one handler — argv[0] selects the bit.\n"
        "    for (const RequestRow& row : kRequestRows)\n"
        "        ok &= con.add({row.name, row.name, row.help, cmd_request, nullptr});\n"
        "    return ok;\n"
    )
    reg_new = (
        "    // Every request row shares one handler — argv[0] selects the bit.\n"
        "    for (const RequestRow& row : kRequestRows)\n"
        "        ok &= con.add({row.name, row.name, row.help, cmd_request, nullptr});\n"
        "    // ATTR1 multi-word spender (keybind emits `attr str` etc.).\n"
        '    ok &= con.add({"attr", "attr <str|agi|int>",\n'
        '                   "spend one unspent attribute point",\n'
        "                   cmd_attr, complete_attr});\n"
        "    return ok;\n"
    )
    if reg_needle not in cc:
        print("FAIL register_defaults tail")
        # try alternate dash
        reg_needle2 = reg_needle.replace("—", "-")
        if reg_needle2 in cc:
            reg_needle = reg_needle2
            reg_new = reg_new  # keep
        else:
            # dump nearby
            for i, l in enumerate(cc.splitlines(), 1):
                if "kRequestRows" in l or "cmd_request" in l:
                    print(f"  {i}|{l}")
            sys.exit(1)
    cc = cc.replace(reg_needle, reg_new, 1)
    if "#include <cstring>" not in cc:
        cc = cc.replace("#include <cstdio>", "#include <cstdio>\n#include <cstring>", 1)
    cc_path.write_text(cc, encoding="utf-8", newline="\n")
    print("OK src/game/console.cpp [cmd_attr]")
else:
    print("SKIP console.cpp cmd_attr already")

# 5. main.cpp
main = ROOT / "src/app/main.cpp"
mt = main.read_text(encoding="utf-8")

# 5a drain
drain_old = (
    "            if (has(ConsoleRequest::Craft)) {\n"
    "                craftWanted = true;\n"
    "                showCraftingWindow = !showCraftingWindow;\n"
    "                if (showCraftingWindow) input.set_mouselook(false);\n"
    "            }\n"
    "            // Interact takes the job on offer"
)
drain_new = r'''            if (has(ConsoleRequest::Craft)) {
                craftWanted = true;
                showCraftingWindow = !showCraftingWindow;
                if (showCraftingWindow) input.set_mouselook(false);
            }
            // ATTR1: spend one unspent point. HP ptrs from the pool row so
            // STR immediately credits max-HP the same way award_xp does.
            if ((has(ConsoleRequest::AttrStr) || has(ConsoleRequest::AttrAgi) ||
                 has(ConsoleRequest::AttrInt)) &&
                reg.valid(player)) {
                if (auto* rs = reg.try_get<game::RpgStats>(player)) {
                    std::int16_t* hp = nullptr;
                    std::int16_t* maxHp = nullptr;
                    if (const game::NpcRef* nr =
                            reg.try_get<game::NpcRef>(player)) {
                        if (pool.valid(nr->id)) {
                            hp = &pool.hp(nr->id);
                            maxHp = &pool.max_hp(nr->id);
                        }
                    }
                    game::Attr which = game::Attr::Str;
                    const char* tag = "str";
                    if (has(ConsoleRequest::AttrAgi)) {
                        which = game::Attr::Agi;
                        tag = "agi";
                    } else if (has(ConsoleRequest::AttrInt)) {
                        which = game::Attr::Int;
                        tag = "int";
                    }
                    const bool ok = game::spend_attr_point(*rs, which, hp, maxHp);
                    std::fprintf(stderr,
                                 "[attr] spend %s ok=%d pts_left=%u "
                                 "str=%u agi=%u int=%u\n",
                                 tag, ok ? 1 : 0, rs->attrPoints,
                                 rs->attr[0], rs->attr[1], rs->attr[2]);
                }
            }
            // Interact takes the job on offer'''
if drain_old not in mt:
    if "[attr] spend" in mt:
        print("SKIP main drain attr already")
    else:
        print("FAIL main drain needle")
        sys.exit(1)
else:
    mt = mt.replace(drain_old, drain_new, 1)
    print("OK main drain ATTR1")

# 5b AGIMV
move_old = (
    "                        ctl_->moveSpeed =\n"
    "                            kPlayerWalkSpeed * needs.speedScale * sm;\n"
)
move_new = (
    "                        ctl_->moveSpeed =\n"
    "                            kPlayerWalkSpeed * needs.speedScale * sm;\n"
    "                        // AGIMV: AGI multiplies walk speed (linear +1%/pt).\n"
    "                        if (const game::RpgStats* rs =\n"
    "                                reg.try_get<game::RpgStats>(player)) {\n"
    "                            ctl_->moveSpeed *=\n"
    "                                game::agi_move_speed_mult_e3(*rs) / 1000.0f;\n"
    "                        }\n"
)
if move_old not in mt:
    if "agi_move_speed_mult_e3" in mt:
        print("SKIP main AGIMV already")
    else:
        print("FAIL main move needle")
        sys.exit(1)
else:
    mt = mt.replace(move_old, move_new, 1)
    print("OK main AGIMV")

# 5c rpgcmbt shotAction
rpg_marker = '                    if (shotAction == "attack") {\n'
if 'shotAction == "rpgcmbt"' in mt:
    print("SKIP main rpgcmbt action already")
else:
    if rpg_marker not in mt:
        print("FAIL shotAction attack marker")
        sys.exit(1)
    rpg_block = r'''                    if (shotAction == "rpgcmbt" && reg.valid(player)) {
                        // RPGCMBT-SHOT: force a loud sheet so scaled melee
                        // is visible in stderr + HUD (random_rpg is modest).
                        static bool rpgcmbtSheet = false;
                        if (!rpgcmbtSheet) {
                            game::RpgStats sheet = game::fresh_rpg(10);
                            sheet.attr[0] = 20;  // STR
                            sheet.attr[1] = 20;  // AGI
                            sheet.attr[2] = 5;   // INT
                            sheet.attrPoints = 3;
                            sheet.psi = game::max_psi(sheet);
                            reg.emplace_or_replace<game::RpgStats>(player,
                                                                   sheet);
                            // Credit STR max-HP onto the pool row.
                            if (const game::NpcRef* nr =
                                    reg.try_get<game::NpcRef>(player)) {
                                if (pool.valid(nr->id)) {
                                    const std::int16_t mh =
                                        static_cast<std::int16_t>(
                                            game::max_hp(sheet));
                                    pool.max_hp(nr->id) = mh;
                                    if (pool.hp(nr->id) < mh)
                                        pool.hp(nr->id) = mh;
                                }
                            }
                            rpgcmbtSheet = true;
                            std::fprintf(stderr,
                                         "[rpgcmbt] forced sheet "
                                         "lvl=%u str=%u agi=%u int=%u\n",
                                         sheet.level, sheet.attr[0],
                                         sheet.attr[1], sheet.attr[2]);
                        }
                        // Hold attack every tick (same as wall/attack).
                        attackHeld = true;
                    } else if (shotAction == "attack") {
'''
    mt = mt.replace(rpg_marker, rpg_block, 1)
    print("OK main rpgcmbt shotAction")

# wall face/walk also for rpgcmbt
wall_face_old = (
    '                if (shotPath && shotAction == "wall" && reg.valid(player) &&\n'
    "                    shotFramesSeen >= 30 && !doors.frozen) {\n"
)
wall_face_new = (
    "                if (shotPath &&\n"
    '                    (shotAction == "wall" || shotAction == "rpgcmbt") &&\n'
    "                    reg.valid(player) &&\n"
    "                    shotFramesSeen >= 30 && !doors.frozen) {\n"
)
if 'shotAction == "wall" || shotAction == "rpgcmbt"' in mt:
    print("SKIP wall|rpgcmbt face already")
elif wall_face_old not in mt:
    print("FAIL wall face needle")
    sys.exit(1)
else:
    mt = mt.replace(wall_face_old, wall_face_new, 1)
    print("OK main wall|rpgcmbt face/walk")

# HUD scaled dmg
hud_old = (
    '                    ImGui::Text("weapon: %s (%u dmg) | armour: %s",\n'
    '                                wpn == game::kInvalidItem ? "fists"\n'
    "                                                          : game::item_name(wpn),\n"
    "                                md->dmg,\n"
)
if "shownDmg" in mt and "melee_damage(" in mt:
    print("SKIP HUD scaled dmg already")
elif hud_old not in mt:
    print("FAIL hud_old")
    idx = mt.find('weapon: %s')
    print(repr(mt[idx:idx+250]) if idx>=0 else "no weapon line")
    sys.exit(1)
else:
    hud_new = (
        "                    {\n"
        "                        std::uint16_t shownDmg = md->dmg;\n"
        "                        if (rs)\n"
        "                            shownDmg = static_cast<std::uint16_t>(\n"
        "                                std::max<std::int16_t>(\n"
        "                                    1, game::melee_damage(\n"
        "                                           *rs, wpn,\n"
        "                                           static_cast<std::int16_t>(md->dmg))));\n"
        '                        ImGui::Text("weapon: %s (%u dmg) | armour: %s",\n'
        '                                    wpn == game::kInvalidItem ? "fists"\n'
        "                                                              : game::item_name(wpn),\n"
        "                                    shownDmg,\n"
    )
    mt = mt.replace(hud_old, hud_new, 1)
    # close block after armour arg
    pos = mt.find("shownDmg,\n")
    if pos < 0:
        print("FAIL shownDmg")
        sys.exit(1)
    chunk = mt[pos : pos + 400]
    m = re.search(r"item_name\(arm\)\);", chunk)
    if not m:
        print("FAIL armour close\n", chunk)
        sys.exit(1)
    end = pos + m.end()
    # insert } after );
    if mt[end:end+1] == "\n":
        insert_at = end + 1
    else:
        insert_at = end
    close = "                    }\n"
    if mt[insert_at:insert_at+len(close)] != close:
        mt = mt[:insert_at] + close + mt[insert_at:]
    print("OK main HUD scaled dmg")

# include rpg.h
if '#include "game/rpg.h"' not in mt:
    for inc in [
        '#include "game/combat.h"',
        '#include "game/embody.h"',
        '#include "game/console.h"',
    ]:
        if inc in mt:
            mt = mt.replace(inc, inc + '\n#include "game/rpg.h"', 1)
            print("OK main include rpg.h")
            break
    else:
        print("WARN no rpg.h include — may be transitive")

main.write_text(mt, encoding="utf-8", newline="\n")
print("OK wrote main.cpp")

# 6. combat.cpp log
cp = ROOT / "src/game/combat.cpp"
ct = cp.read_text(encoding="utf-8")
if "[rpgcmbt] melee" in ct:
    print("SKIP combat log already")
else:
    old_m = (
        "        swingDmg = melee_damage(*rs, heldWeapon, static_cast<std::int16_t>(wp->dmg));\n"
    )
    idx = ct.find(old_m)
    if idx < 0:
        print("FAIL melee_damage assign")
        sys.exit(1)
    m = re.search(
        r"(        swingDmg = melee_damage\(\*rs, heldWeapon, static_cast<std::int16_t>\(wp->dmg\)\);\n"
        r".*?"
        r"        swingCd = static_cast<std::uint16_t>\(cd > 65535u \? 65535u : \(cd < 1u \? 1u : cd\)\);\n"
        r"    \})",
        ct[idx : idx + 600],
        re.S,
    )
    if not m:
        print("FAIL melee rs block regex")
        lines = ct.splitlines()
        for j in range(1220, min(len(lines), 1240)):
            print(f"{j+1}|{lines[j]}")
        sys.exit(1)
    old_block = m.group(1)
    log_tail = r'''        static int rpgcmbtLog = 0;
        if ((rpgcmbtLog++ % 30) == 0) {
            std::fprintf(stderr,
                         "[rpgcmbt] melee dmg=%d cd=%u str=%u agi=%u "
                         "lvl=%u weapon=%u\n",
                         static_cast<int>(swingDmg), swingCd,
                         static_cast<unsigned>(rs->attr[0]),
                         static_cast<unsigned>(rs->attr[1]),
                         static_cast<unsigned>(rs->level),
                         static_cast<unsigned>(heldWeapon));
        }
    }'''
    # strip trailing "    }" from old_block
    if not old_block.rstrip().endswith("}"):
        print("FAIL block end")
        sys.exit(1)
    # replace last "    }"
    cut = old_block.rstrip()
    assert cut.endswith("}")
    # find last newline before }
    new_block = cut[: cut.rfind("\n") + 1] + log_tail
    ct = ct[:idx] + ct[idx:].replace(old_block, new_block, 1)
    if "#include <cstdio>" not in ct:
        # insert after first include
        ct = re.sub(r"(#include [^\n]+\n)", r"\1#include <cstdio>\n", ct, count=1)
    cp.write_text(ct, encoding="utf-8", newline="\n")
    print("OK combat.cpp [rpgcmbt] log")

# 7. suite_console
sc = ROOT / "tests/suite_console.inl"
st = sc.read_text(encoding="utf-8")
if 'defaults.find("attr")' in st:
    print("SKIP suite_console attr already")
else:
    old = '    CHECK(defaults.find("interact") != nullptr);\n'
    if old not in st:
        print("FAIL suite_console interact find")
        sys.exit(1)
    st = st.replace(old, old + '    CHECK(defaults.find("attr") != nullptr);\n', 1)
    old2 = (
        '    CHECK(con.exec(ctx, "fly", out, sizeof out));\n'
        "    CHECK(ctx.requestBits == request_bit(ConsoleRequest::Fly));\n"
    )
    if old2 not in st:
        print("FAIL suite_console fly exec")
        sys.exit(1)
    st = st.replace(
        old2,
        old2
        + '    CHECK(con.exec(ctx, "attr str", out, sizeof out));\n'
        + "    CHECK((ctx.requestBits & request_bit(ConsoleRequest::AttrStr)) != 0);\n"
        + "    ctx.requestBits = 0;\n"
        + '    CHECK(con.exec(ctx, "attr agi", out, sizeof out));\n'
        + "    CHECK(ctx.take_requests() == request_bit(ConsoleRequest::AttrAgi));\n"
        + '    CHECK(con.exec(ctx, "attr int", out, sizeof out));\n'
        + "    CHECK(ctx.take_requests() == request_bit(ConsoleRequest::AttrInt));\n"
        + '    CHECK(!con.exec(ctx, "attr", out, sizeof out));\n'
        + '    CHECK(!con.exec(ctx, "attr luck", out, sizeof out));\n',
        1,
    )
    sc.write_text(st, encoding="utf-8", newline="\n")
    print("OK suite_console attr pins (+9 CHECKs)")

# 8. suite_keybind
sk = ROOT / "tests/suite_keybind.inl"
kt = sk.read_text(encoding="utf-8")
if 'defaults.find("attr_str")' in kt:
    print("SKIP suite_keybind attr already")
else:
    old = '    CHECK(defaults.find("jump") != nullptr);\n'
    if old not in kt:
        print("FAIL suite_keybind jump")
        sys.exit(1)
    kt = kt.replace(
        old,
        old
        + '    CHECK(defaults.find("attr_str") != nullptr);\n'
        + '    CHECK(defaults.find("attr_agi") != nullptr);\n'
        + '    CHECK(defaults.find("attr_int") != nullptr);\n'
        + '    CHECK(defaults.find("attr_str")->scancode == scan::k1);\n',
        1,
    )
    sk.write_text(kt, encoding="utf-8", newline="\n")
    print("OK suite_keybind attr pins (+4 CHECKs)")

# CMake pin later after counting actual CHECKs from test run
print("NEW_CHECKS_ESTIMATE console=9 keybind=4 total=13 -> pin 219422")
print("DONE patch")
