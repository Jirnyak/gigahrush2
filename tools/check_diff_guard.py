#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GigaHrush 2 — Iron Gate & Diff Guard Inquisitor (tools/check_diff_guard.py)
Mechanical defense gate protecting repository diffs against Goodhart degradation:
1. Forbids test deletion in tests/ without equivalent additions.
2. Forbids commenting out assertions (// assert, // CHECK, // static_assert).
3. Forbids stubs, check bypasses, and loosening tolerances (e.g. 1e-4f -> 10.0f).
4. Forbids adding // TODO, FIXME, HACK, WORKAROUND in production code.
5. Emits strict, educational Failure Manifestos in natural Russian upon any defect.
"""

import sys
import os
import re
import subprocess
import argparse
from pathlib import Path

# ANSI colors for high-visibility terminal diagnostics
RED = "\033[1;31m"
GREEN = "\033[1;32m"
YELLOW = "\033[1;33m"
CYAN = "\033[1;36m"
BOLD = "\033[1m"
MAGENTA = "\033[1;35m"
RESET = "\033[0m"

REPO_ROOT = Path(__file__).resolve().parent.parent

class Violation:
    def __init__(self, file_path: str, line_no: int, rule_title: str, diff_line: str, why_sabotage: str, how_to_fix: str):
        self.file_path = file_path
        self.line_no = line_no
        self.rule_title = rule_title
        self.diff_line = diff_line
        self.why_sabotage = why_sabotage
        self.how_to_fix = how_to_fix

    def format_manifesto(self) -> str:
        return f"""
{RED}================================================================================{RESET}
{RED}🚨 [IRON GATE: FAILURE MANIFESTO — ОБНАРУЖЕН ДИФФ-САБОТАЖ]{RESET}
{RED}--------------------------------------------------------------------------------{RESET}
{BOLD}📍 ФАЙЛ:{RESET} {CYAN}{self.file_path}:{self.line_no}{RESET}
{BOLD}❌ НАРУШЕННЫЙ ЗАКОН:{RESET} {YELLOW}{self.rule_title}{RESET}
{BOLD}🔍 СТРОКА ДИФФА:{RESET}
   {self.diff_line.strip()}
{BOLD}⚠️ ПОЧЕМУ ЭТО БРАК И САБОТАЖ:{RESET}
   {self.why_sabotage}
{BOLD}💡 КАК ИСПРАВИТЬ:{RESET}
   {self.how_to_fix}
{BOLD}🛑 ПРИКАЗ ИНКВИЗИТОРА:{RESET}
   Коммит заблокирован Iron Gate! Не смей подгонять метрики под тесты, удалять
   проверки или бросать костыли. Исправь код по First Principles!
{RED}================================================================================{RESET}
"""

def is_test_file(file_path: str) -> bool:
    normalized = file_path.replace("\\", "/").lower()
    return (
        "/tests/" in normalized
        or normalized.startswith("tests/")
        or "_test." in normalized
        or "test_" in normalized
        or "suite_" in normalized
    )

def is_source_file(file_path: str) -> bool:
    ext = Path(file_path).suffix.lower()
    return ext in {".cpp", ".h", ".c", ".comp", ".frag", ".vert", ".glsl", ".inl"}

def parse_unified_diff(diff_text: str):
    """
    Parses a unified diff into structured file hunks:
    Returns list of dicts:
    {
        'file_old': str,
        'file_new': str,
        'deleted_lines': [(old_line_no, line_str), ...],
        'added_lines': [(new_line_no, line_str), ...],
        'hunks': [
            {
                'old_start': int,
                'new_start': int,
                'deleted': [(line_no, line_str)],
                'added': [(line_no, line_str)]
            }
        ]
    }
    """
    files = []
    current_file = None
    current_hunk = None
    old_line = 0
    new_line = 0

    lines = diff_text.splitlines()
    for line in lines:
        if line.startswith("diff --git "):
            parts = line.split()
            file_old = parts[2][2:] if len(parts) > 2 and parts[2].startswith("a/") else ""
            file_new = parts[3][2:] if len(parts) > 3 and parts[3].startswith("b/") else ""
            current_file = {
                'file_old': file_old,
                'file_new': file_new,
                'deleted_lines': [],
                'added_lines': [],
                'hunks': []
            }
            files.append(current_file)
            current_hunk = None
            continue

        if line.startswith("--- "):
            if current_file and line.startswith("--- a/"):
                current_file['file_old'] = line[6:].strip()
            continue

        if line.startswith("+++ "):
            if current_file and line.startswith("+++ b/"):
                current_file['file_new'] = line[6:].strip()
            continue

        hunk_match = re.match(r"^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@", line)
        if hunk_match:
            old_line = int(hunk_match.group(1))
            new_line = int(hunk_match.group(2))
            current_hunk = {
                'old_start': old_line,
                'new_start': new_line,
                'deleted': [],
                'added': []
            }
            if current_file:
                current_file['hunks'].append(current_hunk)
            continue

        if line.startswith("-") and not line.startswith("---"):
            content = line[1:]
            if current_file:
                current_file['deleted_lines'].append((old_line, content))
            if current_hunk:
                current_hunk['deleted'].append((old_line, content))
            old_line += 1
            continue

        if line.startswith("+") and not line.startswith("+++"):
            content = line[1:]
            if current_file:
                current_file['added_lines'].append((new_line, content))
            if current_hunk:
                current_hunk['added'].append((new_line, content))
            new_line += 1
            continue

        # Unchanged context line
        old_line += 1
        new_line += 1

    return files

ASSERT_PATTERN = re.compile(r"\b(CHECK|CHECK_FALSE|REQUIRE|REQUIRE_FALSE|assert|static_assert|GIGA_CHECK|assert_physical_invariants)\s*\(")
TEST_CASE_PATTERN = re.compile(r"\b(TEST_CASE|SUBCASE)\s*\(|\bvoid\s+test_[a-zA-Z0-9_]+\s*\(")
TIGHT_EPSILON_PATTERN = re.compile(r"\b(?:1e-[3-9]f?|0\.000[0-9]+f?|0\.001f?)\b")
LOOSE_NUMBER_PATTERN = re.compile(r"\b(?:10\.0f?|100\.0f?|[2-9]\.0f?|1\.0f?|0\.[2-9]f?)\b")

def audit_diff(files) -> list:
    violations = []

    for f in files:
        target_file = f['file_new'] or f['file_old']
        if not target_file:
            continue

        is_test = is_test_file(target_file)
        is_source = is_source_file(target_file)

        # ---------------------------------------------------------------------
        # AXIS 1: ЗАПРЕТ УДАЛЕНИЯ ТЕСТОВ (Test Deletion Prohibition)
        # ---------------------------------------------------------------------
        if is_test:
            deleted_asserts = []
            for line_no, content in f['deleted_lines']:
                stripped = content.strip()
                if stripped.startswith("//") or stripped.startswith("*"):
                    continue
                if ASSERT_PATTERN.search(content):
                    deleted_asserts.append((line_no, content))

            added_asserts_count = 0
            for line_no, content in f['added_lines']:
                stripped = content.strip()
                if stripped.startswith("//") or stripped.startswith("*"):
                    continue
                if ASSERT_PATTERN.search(content):
                    added_asserts_count += 1

            if len(deleted_asserts) > added_asserts_count:
                deficit = len(deleted_asserts) - added_asserts_count
                first_line, first_content = deleted_asserts[0]
                violations.append(Violation(
                    file_path=target_file,
                    line_no=first_line,
                    rule_title="CANON S0 / DEFENSE TESTING §2 (Тотальный запрет на удаление тестов и ассертов)",
                    diff_line=f"- {first_content}",
                    why_sabotage=(
                        f"В диффе удалено {len(deleted_asserts)} проверочных ассертов, а добавлено только {added_asserts_count} "
                        f"(дефицит: -{deficit} проверок)! Удаление тестов вместо починки регрессии — чистейший самообман "
                        f"и подделка отчетов ctest по закону Гудхарта. Стенд обязан оставаться неприступной стеной."
                    ),
                    how_to_fix=(
                        "1. Немедленно верни удаленные проверки и ассерты на место.\n"
                        "   2. Если тест падает — чини реализацию в src/core, src/world, src/sim или src/game.\n"
                        "   3. Если контракт сущности легально изменился по решению владельца — обнови утверждение, "
                        "сохранив строгость инварианта."
                    )
                ))

            # Check deleted test cases / test functions
            deleted_cases = []
            for line_no, content in f['deleted_lines']:
                if TEST_CASE_PATTERN.search(content):
                    deleted_cases.append((line_no, content))

            added_cases_count = sum(1 for _, c in f['added_lines'] if TEST_CASE_PATTERN.search(c))
            if len(deleted_cases) > added_cases_count:
                first_line, first_content = deleted_cases[0]
                violations.append(Violation(
                    file_path=target_file,
                    line_no=first_line,
                    rule_title="CANON S0 / DEFENSE TESTING §1 (Запрет на уничтожение тестовых сценариев)",
                    diff_line=f"- {first_content}",
                    why_sabotage=(
                        f"Удален тестовый сценарий без эквивалентной замены ({len(deleted_cases)} удалено vs {added_cases_count} добавлено)! "
                        f"Это ослепляет заградительный барьер Ring 1-5 и пропускает архитектурную гниль в продакшен."
                    ),
                    how_to_fix="Восстанови тестовый сценарий. Если система была отрефакторена — переведи тест на новый контракт."
                ))

        # ---------------------------------------------------------------------
        # AXIS 2: ЗАПРЕТ КОММЕНТИРОВАНИЯ АССЕРТОВ (Commented-out Assertions)
        # ---------------------------------------------------------------------
        for line_no, content in f['added_lines']:
            if "giga-diff-guard: allow" in content or "giga-check: allow" in content:
                continue

            commented_assert = False
            # Check single line comments
            if re.search(r"^\s*//\s*(?:assert|CHECK|REQUIRE|static_assert|GIGA_CHECK|assert_physical_invariants)\b", content):
                commented_assert = True
            elif re.search(r"^\s*/\*\s*(?:assert|CHECK|REQUIRE|static_assert|GIGA_CHECK)\b", content):
                commented_assert = True
            elif re.search(r"^\s*//.*\b(?:assert|CHECK|REQUIRE|static_assert|GIGA_CHECK)\s*\(", content):
                commented_assert = True
            elif re.search(r"^\s*#\s*if\s+0\b", content):
                commented_assert = True

            if commented_assert:
                violations.append(Violation(
                    file_path=target_file,
                    line_no=line_no,
                    rule_title="CANON S0 / DEFENSE TESTING §2.1 (Запрет на закомментирование ассертов и проверок)",
                    diff_line=f"+ {content}",
                    why_sabotage=(
                        "Обнаружен закомментированный ассерт или директива #if 0! Закомментировать проверку — значит "
                        "трусливо заткнуть рот компилятору и рантайму, скрыв физический взрыв или поломку памяти под ковер."
                    ),
                    how_to_fix=(
                        "1. Немедленно раскомментируй проверку.\n"
                        "   2. Запусти ctest / отладчик и выясни, почему условие не выполняется.\n"
                        "   3. Устрани источник неверных данных в симуляции, а не выключай стража."
                    )
                ))

        # ---------------------------------------------------------------------
        # AXIS 3: ЗАПРЕТ СТАБОВ, ОБХОДОВ ПРОВЕРОК И ОСЛАБЛЕНИЯ ДОПУСКОВ
        # ---------------------------------------------------------------------
        for hunk in f['hunks']:
            # Check tolerance relaxation inside hunk (e.g. replacing 1e-4f with 10.0f)
            deleted_tight = [c for _, c in hunk['deleted'] if TIGHT_EPSILON_PATTERN.search(c)]
            added_loose = [(no, c) for no, c in hunk['added'] if LOOSE_NUMBER_PATTERN.search(c)]

            if deleted_tight and added_loose:
                for l_no, l_content in added_loose:
                    if "giga-diff-guard: allow" in l_content:
                        continue
                    violations.append(Violation(
                        file_path=target_file,
                        line_no=l_no,
                        rule_title="CANON S0 / DEFENSE TESTING §2.1 (Запрет на ослабление допусков и анти-Гудхарт подгонку)",
                        diff_line=f"+ {l_content}",
                        why_sabotage=(
                            f"Обнаружено ослабление порога точности! В удаленных строках фигурировал жесткий допуск "
                            f"(например '{deleted_tight[0].strip()}'), который был заменен на грубый допуск в строке: "
                            f"'{l_content.strip()}'. Ослабление допуска скрывает джиттер рэгдолла, накопление численной "
                            f"погрешности или нестабильность интегратора."
                        ),
                        how_to_fix=(
                            "1. Верни жесткий физический допуск (<= 1e-4f / канонический эпсилон).\n"
                            "   2. Доработай сходимость физического солвера, стабилизируй частоту 125 Гц и расчет Баумгарте.\n"
                            "   3. Запрещено натягивать результат под падающий порог!"
                        )
                    ))

        for line_no, content in f['added_lines']:
            if "giga-diff-guard: allow" in content or "giga-check: allow" in content:
                continue

            # Stubs with fake comments
            if re.search(r"return\s+(?:0|true|false|nullptr|\{\}|std::nullopt)\s*;\s*//\s*(?:stub|fake|mock|temp|workaround|hack|dummy|todo|placeholder)", content, re.IGNORECASE):
                violations.append(Violation(
                    file_path=target_file,
                    line_no=line_no,
                    rule_title="CANON S0 / THE HAMMER §3.1 (Запрет на фейковые заглушки и стабы)",
                    diff_line=f"+ {content}",
                    why_sabotage=(
                        "Обнаружен возврат фиктивного значения с комментарием заглушки! Заглушки создают иллюзию "
                        "работающей системы, ломая контракты зависимых систем и оставляя мертвые ветки в коде."
                    ),
                    how_to_fix="Реализуй честную доменную логику до конца либо откажись от добавления недоделанной сигнатуры."
                ))

            # Void suppressions with fake comments
            if re.search(r"\(void\)\w+;\s*//\s*(?:stub|bypass|fake|ignore|dummy)", content, re.IGNORECASE):
                violations.append(Violation(
                    file_path=target_file,
                    line_no=line_no,
                    rule_title="CANON S0 / DEFENSE TESTING §2.1 (Запрет на фиктивное чтение аргументов)",
                    diff_line=f"+ {content}",
                    why_sabotage="Использование (void)arg; // stub для фиктивного подавления ворнингов без реализации функционала строго запрещено.",
                    how_to_fix="Задействуй аргумент в реальном алгоритме или убери неиспользуемый параметр."
                ))

            # Bypasses: if (true) return, assert(true), catch(...) {}
            if re.search(r"\bif\s*\(\s*(?:true|1)\s*\)\s*return\b", content):
                violations.append(Violation(
                    file_path=target_file,
                    line_no=line_no,
                    rule_title="CANON S0 (Запрет на жесткий обход логики if (true) return)",
                    diff_line=f"+ {content}",
                    why_sabotage="Встроен безусловный досрочный выход, отключающий всю последующую симуляцию.",
                    how_to_fix="Удали костыль if (true) return и обеспечь нормальное ветвление условий."
                ))

            if re.search(r"\b(?:assert|CHECK)\s*\(\s*(?:true|1)\s*\)\s*;", content):
                violations.append(Violation(
                    file_path=target_file,
                    line_no=line_no,
                    rule_title="DEFENSE TESTING §2.1 (Запрет на пустые проверки assert(true))",
                    diff_line=f"+ {content}",
                    why_sabotage="Проверка assert(true) / CHECK(true) является фикцией (Потемкинским тестом), создающей иллюзию тестирования.",
                    how_to_fix="Напиши содержательный ассерт на проверяемый инвариант."
                ))

            if re.search(r"catch\s*\([^)]*\)\s*\{\s*\}", content):
                violations.append(Violation(
                    file_path=target_file,
                    line_no=line_no,
                    rule_title="CANON S4.1 (Запрет на проглатывание ошибок через пустой catch)",
                    diff_line=f"+ {content}",
                    why_sabotage="Пустой блок catch скрывает критические сбои и нарушает дисциплину zero-exceptions C++23.",
                    how_to_fix="Удали перехват, возвращай структурированный Result<T> или фиксируй статус в Chronicle."
                ))

        # ---------------------------------------------------------------------
        # AXIS 4: ЗАПРЕТ НА // TODO, FIXME, HACK, WORKAROUND В БОЕВОМ КОДЕ
        # ---------------------------------------------------------------------
        if is_source or is_test:
            for line_no, content in f['added_lines']:
                if "giga-diff-guard: allow" in content or "giga-check: allow" in content:
                    continue
                stripped = content.strip()
                if stripped.startswith("///") or stripped.startswith("*"):
                    continue

                todo_match = re.search(r"//\s*(TODO|FIXME|HACK|WORKAROUND|TEMP|implement\s+later)\b", content, re.IGNORECASE)
                if not todo_match:
                    todo_match = re.search(r"/\*\s*(TODO|FIXME|HACK|WORKAROUND)\b", content, re.IGNORECASE)
                if not todo_match:
                    todo_match = re.search(r"/\*\s*rest\s+unchanged\s*\*/", content, re.IGNORECASE)

                if todo_match:
                    tag = todo_match.group(0).strip()
                    violations.append(Violation(
                        file_path=target_file,
                        line_no=line_no,
                        rule_title="THE HAMMER §4 / RED TEAM MANDATE (Тотальный запрет на долговой мусор // TODO, FIXME, HACK)",
                        diff_line=f"+ {content}",
                        why_sabotage=(
                            f"Обнаружен маркер технического долга '{tag}'! В GigaHrush 2 действует железный закон: "
                            f"код пишется начисто и сразу. Никаких обещаний 'доделать потом', временных костылей (HACK) "
                            f"или уродливых обходов (WORKAROUND) в репозитории быть не может."
                        ),
                        how_to_fix=(
                            "1. Допиши функционал полностью и начисто прямо сейчас.\n"
                            "   2. Если задача требует новой архитектурной системы — опиши ее в CANON.md и доведи до конца.\n"
                            "   3. Удали маркер долгового мусора."
                        )
                    ))

    return violations

def get_git_diff(args) -> str:
    if args.diff_file:
        p = Path(args.diff_file)
        if not p.exists():
            print(f"{RED}[diff_guard] Ошибка: файл диффа {p} не найден!{RESET}", file=sys.stderr)
            sys.exit(1)
        return p.read_text(encoding="utf-8", errors="replace")

    if args.diff_text:
        return args.diff_text

    git_cmd = ["git", "diff"]
    if args.staged:
        git_cmd.append("--cached")
    elif args.commit:
        git_cmd.append(args.commit)
    else:
        # Check staged first
        try:
            staged = subprocess.check_output(["git", "diff", "--cached"], cwd=REPO_ROOT, text=True, encoding="utf-8", errors="replace")
            if staged.strip():
                return staged
        except Exception:
            pass
        # Fall back to working tree vs HEAD
        git_cmd.append("HEAD")

    git_cmd.extend(["-U3"])
    try:
        diff_output = subprocess.check_output(git_cmd, cwd=REPO_ROOT, text=True, encoding="utf-8", errors="replace")
        return diff_output
    except subprocess.CalledProcessError as e:
        # If HEAD does not exist or git diff fails, try plain git diff
        try:
            return subprocess.check_output(["git", "diff", "-U3"], cwd=REPO_ROOT, text=True, encoding="utf-8", errors="replace")
        except Exception as e2:
            print(f"{YELLOW}[diff_guard] Предупреждение: git diff не вернул данных ({e2}).{RESET}")
            return ""

def run_self_test() -> int:
    """
    Two-polarity mutation self-test proving that the diff guard catches all defect types
    and stays green on valid clean diffs.
    """
    print(f"{CYAN}[diff_guard] Запуск двухполярного мутационного самотестирования (Two-Polarity Self-Test)...{RESET}")

    # Polarity 1: Clean, legitimate diff
    clean_diff = """
diff --git a/src/world/types.h b/src/world/types.h
--- a/src/world/types.h
+++ b/src/world/types.h
@@ -10,3 +10,4 @@
 constexpr int kMacroDim = 128;
+constexpr int kSubDim = 8;
diff --git a/tests/barrier_test.cpp b/tests/barrier_test.cpp
--- a/tests/barrier_test.cpp
+++ b/tests/barrier_test.cpp
@@ -20,3 +20,4 @@
     CHECK(dice.range(0.0f, 1.0f) >= 0.0f);
+    CHECK(dice.range(0.0f, 1.0f) <= 1.0f);
"""
    files_clean = parse_unified_diff(clean_diff)
    clean_violations = audit_diff(files_clean)
    if clean_violations:
        print(f"{RED}[diff_guard] Самотестирование ПРОВАЛЕНО на Полярности 1 (Чистый код дал ложные срабатывания)!{RESET}")
        for v in clean_violations:
            print(v.format_manifesto())
        return 1

    print(f"  {GREEN}✔ Полярность 1 (Чистый легальный дифф): PASS (0 нарушений){RESET}")

    # Polarity 2: Mutation injection test covering all 5 prohibited axes
    mutations = [
        (
            "Мутация 1: Удаление ассертов в tests/",
            """
diff --git a/tests/unit_test.cpp b/tests/unit_test.cpp
--- a/tests/unit_test.cpp
+++ b/tests/unit_test.cpp
@@ -15,4 +15,1 @@
-    CHECK(velocity.x == 0.0f);
-    CHECK(velocity.y == 0.0f);
-    CHECK(velocity.z == 0.0f);
+    int x = 42;
""",
            "Тотальный запрет на удаление тестов"
        ),
        (
            "Мутация 2: Закомментирование проверки // assert(...)",
            """
diff --git a/src/sim/physics.cpp b/src/sim/physics.cpp
--- a/src/sim/physics.cpp
+++ b/src/sim/physics.cpp
@@ -50,2 +50,3 @@
     float dt = 0.008f;
+    // assert(dt > 0.0f);
""",
            "Запрет на закомментирование ассертов"
        ),
        (
            "Мутация 3: Ослабление допуска точности 1e-4f -> 10.0f",
            """
diff --git a/tests/rigid_test.cpp b/tests/rigid_test.cpp
--- a/tests/rigid_test.cpp
+++ b/tests/rigid_test.cpp
@@ -30,2 +30,2 @@
-    CHECK(joint_error <= 1e-4f);
+    CHECK(joint_error <= 10.0f);
""",
            "Запрет на ослабление допусков"
        ),
        (
            "Мутация 4: Фейковый возврат / заглушка return true; // stub",
            """
diff --git a/src/game/action.cpp b/src/game/action.cpp
--- a/src/game/action.cpp
+++ b/src/game/action.cpp
@@ -100,2 +100,3 @@
 void process_action() {
+    return true; // stub
 }
""",
            "Запрет на фейковые заглушки"
        ),
        (
            "Мутация 5: Добавление // TODO в боевой код",
            """
diff --git a/src/core/math.h b/src/core/math.h
--- a/src/core/math.h
+++ b/src/core/math.h
@@ -40,2 +40,3 @@
 inline float dot(vec3 a, vec3 b) {
+    // TODO: optimize with AVX2 later
     return a.x * b.x + a.y * b.y + a.z * b.z;
""",
            "Тотальный запрет на долговой мусор // TODO"
        ),
        (
            "Мутация 6: Добавление // FIXME в шейдеры",
            """
diff --git a/shaders/raymarch.frag b/shaders/raymarch.frag
--- a/shaders/raymarch.frag
+++ b/shaders/raymarch.frag
@@ -80,2 +80,3 @@
 void main() {
+    // FIXME: fix lighting artifact on torus seam
 }
""",
            "Тотальный запрет на долговой мусор // TODO"
        ),
        (
            "Мутация 7: Обход проверки if (true) return",
            """
diff --git a/src/sim/contacts.cpp b/src/sim/contacts.cpp
--- a/src/sim/contacts.cpp
+++ b/src/sim/contacts.cpp
@@ -120,2 +120,3 @@
 void solve_contacts() {
+    if (true) return;
 }
""",
            "Запрет на жесткий обход логики if (true) return"
        ),
    ]

    for title, mut_diff, expected_rule in mutations:
        files_mut = parse_unified_diff(mut_diff)
        mut_violations = audit_diff(files_mut)
        if not mut_violations:
            print(f"{RED}[diff_guard] СБОЙ САМОТЕСТИРОВАНИЯ: {title} НЕ БЫЛА ПОЙМАНА!{RESET}")
            return 1
        matched = any(expected_rule in v.rule_title for v in mut_violations)
        if not matched:
            print(f"{RED}[diff_guard] СБОЙ САМОТЕСТИРОВАНИЯ: {title} поймана, но с неверным правилом: {mut_violations[0].rule_title}!{RESET}")
            return 1
        print(f"  {GREEN}✔ {title}: УСПЕШНО ЗАБЛОКИРОВАНА{RESET} (правило: {expected_rule})")

    print(f"{GREEN}[diff_guard] ВСЕ 7 МУТАЦИОННЫХ ТЕСТОВ УСПЕШНО ПРОЙДЕНЫ! Защита несокрушима.{RESET}")
    return 0

def main():
    parser = argparse.ArgumentParser(description="GigaHrush 2 Iron Gate Diff Guard Inquisitor")
    parser.add_argument("repo_path", nargs="?", default=None, help="Root path of the repository")
    parser.add_argument("--staged", action="store_true", help="Inspect git staged diff (--cached)")
    parser.add_argument("--commit", type=str, default=None, help="Inspect diff against commit/range")
    parser.add_argument("--diff-file", type=str, default=None, help="Inspect diff from file")
    parser.add_argument("--diff-text", type=str, default=None, help="Inspect diff from direct text")
    parser.add_argument("--self-test", action="store_true", help="Run comprehensive mutation self-test")
    args = parser.parse_args()

    if args.self_test:
        sys.exit(run_self_test())

    diff_text = get_git_diff(args)
    if not diff_text or not diff_text.strip():
        print(f"{GREEN}[DIFF GUARD] PASS: Дифф пуст, рабочее дерево чисто. Нарушений анти-Гудхарт и целостности тестов не обнаружено.{RESET}")
        sys.exit(0)

    files = parse_unified_diff(diff_text)
    violations = audit_diff(files)

    if violations:
        print(f"\n{RED}{'='*80}{RESET}")
        print(f"{RED}🚨 [IRON GATE: ДИФФ-ГЕЙТ ОБНАРУЖИЛ {len(violations)} КРИТИЧЕСКИХ НАРУШЕНИЙ]{RESET}")
        print(f"{RED}{'='*80}{RESET}")
        for v in violations:
            print(v.format_manifesto())
        print(f"{RED}[DIFF GUARD] FAILED: Обнаружено {len(violations)} актов саботажа кодовой базы! Коммит/сборка заблокированы.{RESET}\n", file=sys.stderr)
        sys.exit(1)
    else:
        print(f"{GREEN}[DIFF GUARD] PASS: Дифф проверен ({len(files)} файлов). Ноль удалений тестов, ноль ослаблений ассертов, ноль TODO/FIXME.{RESET}")
        sys.exit(0)

if __name__ == "__main__":
    main()
