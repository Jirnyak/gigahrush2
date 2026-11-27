#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GigaHrush 2 — Supreme Master Guard & Test Inquisitor (tools/run_all_guards.py)
Единый верховный заградительный рубеж и мастер-раннер проверок для агентов, субагентов и CI.
Конституция: .agents/THE_HAMMER_MASTER_PROMPT.md | Законы: CANON.md (S1..S28)

Кольца обороны:
 [Ring 0] Диффы и статический санитарный барьер (Diff Guard, Code Invariants, Agent Barrier)
 [Ring 1] Высшие законы ядра C++23 (Source Rules: No-throw, No-RTTI, No-GLM, CSV/Header Sync)
 [Ring 2] Целостность данных и памяти (Tables Freshness, CSV Columns, Row Law Layouts, Doc Refs)
 [Ring 3] Монотонный храповик качества (Quality Ratchet: Floors & Ceilings)
 [Ring 4] Стохастический аудит реальности и убийство мутантов (Dice Audit, Mutant Killer)
 [Ring 5] Нативные тесты CTest (world_test, barrier_test, code_contract_test, audit_test, game_test, e2e_test...)
"""

import sys
import os
import subprocess
import argparse
import time
from pathlib import Path

# ANSI colors for terminal diagnostics
RED = "\033[1;31m"
GREEN = "\033[1;32m"
YELLOW = "\033[1;33m"
CYAN = "\033[1;36m"
BOLD = "\033[1m"
DIM = "\033[2m"
MAGENTA = "\033[1;35m"
RESET = "\033[0m"

REPO_ROOT = Path(__file__).resolve().parent.parent

def find_cmake_build_dir(root: Path) -> Path:
    """Определяет актуальную директорию сборки CMake (build-win на Windows, build на macOS/Linux)."""
    candidates = [
        root / "build-win",
        root / "build",
        root / "build-release",
    ]
    for c in candidates:
        if (c / "CMakeCache.txt").exists():
            return c
    # Fallback на платформу
    if sys.platform == "win32":
        return root / "build-win"
    return root / "build"

def run_step(step_idx: int, total_steps: int, name: str, cmd: list, cwd: Path = REPO_ROOT) -> tuple[bool, str]:
    """Запускает шаг проверки, возвращает (успех, вывод)."""
    step_header = f"[{step_idx}/{total_steps}] {name}"
    cmd_str = " ".join(str(x) for x in cmd)
    print(f"{CYAN}{BOLD}{step_header}{RESET} {DIM}({cmd_str}){RESET} ...", end=" ", flush=True)

    t0 = time.time()
    try:
        proc = subprocess.run(
            cmd,
            cwd=cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace"
        )
        elapsed = time.time() - t0
        if proc.returncode == 0:
            print(f"{GREEN}{BOLD}PASS{RESET} {DIM}({elapsed:.2f}s){RESET}")
            return True, proc.stdout
        else:
            print(f"{RED}{BOLD}FAIL{RESET} {DIM}({elapsed:.2f}s){RESET}")
            return False, proc.stdout
    except FileNotFoundError as e:
        print(f"{RED}{BOLD}EXEC ERROR: {e}{RESET}")
        return False, str(e)
    except Exception as e:
        print(f"{RED}{BOLD}UNEXPECTED ERROR: {e}{RESET}")
        return False, str(e)

def print_failure_manifesto(name: str, cmd: list, output: str):
    """Выводит подробный русскоязычный манифест ошибки с точными инструкциями."""
    print(f"\n{RED}================================================================================{RESET}")
    print(f"{RED}🚨 ОСТАНОВКА! ЗАГРАДИТЕЛЬНЫЙ РУБЕЖ IRON GATE ОБНАРУЖИЛ СБОЙ: {name}{RESET}")
    print(f"{RED}================================================================================{RESET}")
    print(f"{BOLD}Команда:{RESET} {CYAN}{' '.join(str(c) for c in cmd)}{RESET}")
    print(f"{BOLD}Диагностический лог ошибки:{RESET}")
    print(f"{DIM}{'-' * 80}{RESET}")
    print(output.strip())
    print(f"{DIM}{'-' * 80}{RESET}")
    print(f"\n{BOLD}💡 ЧТО ОБЯЗАН СДЕЛАТЬ АГЕНТ ИЛИ РАЗРАБОТЧИК:{RESET}")
    print(f"  1. Прочитайте лог ошибки выше от первой до последней строки.")
    print(f"  2. НЕ пытайтесь обойти гейт, закомментировать проверку или подкрутить порог.")
    print(f"  3. Исправьте первопричину дефекта в боевом коде 'src/' или данных 'data/'.")
    print(f"  4. Перезапустите проверку: {CYAN}python tools/run_all_guards.py{RESET}")
    print(f"{RED}================================================================================{RESET}\n")

def main():
    parser = argparse.ArgumentParser(
        description="GigaHrush 2 Supreme Master Guard & Test Inquisitor",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--mode",
        choices=["pre-commit", "data", "cpu", "gpu", "full", "quick"],
        default="pre-commit",
        help="Режим проверки: pre-commit (быстрый статический контроль), data (проверка таблиц), cpu (все тесты кроме GPU), gpu (полный Vulkan/Compute прогон), full (абсолютно всё)."
    )
    parser.add_argument(
        "--staged",
        action="store_true",
        help="Проверять только staged-изменения git (для pre-commit хука)."
    )
    parser.add_argument(
        "--skip-ctest",
        action="store_true",
        help="Пропустить выполнение сьютов CTest (только статические стражи)."
    )
    parser.add_argument(
        "--samples",
        type=int,
        default=100,
        help="Число точек для Монте-Карло среза Кубика Тимаэрта (по умолчанию: 100)."
    )
    args = parser.parse_args()

    python_exe = sys.executable
    cmake_exe = "cmake"
    python_posix = Path(sys.executable).as_posix()
    build_dir = find_cmake_build_dir(REPO_ROOT)
    root_posix = REPO_ROOT.as_posix()
    build_dir_posix = build_dir.as_posix()

    print(f"{MAGENTA}{BOLD}================================================================================{RESET}")
    print(f"{MAGENTA}{BOLD}   🛡️  GIGAHRUSH 2 — IRON GATE SUPREME MASTER GUARD & TEST SUITE             {RESET}")
    print(f"{MAGENTA}{BOLD}================================================================================{RESET}")
    print(f"{BOLD}Корень репозитория:{RESET} {CYAN}{REPO_ROOT}{RESET}")
    print(f"{BOLD}Директория сборки:{RESET}  {CYAN}{build_dir}{RESET}")
    print(f"{BOLD}Режим инспекции:{RESET}    {YELLOW}{args.mode.upper()}{RESET}\n")

    steps = []

    # --------------------------------------------------------------------------
    # Ring 0: Статические инварианты, диффы и барьер агентов
    # --------------------------------------------------------------------------
    diff_cmd = [python_exe, str(REPO_ROOT / "tools" / "check_diff_guard.py")]
    if args.staged:
        diff_cmd.append("--staged")
    steps.append(("Diff Guard (Анти-Саботаж и контроль diff)", diff_cmd))

    steps.append((
        "Code Invariants (Архитектурные слои L1..L6, RFC 4180 CSV, sleep ban)",
        [python_exe, str(REPO_ROOT / "tools" / "check_code_invariants.py"), str(REPO_ROOT)]
    ))

    steps.append((
        "Agent Barrier (Запрет заглушек, пустых catch и фиктивных тестов)",
        [python_exe, str(REPO_ROOT / "tools" / "check_agent_barrier.py"), str(REPO_ROOT)]
    ))

    # --------------------------------------------------------------------------
    # Ring 1: Высшие законы ядра C++23 (CMake text gates)
    # --------------------------------------------------------------------------
    steps.append((
        "Source Rules (Запрет throw, RTTI, GLM/Eigen, синхронность CSV)",
        [cmake_exe, "-P", "tools/check_source_rules.cmake"]
    ))

    # --------------------------------------------------------------------------
    # Ring 2: Целостность данных и памяти (при режимах data, cpu, full)
    # --------------------------------------------------------------------------
    if args.mode in ("data", "cpu", "gpu", "full"):
        tmp_dir = (build_dir / "tables_fresh_tmp").resolve().as_posix()
        steps.append((
            "Tables Freshness (Побайтовая свежесть 16 генераторов CSV)",
            [cmake_exe, f"-DGIGA_ROOT={root_posix}", f"-DGIGA_PYTHON={python_posix}", f"-DGIGA_TMP={tmp_dir}", "-P", "tools/check_tables_fresh.cmake"]
        ))
        steps.append((
            "CSV Columns Coverage (Учёт и чтение всех объявленных колонок CSV)",
            [cmake_exe, f"-DGIGA_ROOT={root_posix}", "-P", "tools/check_csv_columns.cmake"]
        ))
        steps.append((
            "Row Law (Бинарные контуры POD-структур и выравнивание кэш-линий)",
            [cmake_exe, f"-DGIGA_ROOT={root_posix}", "-P", "tools/check_row_law.cmake"]
        ))
        steps.append((
            "Doc Refs (Сверка номеров строк документации и исходников)",
            [cmake_exe, f"-DGIGA_ROOT={root_posix}", "-P", "tools/check_doc_refs.cmake"]
        ))

    # --------------------------------------------------------------------------
    # Ring 3: Монотонный храповик качества
    # --------------------------------------------------------------------------
    steps.append((
        "Quality Ratchet (Монотонный пол тестов и потолок долга)",
        [python_exe, str(REPO_ROOT / "tools" / "quality_ratchet.py")]
    ))

    # --------------------------------------------------------------------------
    # Ring 4: Стохастический аудит Монте-Карло (Кубик Тимаэрта)
    # --------------------------------------------------------------------------
    steps.append((
        f"Dice Reality Audit (Кубик Тимаэрта — {args.samples} точек)",
        [python_exe, str(REPO_ROOT / "tools" / "dice_reality_audit.py"), f"--samples={args.samples}"]
    ))
    steps.append((
        "Inverted Mutant Killer (100% ликвидация мутантов с инвертированными условиями)",
        [python_exe, str(REPO_ROOT / "tools" / "dice_reality_audit.py"), "--mutant-killer"]
    ))

    # --------------------------------------------------------------------------
    # Ring 5: Нативные тесты CTest
    # --------------------------------------------------------------------------
    if not args.skip_ctest and args.mode in ("cpu", "gpu", "full"):
        if not build_dir.exists() or not (build_dir / "CTestTestfile.cmake").exists():
            print(f"{YELLOW}ПРЕДУПРЕЖДЕНИЕ: Директория сборки {build_dir} не содержит CTestTestfile.cmake. Пропуск CTest.{RESET}")
        else:
            ctest_cmd = ["ctest", "--test-dir", str(build_dir), "--output-on-failure"]
            if args.mode == "cpu":
                ctest_cmd.extend(["-E", "medium_test|verlet_test"])
            steps.append(("CTest Suite Execution (Сквозные тесты симуляции движка)", ctest_cmd))

    # Выполнение всех шагов
    total_steps = len(steps)
    failed_steps = []

    for idx, (name, cmd) in enumerate(steps, start=1):
        ok, out = run_step(idx, total_steps, name, cmd)
        if not ok:
            failed_steps.append((name, cmd, out))
            print_failure_manifesto(name, cmd, out)
            break

    print(f"\n{MAGENTA}{BOLD}================================================================================{RESET}")
    if failed_steps:
        print(f"{RED}{BOLD}❌ ПРОВЕРКА ПРОВАЛЕНА. {len(failed_steps)} гейт остановил выполнение.{RESET}")
        print(f"{RED}Любые коммиты, диффы и сдачи задач ЗАБЛОКИРОВАНЫ до устранения дефекта.{RESET}")
        print(f"{MAGENTA}{BOLD}================================================================================{RESET}")
        sys.exit(1)
    else:
        print(f"{GREEN}{BOLD}🎉 ВСЕ {total_steps} ЗАГРАДИТЕЛЬНЫХ ГЕЙТОВ И СЬЮТОВ ПРОЙДЕНЫ СО 100% УСПЕХОМ!{RESET}")
        print(f"{GREEN}Код, данные, контракты, диффы и тесты полностью соответствуют Конституции The Hammer.{RESET}")
        print(f"{MAGENTA}{BOLD}================================================================================{RESET}")
        sys.exit(0)

if __name__ == "__main__":
    main()
