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
import argparse
import subprocess
from pathlib import Path

RED = "\033[1;31m"
GREEN = "\033[1;32m"
YELLOW = "\033[1;33m"
CYAN = "\033[1;36m"
BOLD = "\033[1m"
RESET = "\033[0m"

DEFAULT_BASELINE_REL = ".data/quality-ratchet-baseline.json"

def get_git_head_file(repo_root: Path, file_rel: str) -> str | None:
    try:
        inside = subprocess.run(
            ["git", "rev-parse", "--is-inside-work-tree"],
            cwd=repo_root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
        )
    except OSError as e:
        print(f"{RED}FAIL: Не удалось запустить git для проверки HEAD: {e}{RESET}", file=sys.stderr)
        sys.exit(1)

    if inside.returncode != 0 or inside.stdout.strip() != "true":
        err = inside.stderr.strip() or inside.stdout.strip() or "не является git-репозиторием"
        print(f"{RED}FAIL: Поломка git (rev-parse --is-inside-work-tree): {err}{RESET}", file=sys.stderr)
        sys.exit(1)

    sym = subprocess.run(
        ["git", "symbolic-ref", "-q", "HEAD"],
        cwd=repo_root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
    )
    is_detached = (sym.returncode != 0)

    head_check = subprocess.run(
        ["git", "rev-parse", "--verify", "HEAD"],
        cwd=repo_root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
    )
    if head_check.returncode != 0:
        err = head_check.stderr.strip() or "HEAD не разрешается"
        if not is_detached:
            print(f"{RED}FAIL: Поломка git (не удалось прочитать HEAD): {err}{RESET}", file=sys.stderr)
            sys.exit(1)
        print(f"{YELLOW}[quality_ratchet] Предупреждение: detached HEAD не разрешён ({err}).{RESET}", file=sys.stderr)
        return None

    res = subprocess.run(
        ["git", "show", f"HEAD:{file_rel}"],
        cwd=repo_root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
    )
    if res.returncode == 0:
        return res.stdout

    err = res.stderr.strip()
    if "does not exist in 'HEAD'" in err or "exists on disk, but not in 'HEAD'" in err:
        return None

    print(f"{RED}FAIL: Ошибка чтения {file_rel} из git HEAD: {err}{RESET}", file=sys.stderr)
    sys.exit(1)

def scan_repository_metrics(repo_root: Path):
    """
    Сканирует ключевые метрики кодовой базы:
    - prod_files: число файлов в src/
    - test_files: число файлов в tests/
    - total_assertions: число проверок в тестах (CHECK, BARRIER_CHECK, static_assert)
    - banned_stubs: число маркеров заглушек (TODO, FIXME, HACK, workaround)
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
                except OSError as e:
                    print(f"{RED}FAIL: Не удалось прочитать {p}: {e}{RESET}", file=sys.stderr)
                    sys.exit(1)
                for line in content.splitlines():
                    s = line.strip()
                    if re.search(r'\b(TODO|FIXME|HACK)\b', s, re.IGNORECASE):
                        banned_stubs += 1
                    if s.startswith("//") or s.startswith("*"):
                        continue
                    if re.search(r'\bworkaround\b', s, re.IGNORECASE):
                        banned_stubs += 1
                    if "reinterpret_cast<void*>" in s or "(void*)" in s:
                        raw_casts += 1

    # Сканирование тестов
    if tests_dir.exists():
        for p in tests_dir.rglob("*"):
            if p.suffix in ('.cpp', '.h', '.inl'):
                test_files += 1
                try:
                    content = p.read_text(encoding='utf-8', errors='replace')
                except OSError as e:
                    print(f"{RED}FAIL: Не удалось прочитать {p}: {e}{RESET}", file=sys.stderr)
                    sys.exit(1)
                for line in content.splitlines():
                    s = line.strip()
                    if s.startswith("//"):
                        continue
                    if re.search(r'\b(BARRIER_CHECK|CHECK|assert|static_assert)\s*\(', s):
                        total_assertions += 1

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
        print(f"{BOLD}⚠️ В ЧЁМ СУТЬ САБОТАЖА (ОТКАТ ПОЛА / УДАЛЕНИЕ КОДА И ТЕСТОВ):{RESET}\n"
              f"   Значение метрики {metric_name} упало ниже зафиксированного пола ({current_val} < {baseline_val})!\n"
              f"   Агент попытался удалить боевые/тестовые файлы или вырезать ассерты ради создания иллюзии зеленого статуса.")
        print(f"\n{RED}{BOLD}🛑 ПРОПИЗДОН АГЕНТУ:{RESET}\n"
              f"   ХРАПОВИК НЕ ДАЕТ ХОДА НАЗАД! Снижать полы {metric_name} КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО!\n"
              f"   Если ты сломал тест — чини боевой код, а не удаляй проверки!")
        print(f"\n{GREEN}{BOLD}💡 КАК ОБЯЗАН ИСПРАВИТЬ АГЕНТ:{RESET}\n"
              f"   1. Восстанови удаленные файлы/тесты: git checkout HEAD -- src/ tests/\n"
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
    parser = argparse.ArgumentParser(description="GigaHrush 2 Monotonic Quality Ratchet & Test Floor Gate")
    parser.add_argument(
        "--update-baseline",
        action="store_true",
        help="Явно обновить .data/quality-ratchet-baseline.json при затягивании храповика или инициализации."
    )
    args = parser.parse_args()

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

    # Если файла бейслайна нет — создаем ТОЛЬКО при --update-baseline
    if not baseline_path.exists():
        if not args.update_baseline:
            print(f"{RED}FAIL: Отсутствует файл бейслайна {baseline_path}. Read-only прогон не создаёт его автоматически; запусти с --update-baseline.{RESET}", file=sys.stderr)
            sys.exit(1)
        baseline_path.parent.mkdir(parents=True, exist_ok=True)
        baseline_path.write_text(json.dumps(current, indent=2, ensure_ascii=False) + "\n", encoding='utf-8')
        print(f"{GREEN}✔ [QUALITY RATCHET]: Инициализирован базовый паспорт качества ({baseline_path}).{RESET}")
        sys.exit(0)

    try:
        baseline = json.loads(baseline_path.read_text(encoding='utf-8'))
    except Exception as e:
        print(f"{RED}FAIL: Ошибка чтения {baseline_path}: {e}{RESET}", file=sys.stderr)
        sys.exit(1)

    # Проверка анти-манипуляции (Anti-Gaming Rule №1):
    # Лимит в рабочем дереве не может быть слабее, чем в git HEAD!
    head_json_str = get_git_head_file(repo_root, DEFAULT_BASELINE_REL)
    if head_json_str is not None:
        try:
            head_baseline = json.loads(head_json_str)
        except json.JSONDecodeError as e:
            print(f"{RED}FAIL: Некорректный JSON в git HEAD:{DEFAULT_BASELINE_REL}: {e}{RESET}", file=sys.stderr)
            sys.exit(1)

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

    # Проверка текущих метрик относительно храповика
    violations = 0

    # Полы (значение не может падать)
    for floor_key in ["test_files", "total_assertions", "prod_files"]:
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

    # Монотонное затягивание храповика (Monotonic Tightening)
    tightened_fields = []
    new_baseline = dict(baseline)

    for floor_key in ["prod_files", "test_files", "total_assertions"]:
        if current[floor_key] > baseline.get(floor_key, 0):
            new_baseline[floor_key] = current[floor_key]
            tightened_fields.append(f"{floor_key}: {baseline.get(floor_key, 0)} -> {current[floor_key]}")

    for ceil_key in ["banned_stubs", "raw_casts"]:
        if current[ceil_key] < baseline.get(ceil_key, 9999):
            new_baseline[ceil_key] = current[ceil_key]
            tightened_fields.append(f"{ceil_key}: {baseline.get(ceil_key, 9999)} -> {current[ceil_key]}")

    if tightened_fields:
        summary = ", ".join(tightened_fields)
        if args.update_baseline:
            baseline_path.write_text(json.dumps(new_baseline, indent=2, ensure_ascii=False) + "\n", encoding='utf-8')
            print(f"{GREEN}🔒 [QUALITY RATCHET TIGHTENED]: Храповик качества затянулся ({summary})!{RESET}")
        else:
            print(f"{GREEN}✔ [QUALITY RATCHET]: Все метрики в пределах санитарных норм храповика (PASS).{RESET}")
            print(f"{CYAN}ℹ Доступно затягивание храповика ({summary}); запусти с --update-baseline для записи.{RESET}")
    else:
        print(f"{GREEN}✔ [QUALITY RATCHET]: Все метрики в пределах санитарных норм храповика (PASS).{RESET}")

    sys.exit(0)

if __name__ == "__main__":
    main()
