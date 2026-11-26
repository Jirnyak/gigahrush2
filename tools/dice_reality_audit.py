#!/usr/bin/env python3
"""
GigaHrush 2 — Monte Carlo Dice Reality Audit Engine («Кубик Тимаэрта»)
Stochastic architectural slice auditor across 175 random points in the engine.
Modeled after Timeart & Dental CRM Failure Manifestos doctrine.
"""

import sys
import os
import re
import time
import random
from pathlib import Path

RED = "\033[1;31m"
GREEN = "\033[1;32m"
YELLOW = "\033[1;33m"
CYAN = "\033[1;36m"
BOLD = "\033[1m"
MAGENTA = "\033[1;35m"
RESET = "\033[0m"

# Fast deterministic Mulberry32 / XorShift pseudo-random generator
class DiceRng:
    def __init__(self, seed=None):
        if seed is None:
            seed = int(time.time() * 1000) ^ random.randint(1, 0xFFFFFFFF)
        self.state = seed & 0xFFFFFFFF
        self.initial_seed = self.state

    def next_u32(self):
        # Mulberry32
        self.state = (self.state + 0x6D2B79F5) & 0xFFFFFFFF
        t = self.state
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t ^= (t + ((t ^ (t >> 7)) * (t | 61))) & 0xFFFFFFFF
        return (t ^ (t >> 14)) & 0xFFFFFFFF

    def next_float(self):
        return self.next_u32() / 4294967296.0

    def randint(self, a, b):
        if a >= b:
            return a
        return a + (self.next_u32() % (b - a + 1))

def print_dice_failure_manifesto(file_path, line_no, context_lines, violation_title, explanation, fix_advice):
    print(f"\n{RED}{'='*80}{RESET}")
    print(f"{RED}🎲 [КУБИК ТИМАЭРТА: ОБНАРУЖЕН АРХИТЕКТУРНЫЙ ДЕФЕКТ]{RESET}")
    print(f"{RED}{'-'*80}{RESET}")
    print(f"{BOLD}📍 ТОЧКА СРЕЗА МОНТЕ-КАРЛО:{RESET} {CYAN}{file_path}:{line_no}{RESET}")
    print(f"{BOLD}❌ НАРУШЕННЫЙ ЗАКОН:{RESET} {YELLOW}{violation_title}{RESET}\n")

    print(f"{BOLD}🔍 КОНТЕКСТНОЕ ОКНО (±5 строк вокруг выпавшего кубика):{RESET}")
    for l_num, line_txt in context_lines:
        prefix = f"{RED}▶ {l_num:4d} |{RESET}" if l_num == line_no else f"  {l_num:4d} |"
        print(f"{prefix} {line_txt}")

    print(f"\n{BOLD}⚠️ В ЧЁМ СУТЬ И ПОЧЕМУ ЭТО БРАК:{RESET}\n   {explanation}")
    print(f"\n{RED}{BOLD}🛑 ПРОПИЗДОН АГЕНТУ:{RESET}\n"
          f"   Кубик Тимаэрта выпал на случайную строку твоей кодовой базы и вскрыл гнильцу!\n"
          f"   Хватит сидеть сложа руки или надеяться, что тесты не заметят.\n"
          f"   Любая скрытая дыра, хардкод или слепой каст уничтожает архитектурную целостность!")
    print(f"\n{GREEN}{BOLD}💡 КАК ОБЯЗАН ИСПРАВИТЬ АГЕНТ:{RESET}\n   {fix_advice}")
    print(f"{RED}{'='*80}{RESET}\n")

def collect_all_cxx_lines(root: Path):
    file_lines = []
    scan_dirs = [root / "src", root / "data"]
    for s_dir in scan_dirs:
        if not s_dir.exists():
            continue
        for p in s_dir.rglob("*"):
            if p.suffix in ('.cpp', '.h', '.inl', '.csv'):
                try:
                    lines = p.read_text(encoding='utf-8', errors='replace').splitlines()
                    for idx, line in enumerate(lines, start=1):
                        file_lines.append((p, idx, lines))
                except Exception:
                    pass
    return file_lines

def run_dice_audit(root: Path, samples_count=175, seed=None, strict=False):
    rng = DiceRng(seed)
    print(f"{CYAN}[audit:dice]{RESET} Monte Carlo Reality Audit (Samples: {samples_count}, Seed: 0x{rng.initial_seed:08x})...")

    all_lines = collect_all_cxx_lines(root)
    if not all_lines:
        print(f"{RED}FAIL: No source lines found under {root}{RESET}")
        return 1

    total_pool = len(all_lines)
    print(f"{CYAN}[audit:dice]{RESET} Total universe of lines: {total_pool} lines.")

    failures = 0
    checked = 0

    # 3 ИНКВИЗИТОРСКИХ ВОПРОСА ТИМАЭРТА:
    # 1. Граничные случаи и деления без защиты
    # 2. Магические константы и слепые хардкоды
    # 3. Служебный подлог, обходы проверок, заглушки

    for _ in range(samples_count):
        idx = rng.randint(0, total_pool - 1)
        p, line_no, all_file_lines = all_lines[idx]
        checked += 1

        line_txt = all_file_lines[line_no - 1]
        stripped = line_txt.strip()

        # Пропускаем пустые строки и комментарии
        if not stripped or stripped.startswith("//") or stripped.startswith("*") or stripped.startswith("#"):
            continue
        if "giga-check: allow" in stripped:
            continue

        rel_path = p.relative_to(root)

        # Контекстное окно ±5 строк
        start_w = max(0, line_no - 6)
        end_w = min(len(all_file_lines), line_no + 5)
        context_window = [(i + 1, all_file_lines[i]) for i in range(start_w, end_w)]

        # Проверка 1: Опасное деление на ноль без guard-clause
        if re.search(r'/\s*([a-zA-Z0-9_]+)\b', stripped) and not re.search(r'//', stripped):
            denom = re.search(r'/\s*([a-zA-Z0-9_]+)\b', stripped).group(1)
            if denom not in ("2", "2.0f", "8", "64", "1000", "kWorldExtent", "kCellSize", "kVoxelSize", "sizeof"):
                # Проверим, есть ли guard clause выше в контексте
                has_guard = any(f"if ({denom}" in l[1] or f"if (!{denom}" in l[1] or f"{denom} > 0" in l[1] or f"{denom} !=" in l[1] for l in context_window)
                if not has_guard and f"{denom} == 0" not in stripped and strict:
                    print_dice_failure_manifesto(
                        str(rel_path), line_no, context_window,
                        "CANON S1 (Потенциальное деление на ноль)",
                        f"Обнаружено деление на переменную '{denom}' без явного guard-clause в локальном контексте.",
                        f"Обязательно добавь проверку: if ({denom} <= 0.0f) return ... или защиту от нуля."
                    )
                    failures += 1

        # Проверка 2: Забытые артефакты отладки и TODO
        if re.search(r'\b(TODO|FIXME|HACK|workaround)\b', stripped, re.IGNORECASE):
            print_dice_failure_manifesto(
                str(rel_path), line_no, context_window,
                "CANON S11 (Запрет заглушек и TODO)",
                f"Кубик попал в недоделанный участок кода с маркером: '{stripped}'.",
                "Ликвидируй заглушку, доведи алгоритм до 100% рабочего состояния по Первым Принципам."
            )
            failures += 1

        # Проверка 3: Слепые касты или any-аналоги
        if re.search(r'reinterpret_cast<void\*\>', stripped):
            print_dice_failure_manifesto(
                str(rel_path), line_no, context_window,
                "CANON S11 (Опасный бестиповой каст void*)",
                f"Обнаружен сырой каст в void*: '{stripped}'.",
                "Используй строго типизированные указатели или std::byte* с явной структурой."
            )
            failures += 1

    score = ((checked - failures) / checked) * 100.0 if checked > 0 else 100.0
    print(f"\n{BOLD}================================================================================{RESET}")
    print(f"{CYAN}[audit:dice]{RESET} Проверено {checked} точек среза реальности.")
    print(f"{CYAN}[audit:dice]{RESET} Рейтинг реальности: {GREEN if failures == 0 else RED}{score:.1f}% ({checked - failures}/{checked} точек чисты){RESET}")
    print(f"{BOLD}================================================================================{RESET}\n")

    if failures > 0 and strict:
        print(f"{RED}BLOCKED: Кубик Тимаэрта выявил {failures} архитектурных замечаний в режиме --strict.{RESET}")
        return 1

    print(f"{GREEN}✔ [DICE AUDIT]: Кубик Тимаэрта подтверждает высокую архитектурную чистоту (PASS).{RESET}")
    return 0

def main():
    root = Path(__file__).resolve().parent.parent
    samples = 100
    seed = None
    strict = False

    for arg in sys.argv[1:]:
        if arg.startswith("--samples="):
            samples = int(arg.split("=")[1])
        elif arg == "--samples" and len(sys.argv) > sys.argv.index(arg) + 1:
            samples = int(sys.argv[sys.argv.index(arg) + 1])
        elif arg.startswith("--seed="):
            seed = int(arg.split("=")[1], 0)
        elif arg == "--strict":
            strict = True

    rc = run_dice_audit(root, samples_count=samples, seed=seed, strict=strict)
    sys.exit(rc)

if __name__ == "__main__":
    main()
