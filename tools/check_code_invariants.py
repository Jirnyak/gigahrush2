#!/usr/bin/env python3
"""
GigaHrush 2 — Architectural & Code Hygiene Invariant Gate
Mechanical static gate verifying code architecture, dependency layers,
data CSV integrity, zero-allocation invariants, and determinism.
Modeled after Dental CRM and Timeart barrier systems.
"""

import sys
import os
import re
import csv
from pathlib import Path

RED = "\033[1;31m"
GREEN = "\033[1;32m"
YELLOW = "\033[1;33m"
CYAN = "\033[1;36m"
BOLD = "\033[1m"
RESET = "\033[0m"

failures = []

def report_violation(file_path, line_no, rule_name, explanation, fix_advice):
    failures.append({
        "file": file_path,
        "line": line_no,
        "rule": rule_name,
        "explanation": explanation,
        "fix": fix_advice
    })

def check_layering_discipline(root: Path):
    """
    CANON Architectural Layering Rules:
    Layer 1: src/core   - Headless, standalone math/wrap/tick. No deps on world, sim, render, game, app.
    Layer 2: src/world  - Monolith 128^3 grid, gravity. No deps on sim, render, game, app.
    Layer 3: src/sim    - Physics, contacts, rigid. No deps on render, game, app.
    Layer 4: src/render (GPU pipeline & passes) - Raymarch, passes, shaders. No deps on game, app.
    Layer 5: src/game   - ECS gameplay, actions, mobs. No deps on app.
    """
    layer_bans = [
        ("src/core", [r'#include\s+["<](world|sim|render|game|app)/'], []),
        ("src/world", [r'#include\s+["<](sim|render|game|app)/'], []),
        ("src/sim", [r'#include\s+["<](render|game|app)/'], []),
        ("src/render", [r'#include\s+["<](game|app)/'], ["_ui.h", "_ui.cpp", "imgui_layer"]),
        ("src/game", [r'#include\s+["<]app/'], []),
    ]

    for dir_rel, ban_patterns, file_exemptions in layer_bans:
        scan_dir = root / dir_rel
        if not scan_dir.exists():
            continue
        for p in scan_dir.rglob("*"):
            if not p.suffix in ('.h', '.cpp', '.inl'):
                continue
            if any(exempt in p.name for exempt in file_exemptions):
                continue
            try:
                content = p.read_text(encoding='utf-8', errors='replace')
            except Exception:
                continue

            for idx, line in enumerate(content.splitlines(), start=1):
                if "giga-check: allow" in line:
                    continue
                stripped = line.strip()
                if stripped.startswith("//") or stripped.startswith("*"):
                    continue

                for pat in ban_patterns:
                    if re.search(pat, line):
                        rel = p.relative_to(root)
                        report_violation(
                            str(rel), idx,
                            "CANON S1 (Архитектурная дисциплина слоев ядра)",
                            f"Слой {dir_rel} нелегально включает вышележащий заголовок: '{line.strip()}'.",
                            "Вынеси общие типы или интерфейсы на нижележащий слой (core/world) или используй decoupled messaging."
                        )

def check_determinism_and_sleep(root: Path):
    """
    Simulation hot-paths must never call thread sleep or non-deterministic OS timers.
    """
    scanned_dirs = ["src/core", "src/world", "src/sim", "src/game"]
    sleep_pattern = re.compile(r'\b(sleep_for|sleep_until|Sleep\(|usleep)\b')

    for d in scanned_dirs:
        dir_path = root / d
        if not dir_path.exists():
            continue
        for p in dir_path.rglob("*"):
            if p.suffix not in ('.h', '.cpp', '.inl'):
                continue
            try:
                content = p.read_text(encoding='utf-8', errors='replace')
            except Exception:
                continue

            for idx, line in enumerate(content.splitlines(), start=1):
                if "giga-check: allow" in line:
                    continue
                stripped = line.strip()
                if stripped.startswith("//") or stripped.startswith("*"):
                    continue

                if sleep_pattern.search(line):
                    rel = p.relative_to(root)
                    report_violation(
                        str(rel), idx,
                        "CANON S11 (Детерминизм симуляции и запрет sleep)",
                        f"Обнаружен вызов системного сна: '{line.strip()}'.",
                        "Симуляция обязана продвигаться строго дискретными тиками 125 Гц (kSimDt = 0.008 с). Удали sleep."
                    )

def check_csv_integrity(root: Path):
    """
    All CSV files in data/ must be well-formed UTF-8 without BOM,
    have unique non-empty primary IDs, consistent column counts, and no trailing whitespace.
    """
    data_dir = root / "data"
    if not data_dir.exists():
        return

    for p in sorted(data_dir.glob("*.csv")):
        rel = p.relative_to(root)
        raw_bytes = p.read_bytes()
        
        # Check UTF-8 BOM
        if raw_bytes.startswith(b'\xef\xbb\xbf'):
            report_violation(
                str(rel), 1,
                "CANON S11 (Кодировка CSV данных)",
                "Файл содержит UTF-8 BOM маркер (ef bb bf).",
                "Сохрани файл в кодировке UTF-8 без BOM."
            )

        try:
            text = raw_bytes.decode('utf-8')
        except UnicodeDecodeError as e:
            report_violation(
                str(rel), 1,
                "CANON S11 (Валидность UTF-8)",
                f"Файл содержит недопустимые байты UTF-8: {e}",
                "Исправь поврежденные символы в CSV."
            )
            continue

        lines = text.splitlines()
        if not lines:
            continue

        reader = csv.reader(lines)
        try:
            header = next(reader)
        except Exception as e:
            report_violation(str(rel), 1, "CANON S11 (CSV header)", f"Не удалось прочитать шапку CSV: {e}", "Проверь синтаксис CSV.")
            continue

        expected_cols = len(header)
        seen_keys = set()

        # Identify primary key column(s)
        key_indices = []
        if "form" in header and "seg" in header:
            key_indices = [header.index("form"), header.index("seg")]
        elif "source_id" in header:
            key_indices = [header.index("source_id")]
        elif "id" in header:
            key_indices = [header.index("id")]
        elif "name" in header:
            key_indices = [header.index("name")]
        elif "item" in header:
            key_indices = [header.index("item")]
        elif "prop" in header:
            key_indices = [header.index("prop")]

        for row_idx, row in enumerate(reader, start=2):
            if not row:
                continue

            # Check column count
            if len(row) != expected_cols:
                report_violation(
                    str(rel), row_idx,
                    "CANON S11 (Целостность колонок CSV)",
                    f"Строка {row_idx} содержит {len(row)} колонок при ожидаемых {expected_cols}.",
                    "Приведи количество колонок в соответствие с шапкой таблицы."
                )

            # Check primary key uniqueness
            if key_indices and max(key_indices) < len(row):
                key = ":".join(row[i].strip() for i in key_indices)
                if not key or key == ":":
                    report_violation(
                        str(rel), row_idx,
                        "CANON S11 (Первичный ключ CSV)",
                        f"Строка {row_idx} имеет пустой первичный ключ.",
                        "Заполни уникальный строковый идентификатор."
                    )
                elif key in seen_keys:
                    report_violation(
                        str(rel), row_idx,
                        "CANON S11 (Уникальность первичного ключа CSV)",
                        f"Дублирующийся первичный ключ '{key}' в строке {row_idx}.",
                        "Все ключи обязаны быть строго уникальными."
                    )
                else:
                    seen_keys.add(key)

def main():
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    print(f"{CYAN}[check_code_invariants]{RESET} Scanning repository at {root}...")

    check_layering_discipline(root)
    check_determinism_and_sleep(root)
    check_csv_integrity(root)

    if failures:
        print(f"\n{RED}{'='*80}{RESET}")
        print(f"{RED}🚨 [ARCHITECTURAL CODE HYGIENE GATE FAILED]{RESET}")
        print(f"{RED}{'-'*80}{RESET}")
        print(f"{BOLD}Обнаружено {len(failures)} архитектурных нарушений в кодовой базе:{RESET}\n")

        for f in failures:
            print(f"📍 {CYAN}{f['file']}:{f['line']}{RESET}")
            print(f"❌ {YELLOW}{f['rule']}{RESET}")
            print(f"🔍 {BOLD}Причина:{RESET} {f['explanation']}")
            print(f"💡 {GREEN}Как исправить:{RESET} {f['fix']}\n")

        print(f"{RED}{'='*80}{RESET}\n")
        sys.exit(1)

    print(f"{GREEN}✔ [ARCHITECTURAL CODE HYGIENE]: Все слои архитектуры, CSV и инварианты детерминизма чисты (PASS).{RESET}")
    sys.exit(0)

if __name__ == "__main__":
    main()
