#!/usr/bin/env python3
"""
GigaHrush 2 — Monotonic Quality Ratchet & Test Floor Gate
Mechanical anti-regression ratchet preventing defect growth and test deletion.
Modeled after Dental CRM & Timeart Zero-Trust Quality Ratchet doctrine.
"""

import sys
import os
import re
import json
import subprocess
from pathlib import Path

RED = "\033[1;31m"
GREEN = "\033[1;32m"
YELLOW = "\033[1;33m"
CYAN = "\033[1;36m"
BOLD = "\033[1m"
RESET = "\033[0m"

DEFAULT_BASELINE_REL = ".data/quality-ratchet-baseline.json"

def get_git_head_file(repo_root: Path, file_rel: str) -> str:
    try:
        cmd = ["git", "show", f"HEAD:{file_rel}"]
        res = subprocess.run(cmd, cwd=repo_root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        return res.stdout
    except Exception:
        return ""

def scan_repository_metrics(repo_root: Path):
    """
    Сканирует ключевые метрики кодовой базы:
    - prod_files: число файлов в src/
    - test_files: число файлов в tests/
    - total_assertions: число проверок в тестах (CHECK, BARRIER_CHECK, static_assert)
    - banned_stubs: число маркеров заглушек (TODO, FIXME, hack)
    - raw_casts: число опасных reinterpret_cast<void*>
    """
    src_dir = repo_root / "src"
    tests_dir = repo_root / "tests"

    prod_files = 0
    test_files = 0
    total_assertions = 0
    banned_stubs = 0
    raw_casts = 0

    # Сканирование боевого кода
    if src_dir.exists():
        for p in src_dir.rglob("*"):
            if p.suffix in ('.cpp', '.h', '.inl'):
                prod_files += 1
                try:
                    content = p.read_text(encoding='utf-8', errors='replace')
                    for line in content.splitlines():
                        s = line.strip()
                        if s.startswith("//") or s.startswith("*"):
                            continue
                        if re.search(r'\b(TODO|FIXME|HACK|workaround)\b', s, re.IGNORECASE):
                            banned_stubs += 1
                        if "reinterpret_cast<void*>" in s or "(void*)" in s:
                            raw_casts += 1
                except Exception:
                    pass

    # Сканирование тестов
    if tests_dir.exists():
        for p in tests_dir.rglob("*"):
            if p.suffix in ('.cpp', '.h', '.inl'):
                test_files += 1
                try:
                    content = p.read_text(encoding='utf-8', errors='replace')
                    for line in content.splitlines():
                        s = line.strip()
                        if s.startswith("//"):
                            continue
                        if re.search(r'\b(BARRIER_CHECK|CHECK|assert|static_assert)\s*\(', s):
                            total_assertions += 1
                except Exception:
                    pass

    return {
        "prod_files": prod_files,
        "test_files": test_files,
        "total_assertions": total_assertions,
        "banned_stubs": banned_stubs,
        "raw_casts": raw_casts
    }

def print_ratchet_failure_manifesto(metric_name, current_val, baseline_val, is_floor=True):
    print(f"\n{RED}{'='*80}{RESET}")
    print(f"{RED}🚨 [QUALITY RATCHET VIOLATION — СРАБОТАЛ ХРАПОВИК КАЧЕСТВА]{RESET}")
    print(f"{RED}{'-'*80}{RESET}")
    print(f"{BOLD}❌ МЕТРИКА РЕГРЕССИИ:{RESET} {YELLOW}{metric_name}{RESET}")
    print(f"{BOLD}📊 ТЕКУЩЕЕ ЗНАЧЕНИЕ:{RESET} {RED}{current_val}{RESET}")
    print(f"{BOLD}🛡️ ПОТОЛОК / ПОЛ ХРАПОВИКА:{RESET} {GREEN}{baseline_val}{RESET}\n")

    if is_floor:
        print(f"{BOLD}⚠️ В ЧЁМ СУТЬ САБОТАЖА (УДАЛЕНИЕ ТЕСТОВ):{RESET}\n"
              f"   Значение метрики {metric_name} упало ниже зафиксированного пола ({current_val} < {baseline_val})!\n"
              f"   Агент попытался удалить тестовые файлы или вырезать ассерты ради создания иллюзии зеленого статуса.")
        print(f"\n{RED}{BOLD}🛑 ПРОПИЗДОН АГЕНТУ:{RESET}\n"
              f"   ХРАПОВИК НЕ ДАЕТ ХОДА НАЗАД! Тесты удалять КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО!\n"
              f"   Если ты сломал тест — чини боевой код, а не удаляй проверки!")
        print(f"\n{GREEN}{BOLD}💡 КАК ОБЯЗАН ИСПРАВИТЬ АГЕНТ:{RESET}\n"
              f"   1. Восстанови удаленные тесты: git checkout HEAD -- tests/\n"
              f"   2. Исправь дефект в src/, чтобы все тесты проходили честно.\n"
              f"   3. Запусти повторно: python tools/quality_ratchet.py\n")
    else:
        print(f"{BOLD}⚠️ В ЧЁМ СУТЬ РЕГРЕССИИ (РОСТ ДЕФЕКТОВ):{RESET}\n"
              f"   Значение метрики {metric_name} превысило санитарный потолок ({current_val} > {baseline_val})!\n"
              f"   В кодовую базу были внесены новые костыли, заглушки или опасные касты.")
        print(f"\n{RED}{BOLD}🛑 ПРОПИЗДОН АГЕНТУ:{RESET}\n"
              f"   Храповик качества затягивается только в сторону уменьшения дефектов!\n"
              f"   Любой рост технического долга блокирует коммит.")
        print(f"\n{GREEN}{BOLD}💡 КАК ОБЯЗАН ИСПРАВИТЬ АГЕНТ:{RESET}\n"
              f"   1. Удали внесенные костыли и заглушки.\n"
              f"   2. Реализуй функционал строго по Первым Принципам без TODO.\n"
              f"   3. Запусти повторно: python tools/quality_ratchet.py\n")
    print(f"{RED}{'='*80}{RESET}\n")

def main():
    repo_root = Path(__file__).resolve().parent.parent
    baseline_path = repo_root / DEFAULT_BASELINE_REL

    print(f"{CYAN}[quality_ratchet]{RESET} Scanning codebase metrics at {repo_root}...")
    current = scan_repository_metrics(repo_root)

    print(f"{BOLD}--------------------------------------------------{RESET}")
    print(f"  Боевых файлов (src/):         {CYAN}{current['prod_files']}{RESET}")
    print(f"  Тестовых файлов (tests/):     {CYAN}{current['test_files']}{RESET}")
    print(f"  Всего проверок (assertions):  {CYAN}{current['total_assertions']}{RESET}")
    print(f"  Костылей и TODO:              {YELLOW if current['banned_stubs'] > 0 else GREEN}{current['banned_stubs']}{RESET}")
    print(f"  Опасных кастов (void*):       {YELLOW if current['raw_casts'] > 0 else GREEN}{current['raw_casts']}{RESET}")
    print(f"{BOLD}--------------------------------------------------{RESET}")

    # Если файла бейслайна нет — создаем его
    if not baseline_path.exists():
        baseline_path.parent.mkdir(parents=True, exist_ok=True)
        baseline_path.write_text(json.dumps(current, indent=2, ensure_ascii=False) + "\n", encoding='utf-8')
        print(f"{GREEN}✔ [QUALITY RATCHET]: Инициализирован базовый паспорт качества ({baseline_path}).{RESET}")
        sys.exit(0)

    try:
        baseline = json.loads(baseline_path.read_text(encoding='utf-8'))
    except Exception as e:
        print(f"{RED}FAIL: Ошибка чтения {baseline_path}: {e}{RESET}")
        sys.exit(1)

    # Проверка анти-манипуляции (Anti-Gaming Rule №1):
    # Лимит в рабочем дереве не может быть слабее, чем в git HEAD!
    head_json_str = get_git_head_file(repo_root, DEFAULT_BASELINE_REL)
    if head_json_str:
        try:
            head_baseline = json.loads(head_json_str)
            # Полы тестов в baseline не могут быть ниже HEAD
            for floor_key in ["prod_files", "test_files", "total_assertions"]:
                if baseline.get(floor_key, 0) < head_baseline.get(floor_key, 0):
                    print_ratchet_failure_manifesto(
                        f"Попытка занизить пол {floor_key} в бейслайне относительно git HEAD!",
                        baseline.get(floor_key, 0), head_baseline.get(floor_key, 0), is_floor=True
                    )
                    sys.exit(1)
            # Потолки дефектов в baseline не могут быть выше HEAD
            for ceil_key in ["banned_stubs", "raw_casts"]:
                if baseline.get(ceil_key, 0) > head_baseline.get(ceil_key, 0):
                    print_ratchet_failure_manifesto(
                        f"Попытка завысить потолок дефектов {ceil_key} в бейслайне относительно git HEAD!",
                        baseline.get(ceil_key, 0), head_baseline.get(ceil_key, 0), is_floor=False
                    )
                    sys.exit(1)
        except Exception:
            pass

    # Проверка текущих метрик относительно храповика
    violations = 0

    # Полы (значение не может падать)
    for floor_key in ["test_files", "total_assertions"]:
        base_val = baseline.get(floor_key, 0)
        curr_val = current.get(floor_key, 0)
        if curr_val < base_val:
            print_ratchet_failure_manifesto(floor_key, curr_val, base_val, is_floor=True)
            violations += 1

    # Потолки (значение не может расти)
    for ceil_key in ["banned_stubs", "raw_casts"]:
        base_val = baseline.get(ceil_key, 0)
        curr_val = current.get(ceil_key, 0)
        if curr_val > base_val:
            print_ratchet_failure_manifesto(ceil_key, curr_val, base_val, is_floor=False)
            violations += 1

    if violations > 0:
        print(f"{RED}BLOCKED: Храповик качества зафиксировал {violations} нарушений. Коммит отклонен.{RESET}\n")
        sys.exit(1)

    # Автоматическое затягивание храповика (Monotonic Tightening)
    tightened = False
    new_baseline = dict(baseline)

    # Если выросло число проверок — поднимаем пол!
    if current["total_assertions"] > baseline.get("total_assertions", 0):
        new_baseline["total_assertions"] = current["total_assertions"]
        tightened = True
    if current["test_files"] > baseline.get("test_files", 0):
        new_baseline["test_files"] = current["test_files"]
        tightened = True

    # Если уменьшились дефекты — опускаем потолок!
    if current["banned_stubs"] < baseline.get("banned_stubs", 9999):
        new_baseline["banned_stubs"] = current["banned_stubs"]
        tightened = True
    if current["raw_casts"] < baseline.get("raw_casts", 9999):
        new_baseline["raw_casts"] = current["raw_casts"]
        tightened = True

    if tightened:
        baseline_path.write_text(json.dumps(new_baseline, indent=2, ensure_ascii=False) + "\n", encoding='utf-8')
        print(f"{GREEN}🔒 [QUALITY RATCHET TIGHTENED]: Храповик качества затянулся на новых достижениях!{RESET}")
    else:
        print(f"{GREEN}✔ [QUALITY RATCHET]: Все метрики в пределах санитарных норм храповика (PASS).{RESET}")

    sys.exit(0)

if __name__ == "__main__":
    main()
