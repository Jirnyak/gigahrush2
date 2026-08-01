# -*- coding: utf-8 -*-
"""re-PAR1 + next-gap probe after SAVSTAT close."""
from pathlib import Path
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(r"C:\hades\gigahrush2")
OUT = ROOT / "shots" / "_repar1_out.txt"


def dump(msg: str) -> None:
    print(msg)


def main() -> None:
    main_p = ROOT / "src" / "app" / "main.cpp"
    text = main_p.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    dump(f"main.cpp lines={len(lines)} bytes={main_p.stat().st_size}")

    for name, needle in (
        ("PBS", "place_body_safely"),
        ("AIR", "ai_release"),
        ("ST", "playerStatus"),
        ("RS", "runState.status"),
        ("CARVE", "combatCarves"),
        ("FLY", "fly=false"),
        ("FLY2", "fly = false"),
    ):
        hits = [(i + 1, ln.strip()[:120]) for i, ln in enumerate(lines) if needle in ln]
        dump(f"--- {name} ({needle}) n={len(hits)} ---")
        for i, s in hits:
            dump(f"  {i}: {s}")

    sh = (ROOT / "src" / "game" / "save.h").read_text(encoding="utf-8", errors="replace")
    dump("--- save.h pins ---")
    for i, ln in enumerate(sh.splitlines(), 1):
        if any(k in ln for k in ("kSaveVersion", "kStatusWire", "kSaveFixedWire", "visit_status", "status")):
            if "status" in ln.lower() or any(
                k in ln for k in ("kSaveVersion", "kStatusWire", "kSaveFixedWire", "visit_status")
            ):
                dump(f"  {i}: {ln.strip()[:120]}")

    dump("--- HUD mag / PlayerRanged ---")
    for i, ln in enumerate(lines, 1):
        low = ln.lower()
        if "mag" in low and any(
            k in ln for k in ("snprintf", "sprintf", "%u/%u", "PlayerRanged", "magCount")
        ):
            dump(f"  {i}: {ln.strip()[:140]}")

    # elevator capture counts
    el = (ROOT / "src" / "game" / "elevator.cpp").read_text(encoding="utf-8", errors="replace")
    dump("--- elevator ---")
    for key in ("hadRanged", "hadMelee", "hadRpg", "emplace_or_replace"):
        dump(f"  {key}={el.count(key)}")

    # suite_saveload status pins
    sl = (ROOT / "tests" / "suite_saveload.inl").read_text(encoding="utf-8", errors="replace")
    dump("--- suite_saveload status ---")
    for i, ln in enumerate(sl.splitlines(), 1):
        if "status" in ln.lower() and any(
            k in ln for k in ("remainMs", "intensityE3", "alt", "kStatus", "Status", "219")
        ):
            dump(f"  {i}: {ln.strip()[:120]}")

    # unwired audit if present
    uw = ROOT / "shots" / "_audit_unwired.md"
    if uw.exists():
        dump("--- audit_unwired head ---")
        dump("\n".join(uw.read_text(encoding="utf-8", errors="replace").splitlines()[:60]))

    # ORIGINAL_REQUEST for lane intent
    for p in (
        ROOT / ".agents" / "worker_game_audit" / "ORIGINAL_REQUEST.md",
        ROOT / "ORIGINAL_REQUEST.md",
    ):
        if p.exists():
            dump(f"--- {p} ---")
            dump(p.read_text(encoding="utf-8", errors="replace")[:2000])

    # Look for potential next gaps: status on possess? craft on possess?
    dump("--- possess + status seams ---")
    for i, ln in enumerate(lines, 1):
        if "possess" in ln.lower() and any(
            k in ln for k in ("Status", "status", "craft", "Craft", "Rpg", "kills")
        ):
            dump(f"  {i}: {ln.strip()[:140]}")

    # transfer_player_progression
    combat_h = (ROOT / "src" / "game" / "combat.h").read_text(encoding="utf-8", errors="replace")
    for i, ln in enumerate(combat_h.splitlines(), 1):
        if "transfer_player" in ln or "StatusSet" in ln:
            dump(f"combat.h {i}: {ln.strip()[:120]}")

    dump("DONE repar1")


if __name__ == "__main__":
    # tee to file
    class Tee:
        def __init__(self):
            self.buf = []

        def write(self, s):
            self.buf.append(s)
            try:
                sys.__stdout__.write(s)
            except Exception:
                pass

        def flush(self):
            pass

    t = Tee()
    old = sys.stdout
    sys.stdout = t  # type: ignore
    try:
        main()
    finally:
        sys.stdout = old
        OUT.write_text("".join(t.buf), encoding="utf-8")
        print(f"wrote {OUT} bytes={OUT.stat().st_size}")
