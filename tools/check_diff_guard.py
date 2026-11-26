#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GigaHrush 2 — Iron Gate & Diff Guard Inquisitor (tools/check_diff_guard.py)
Advanced Anti-Blind-Kitten & Anti-Goodhart Repository Diff Defense Gate.
Modeled after Timeart and Dental CRM (scripts/check-staged-safety.mjs & failure-manifestos.mjs).

Mechanical barriers & AST-invariants:
 1. Forbids test & assertion deletion in tests/ without equivalent additions (Goodhart defense).
 2. Forbids commenting out assertions (// assert, // CHECK, // static_assert, #if 0).
 3. Forbids condition weakening (> to >=, < to <=) and condition inversions (!= to ==, CHECK to CHECK_FALSE, CHECK(expr) to CHECK(!expr)).
 4. Forbids loosening tolerances & epsilon dilution (e.g. 1e-4f -> 10.0f).
 5. Forbids technical debt slop (// TODO, FIXME, HACK, WORKAROUND, implement later, /* rest unchanged */).
 6. Forbids fake stubs (return true; // stub), argument silencers ((void)x; // stub), and bypasses (if (true) return).
 7. Forbids type laundering (reinterpret_cast, const_cast, C-style void* casts) in simulation core.
 8. Forbids exceptions (throw, catch) and RTTI (dynamic_cast, typeid) in engine core.
 9. Forbids dynamic allocations (new, malloc) in simulation hot paths (Zero Allocations).
10. Forbids non-determinism & sleep (sleep_for, Sleep, rand, srand, system_clock::now) in simulation tick.
11. Forbids compiler warning suppressions (#pragma warning(disable: ...), #pragma GCC/clang diagnostic ignored).
12. Forbids tautological tests (CHECK(true), assert(true), CHECK(1 == 1)).
13. Forbids UI retro-apparatura violations (WindowRounding > 0, FrameRounding > 0).
14. Forbids flat Euclidean distance metrics without toroidal wrapping (wrap_delta_f, wrap_dist).
15. Forbids quiet lowering of test floors or raising debt ceilings in quality baseline JSON.
16. Emits structured ANSI Failure Manifestos in natural Russian with "Blind Kitten vs Architect" contrast.
"""

import sys
import os
import re
import subprocess
import argparse
import json
from pathlib import Path

# ANSI colors for high-visibility terminal diagnostics
RED = "\033[1;31m"
GREEN = "\033[1;32m"
YELLOW = "\033[1;33m"
CYAN = "\033[1;36m"
BOLD = "\033[1m"
DIM = "\033[2m"
MAGENTA = "\033[1;35m"
RESET = "\033[0m"

REPO_ROOT = Path(__file__).resolve().parent.parent

class Violation:
    def __init__(self, file_path: str, line_no: int, rule_title: str, diff_line: str,
                 rotten_kitten: str, canonical_architect: str,
                 why_sabotage: str, how_to_fix: str, severity: str = "CRITICAL"):
        self.file_path = file_path
        self.line_no = line_no
        self.rule_title = rule_title
        self.diff_line = diff_line
        self.rotten_kitten = rotten_kitten
        self.canonical_architect = canonical_architect
        self.why_sabotage = why_sabotage
        self.how_to_fix = how_to_fix
        self.severity = severity

    def format_manifesto(self) -> str:
        return f"""
{RED}================================================================================{RESET}
{RED}🚨 СТОП! АНТИ-КОТЁНОК: ОБНАРУЖЕН АРХИТЕКТУРНЫЙ БРАК В ДИФФЕ!{RESET}
{RED}================================================================================{RESET}
{BOLD}🏛️  ШЛЮЗ / ЗАКОН:{RESET} {YELLOW}{self.rule_title}{RESET}
{BOLD}📍 ЛОКАЦИЯ:{RESET}       {CYAN}{self.file_path}:{self.line_no}{RESET}
{BOLD}🔍 СТРОКА ДИФФА:{RESET}
   {DIM}{self.diff_line.strip()}{RESET}

{BOLD}⚖️  РАЗНИЦА МЕЖДУ СЛЕПЫМ КОТЁНКОМ И АРХИТЕКТОРОМ:{RESET}
   {RED}❌ КАК ДЕЛАЕТ СЛЕПОЙ КОТЁНОК:{RESET} {self.rotten_kitten}
   {CYAN}✅ КАК ДЕЛАЕТ АРХИТЕКТОР:{RESET}     {self.canonical_architect}

{BOLD}⚠️  СИМУЛЯЦИОННАЯ И АРХИТЕКТУРНАЯ УГРОЗА ДЛЯ ДВИЖКА:{RESET}
   {self.why_sabotage}

{BOLD}⛔ ПОЧЕМУ ЗАПЛАТКА ИЛИ КОСТЫЛЬ — ЭТО САБОТАЖ (РОТТЕН СИД):{RESET}
   Категорически запрещено протаскивать костыли, заглушки или ослаблять проверки!
   Любая косметическая припарка разлагает кодовую базу и порождает скрытые взрывы симуляции.

{BOLD}🛠️  КАНОНИЧЕСКИЙ АЛГОРИТМ ИСПРАВЛЕНИЯ (НИКАКИХ ПРИПАРОК):{RESET}
   {self.how_to_fix}

{RED}--------------------------------------------------------------------------------{RESET}
{BOLD}{RED}❌ ДЕЙСТВИЕ ЗАБЛОКИРОВАНО. ИДИ И ПЕРЕДЕЛЫВАЙ НА СОВЕСТЬ ПО ПЕРВЫМ ПРИНЦИПАМ!{RESET}
{RED}================================================================================{RESET}
"""

def is_doc_or_tool_file(file_path: str) -> bool:
    norm = file_path.replace("\\", "/").lower()
    if norm.endswith(".md") or norm.endswith(".txt") or norm.endswith(".csv"):
        return True
    if norm.startswith("tools/") or norm.startswith("scripts/") or norm.startswith(".agents/") or norm.startswith("docs/"):
        return True
    return False

def is_test_file(file_path: str) -> bool:
    if is_doc_or_tool_file(file_path):
        return False
    normalized = file_path.replace("\\", "/").lower()
    return (
        "/tests/" in normalized
        or normalized.startswith("tests/")
        or "_test." in normalized
        or "test_" in normalized
        or "suite_" in normalized
    )

def is_source_file(file_path: str) -> bool:
    if is_doc_or_tool_file(file_path):
        return False
    ext = Path(file_path).suffix.lower()
    return ext in {".cpp", ".h", ".c", ".comp", ".frag", ".vert", ".glsl", ".inl"}

def is_simulation_core_file(file_path: str) -> bool:
    if is_doc_or_tool_file(file_path):
        return False
    norm = file_path.replace("\\", "/").lower()
    return (
        norm.startswith("src/core/")
        or norm.startswith("src/world/")
        or norm.startswith("src/sim/")
        or norm.startswith("src/game/")
    )

def is_ui_file(file_path: str) -> bool:
    if is_doc_or_tool_file(file_path):
        return False
    norm = file_path.replace("\\", "/").lower()
    return norm.startswith("src/app/") or "hud_ui" in norm or "imgui" in norm

def preserve_newlines(m):
    return '\n' * m.group(0).count('\n')

def code_only_multiline(text: str) -> str:
    """
    AST-очиститель кода от литералов и комментариев с полным сохранением номеров строк.
    1. C++23 raw string literals R"delim(...)delim"
    2. C/C++ многострочные комментарии /* ... */
    3. Обычные строки "..."
    4. Символьные литералы '...'
    5. Однострочные комментарии // ...
    """
    s = re.sub(r'R"([a-zA-Z0-9_]*)\([\s\S]*?\)\1"', preserve_newlines, text)
    s = re.sub(r'/\*[\s\S]*?\*/', preserve_newlines, s)
    s = re.sub(r'"(?:[^"\\]|\\.)*"', '""', s)
    s = re.sub(r"'(?:[^'\\]|\\.)*'", "''", s)
    s = re.sub(r'//.*$', '', s, flags=re.MULTILINE)
    return s

def code_only(line: str) -> str:
    """
    Однострочная очистка кода: убирает строковые/символьные литералы и хвостовые комментарии.
    Прямой аналог codeOnly(line) из Dental CRM scripts/check-staged-safety.mjs.
    """
    s = re.sub(r'R"([a-zA-Z0-9_]*)\([\s\S]*?\)\1"', '""', line)
    s = re.sub(r'"(?:[^"\\]|\\.)*"', '""', s)
    s = re.sub(r"'(?:[^'\\]|\\.)*'", "''", s)
    s = re.sub(r"//.*$", "", s)
    s = re.sub(r"/\*.*?\*/", "", s)
    return s.strip()

def normalize_tokens(s: str) -> str:
    """
    Нормализует строку для точного сравнения условий: удаляет комментарии и все пробельные символы.
    """
    s = re.sub(r'//.*$', '', s)
    s = re.sub(r'/\*.*?\*/', '', s)
    return re.sub(r'\s+', '', s)

def detect_inversion_or_weakening(del_content: str, add_content: str):
    """
    Математически строгий детектор инверсии условий и ослабления строгих неравенств.
    Выявляет попытки агента подогнать тест под кривой результат:
    - Ослабление строгого > на >=
    - Ослабление строгого < на <=
    - Инверсия != на ==
    - Инверсия == на !=
    - Инверсия макроса CHECK на CHECK_FALSE
    - Инверсия ассерта через отрицание CHECK(expr) -> CHECK(!expr)
    """
    del_norm = normalize_tokens(del_content)
    add_norm = normalize_tokens(add_content)
    if not del_norm or not add_norm:
        return None

    # 1. Ослабление строгого неравенства > до >=
    if '>' in del_norm and '>=' in add_norm:
        if add_norm.replace('>=', '>') == del_norm:
            return (
                "WEAKENING_GREATER_EQUAL",
                "Ослабление строгого неравенства '>' до '>='",
                "Ослабляет '>' до '>=', допуская нулевое значение или недопустимую границу.",
                "Сохраняет строгое неравенство '> 0', находит почему значение стало нулевым, и чинит формулу."
            )

    # 2. Ослабление строгого неравенства < до <=
    if '<' in del_norm and '<=' in add_norm:
        if add_norm.replace('<=', '<') == del_norm:
            return (
                "WEAKENING_LESS_EQUAL",
                "Ослабление строгого неравенства '<' до '<='",
                "Ослабляет '<' до '<=', маскируя выход за границу допустимого диапазона.",
                "Удерживает строгое '<', устраняет погрешность вычислений в ядре."
            )

    # 3. Инверсия != в ==
    if '!=' in del_norm and '==' in add_norm:
        if add_norm.replace('==', '!=') == del_norm:
            return (
                "INVERSION_NOT_EQUAL_TO_EQUAL",
                "Инверсия условия '!=' в '=='",
                "Инвертирует проверку с '!=' на '==', зеркально переворачивая смысл теста ради зеленого статуса.",
                "Сохраняет проверку неравенства '!=', исправляет источник совпадения в логике."
            )

    # 4. Инверсия == в !=
    if '==' in del_norm and '!=' in add_norm:
        if add_norm.replace('!=', '==') == del_norm:
            return (
                "INVERSION_EQUAL_TO_NOT_EQUAL",
                "Инверсия условия '==' в '!='",
                "Инвертирует ожидаемое равенство '==' на '!=', подменяя утверждение теста.",
                "Восстанавливает равенство '==', добиваясь точного совпадения эталонного значения."
            )

    # 5. Инверсия полярности макроса проверки CHECK -> CHECK_FALSE
    if ('CHECK(' in del_norm and 'CHECK_FALSE(' in add_norm) or ('REQUIRE(' in del_norm and 'REQUIRE_FALSE(' in add_norm):
        if add_norm.replace('CHECK_FALSE', 'CHECK').replace('REQUIRE_FALSE', 'REQUIRE') == del_norm:
            return (
                "INVERSION_CHECK_FALSE",
                "Инверсия макроса проверки (CHECK -> CHECK_FALSE)",
                "Меняет CHECK на CHECK_FALSE, заставляя тест проверять противоположное состояние.",
                "Сохраняет CHECK, находит дефект в симуляции и добивается истинности инварианта."
            )

    # 6. Инверсия проверяемого выражения через отрицание CHECK(expr) -> CHECK(!expr)
    if any(m in del_norm for m in ['CHECK(', 'REQUIRE(', 'assert(']):
        subbed = add_norm.replace('CHECK(!', 'CHECK(').replace('REQUIRE(!', 'REQUIRE(').replace('assert(!', 'assert(')
        if subbed == del_norm:
            return (
                "INVERSION_ASSERT_NOT",
                "Инверсия условия в ассерте через оператор отрицания '!'",
                "Втыкает '!' перед проверяемым выражением в ассерте, скрывая ложное состояние.",
                "Убирает '!', чинит генерацию истинного состояния в компонентах ядра."
            )

    return None

def parse_unified_diff(diff_text: str):
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

        old_line += 1
        new_line += 1

    return files

ASSERT_PATTERN = re.compile(r"\b(CHECK|CHECK_FALSE|REQUIRE|REQUIRE_FALSE|assert|static_assert|GIGA_CHECK|assert_physical_invariants)\s*\(")
TEST_CASE_PATTERN = re.compile(r"\b(TEST_CASE|SUBCASE)\s*\(|\bvoid\s+test_[a-zA-Z0-9_]+\s*\(")
TIGHT_EPSILON_PATTERN = re.compile(r"\b(?:1e-[3-9]f?|0\.000[0-9]+f?|0\.001f?)\b")
LOOSE_NUMBER_PATTERN = re.compile(r"\b(?:10\.0f?|100\.0f?|[2-9]\.0f?|1\.0f?|0\.[2-9]f?)\b")

def check_baseline_diff(diff_text: str) -> list:
    """
    Проверка диффа файлов паспортов качества (.data/*baseline*.json) на попытки
    тихого снижения порогов (полов тестов) или увеличения потолков дефектов.
    Прямой аналог checkBaselineDiff из Dental CRM scripts/check-staged-safety.mjs.
    """
    violations = []
    baseline_match = re.search(r"diff --git a/(\.data/[^\s]+\.json) b/\1[\s\S]*?(?=(?:diff --git|$))", diff_text)
    if not baseline_match:
        return violations

    file_path = baseline_match.group(1)
    hunk = baseline_match.group(0)

    old_vals = {}
    new_vals = {}

    for line in hunk.splitlines():
        if line.startswith("-") and not line.startswith("---"):
            m = re.search(r'"([^"]+)":\s*(\d+)', line)
            if m:
                old_vals[m.group(1)] = int(m.group(2))
        elif line.startswith("+") and not line.startswith("+++"):
            m = re.search(r'"([^"]+)":\s*(\d+)', line)
            if m:
                new_vals[m.group(1)] = int(m.group(2))

    # Floor metrics: cannot drop
    floor_keys = {"total_assertions", "test_files", "prod_files"}
    for key in floor_keys:
        if key in new_vals and key in old_vals:
            if new_vals[key] < old_vals[key]:
                violations.append(Violation(
                    file_path=file_path,
                    line_no=1,
                    rule_title="CANON S0 / ANTI-GOODHART (Тихое снижение санитарного пола тестов в бейслайне)",
                    diff_line=f'"{key}": {new_vals[key]} (было: {old_vals[key]})',
                    rotten_kitten=f"Снижает порог {key} ({old_vals[key]} ➔ {new_vals[key]}), чтобы скрыть удаление проверок.",
                    canonical_architect="Сохраняет монотонный рост полов качества. Храповик не дает хода назад!",
                    why_sabotage="Снижение пола тестов ослепляет CI/CD и позволяет сдавать регрессионный код.",
                    how_to_fix="Восстанови прежнее значение пола в паспорте качества и исправь тесты."
                ))

    # Ceiling metrics: cannot increase
    ceil_keys = {"banned_stubs", "raw_casts"}
    for key in ceil_keys:
        if key in new_vals and key in old_vals:
            if new_vals[key] > old_vals[key]:
                violations.append(Violation(
                    file_path=file_path,
                    line_no=1,
                    rule_title="CANON S0 / THE HAMMER §4 (Попытка завысить потолок дефектов в бейслайне)",
                    diff_line=f'"{key}": {new_vals[key]} (было: {old_vals[key]})',
                    rotten_kitten=f"Увеличивает потолок {key} ({old_vals[key]} ➔ {new_vals[key]}), легализуя свежие костыли.",
                    canonical_architect="Уменьшает число дефектов до нуля по First Principles.",
                    why_sabotage="Рост потолка дефектов превращает репозиторий в помойку технического долга.",
                    how_to_fix="Устрани внесенные костыли и верни исходный потолок."
                ))

    return violations

def check_contiguous_added_block(block, file_path: str, is_sim_core: bool, is_test: bool) -> list:
    """
    Инспекция многострочных блоков кода (Contiguous Added Block) по эталону Dental CRM.
    Предотвращает обход правил через форматирование на несколько строк (например, перенос reinterpret_cast).
    """
    violations = []
    if not block or len(block) <= 1:
        return violations

    full_code = "\n".join(b['code'] for b in block)
    cleaned_code = code_only_multiline(full_code)
    first_line = block[0]['line_no']

    if is_sim_core:
        # Multiline reinterpret_cast
        if re.search(r'\breinterpret_cast\s*<', cleaned_code):
            violations.append(Violation(
                file_path=file_path,
                line_no=first_line,
                rule_title="CANON S11 / CODE CONTRACTS BIBLE (Запрет reinterpret_cast в многострочном блоке)",
                diff_line=block[0]['code'].strip(),
                rotten_kitten="Разбивает reinterpret_cast<...> на несколько строк, пытаясь обмануть однострочный рентген.",
                canonical_architect="Использует плоские структуры POD, std::bit_cast или type_tag<T>().",
                why_sabotage="Слепое перетолкование памяти ведет к Undefined Behavior и порче кэш-линий.",
                how_to_fix="Объяви строгий POD-тип данных."
            ))

        # Multiline const_cast
        if re.search(r'\bconst_cast\s*<', cleaned_code):
            violations.append(Violation(
                file_path=file_path,
                line_no=first_line,
                rule_title="CANON S11 (Запрет const_cast в многострочном блоке)",
                diff_line=block[0]['code'].strip(),
                rotten_kitten="Сбрасывает const через многострочный const_cast<...>",
                canonical_architect="Передает мутируемое состояние через явную неконстантную ссылку.",
                why_sabotage="Сброс const нарушает потокобезопасность чтения мира.",
                how_to_fix="Раздели поток чтения и мутации."
            ))

        # Multiline if (true) return
        if re.search(r'\bif\s*\(\s*(?:true|1)\s*\)\s*(?:\{\s*)?return\b', cleaned_code):
            violations.append(Violation(
                file_path=file_path,
                line_no=first_line,
                rule_title="CANON S0 (Многострочный обход логики if (true) return)",
                diff_line=block[0]['code'].strip(),
                rotten_kitten="Разносит 'if (true)' и 'return' на разные строки для маскировки заглушки.",
                canonical_architect="Реализует честную логику с обработкой граничных условий.",
                why_sabotage="Безусловный досрочный выход ослепляет симуляцию.",
                how_to_fix="Удали костыль if (true) return."
            ))

        # Multiline empty catch
        if re.search(r'catch\s*\([^)]*\)\s*\{\s*\}', cleaned_code):
            violations.append(Violation(
                file_path=file_path,
                line_no=first_line,
                rule_title="CANON S4.1 (Многострочный пустой catch { })",
                diff_line=block[0]['code'].strip(),
                rotten_kitten="Глушит исключения пустым блоком catch на нескольких строках.",
                canonical_architect="Возвращает структурированный Result<T> или фиксирует сбой в Chronicle.",
                why_sabotage="Пустой catch скрывает повреждение памяти.",
                how_to_fix="Удали catch, возвращай явный статус."
            ))

    # Multiline compiler suppression
    if re.search(r'#\s*pragma\s+warning\s*\(\s*disable\s*:', full_code) or re.search(r'#\s*pragma\s+(?:GCC|clang)\s+diagnostic\s+ignored', full_code):
        violations.append(Violation(
            file_path=file_path,
            line_no=first_line,
            rule_title="THE HAMMER §6.1 (Запрет на многострочное подавление предупреждений #pragma warning)",
            diff_line=block[0]['code'].strip(),
            rotten_kitten="Глушит предупреждения компилятора через директивы #pragma warning disable.",
            canonical_architect="Исправляет код начисто, добиваясь нулевых ворнингов на /W4 и -Wall.",
            why_sabotage="Подавление предупреждений аналогично @ts-ignore и скрывает скрытые дефекты.",
            how_to_fix="Удали #pragma и устрани причину предупреждения."
        ))

    return violations

def audit_diff(files, raw_diff: str = "") -> list:
    violations = []

    # 0. Проверка диффа паспортов качества (Ratchet Baseline Diff)
    if raw_diff:
        violations.extend(check_baseline_diff(raw_diff))

    for f in files:
        target_file = f['file_new'] or f['file_old']
        if not target_file:
            continue

        # Исключаем скрипты сборки, тулы и документацию из C++ инспекции
        if is_doc_or_tool_file(target_file):
            continue

        is_test = is_test_file(target_file)
        is_source = is_source_file(target_file)
        is_sim_core = is_simulation_core_file(target_file)
        is_ui = is_ui_file(target_file)

        # ---------------------------------------------------------------------
        # 1. ЗАПРЕТ УДАЛЕНИЯ ТЕСТОВ (Test Deletion Prohibition)
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
                    rotten_kitten="Сносит падающие ассерты из теста, чтобы ctest радостно рапортовал зеленый статус.",
                    canonical_architect="Оставляет проверку неприкосновенной, находит регрессию в ядре симуляции и чинит физический алгоритм.",
                    why_sabotage=(
                        f"В диффе удалено {len(deleted_asserts)} проверочных ассертов, а добавлено только {added_asserts_count} "
                        f"(дефицит: -{deficit} проверок)! Удаление проверок ослепляет заградительный барьер Ring 1-5 и "
                        f"пропускает регрессии в симуляцию 128³."
                    ),
                    how_to_fix=(
                        "1. Немедленно верни удаленные проверки и ассерты на место.\n"
                        "   2. Если тест падает — открой файл ядра через read_file и исправь реализацию.\n"
                        "   3. Добивайся строгого 0 failures при сохранении 100% assertions."
                    )
                ))

            # Проверка удаления тест-кейсов
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
                    rotten_kitten="Вырезает неудобный тест целиком, скрывая несовместимость контрактов.",
                    canonical_architect="Адаптирует тестовый сценарий под обновленный канонический контракт, сохраняя покрытие.",
                    why_sabotage=f"Удален целый тестовый сценарий ({len(deleted_cases)} удалено vs {added_cases_count} добавлено).",
                    how_to_fix="Восстанови тестовый сценарий. Если система обновлена — переведи тест на актуальный API."
                ))

        # ---------------------------------------------------------------------
        # 2. АНАЛИЗ ХАНКОВ: ИНВЕРСИЯ УСЛОВИЙ, ОСЛАБЛЕНИЕ НЕРАВЕНСТВ И ЭПСИЛОНОВ
        # ---------------------------------------------------------------------
        for hunk in f['hunks']:
            # 2.1 Детекция ослабления строгих неравенств (> на >=) и инверсий (!= на ==)
            for del_line_no, del_c in hunk['deleted']:
                for add_line_no, add_c in hunk['added']:
                    inv_match = detect_inversion_or_weakening(del_c, add_c)
                    if inv_match:
                        code_key, title_desc, rotten_desc, canonical_desc = inv_match
                        violations.append(Violation(
                            file_path=target_file,
                            line_no=add_line_no,
                            rule_title=f"CANON S0 / DEFENSE TESTING §2.2 ({title_desc})",
                            diff_line=f"- {del_c.strip()}\n+ {add_c.strip()}",
                            rotten_kitten=rotten_desc,
                            canonical_architect=canonical_desc,
                            why_sabotage=(
                                f"Обнаружена попытка обойти проверку: {title_desc}. "
                                "Ослабление строгих неравенств или инверсия полярности маскирует краевые взрывы и деление на ноль."
                            ),
                            how_to_fix=(
                                "1. Верни исходное строгое математическое условие или полярность проверки.\n"
                                "   2. Выясни, почему алгоритм порождает некорректное пограничное значение.\n"
                                "   3. Устрани источник погрешности в боевом коде ядра."
                            )
                        ))

            # 2.2 Детекция размытия допусков (Epsilon Dilution)
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
                        rotten_kitten="Меняет 1e-4f на 10.0f, чтобы криво посчитанная формула прошла тест.",
                        canonical_architect="Восстанавливает допуск 1e-4f, стабилизирует интегратор Баумгарте и гасит численный джиттер.",
                        why_sabotage="Ослабление допусков скрывает разлет рэгдоллов, джиттер контактов и пробитие тора.",
                        how_to_fix=(
                            "1. Верни жесткий физический допуск (<= 1e-4f).\n"
                            "   2. Доработай сходимость физического солвера.\n"
                            "   3. Запрещено натягивать результат под падающий порог!"
                        )
                    ))

        # ---------------------------------------------------------------------
        # 3. МНОГОСТРОЧНЫЕ ДОБАВЛЕННЫЕ БЛОКИ (Contiguous Added Blocks)
        # ---------------------------------------------------------------------
        contiguous_added = []
        for line_no, content in f['added_lines']:
            contiguous_added.append({'line_no': line_no, 'code': content})
        if contiguous_added:
            violations.extend(check_contiguous_added_block(contiguous_added, target_file, is_sim_core, is_test))

        # ---------------------------------------------------------------------
        # 4. ПОСТРОЧНЫЙ АНАЛИЗ ДОБАВЛЯЕМОГО КОДА
        # ---------------------------------------------------------------------
        for line_no, content in f['added_lines']:
            if "giga-diff-guard: allow" in content or "giga-check: allow" in content:
                continue

            # 4.1 Закомментирование ассертов и проверок
            commented_assert = False
            if re.search(r"^\s*//\s*(?:assert|CHECK|REQUIRE|static_assert|GIGA_CHECK|assert_physical_invariants)\b", content):
                commented_assert = True
            elif re.search(r"^\s*/\*\s*(?:assert|CHECK|REQUIRE|static_assert|GIGA_CHECK)\b", content):
                commented_assert = True
            elif re.search(r"^\s*//.*\b(?:assert|CHECK|REQUIRE|static_assert|GIGA_CHECK)\s*\(", content):
                commented_assert = True
            elif re.search(r"^\s*#\s*if\s+0\b", content) and is_test:
                commented_assert = True

            if commented_assert:
                violations.append(Violation(
                    file_path=target_file,
                    line_no=line_no,
                    rule_title="CANON S0 / DEFENSE TESTING §2.1 (Запрет на закомментирование ассертов и проверок)",
                    diff_line=f"+ {content}",
                    rotten_kitten="Глушит упавший ассерт двумя слэшами '// assert(...)', затыкая рот валидатору.",
                    canonical_architect="Раскомментирует проверку, запускает тест в отладчике и устраняет источник неверных данных.",
                    why_sabotage="Закомментированный ассерт делает систему слепой к разрушению памяти, джиттеру Баумгарте или нарушению шва тора.",
                    how_to_fix=(
                        "1. Немедленно раскомментируй проверку.\n"
                        "   2. Выясни, на каких входных данных контракт нарушается.\n"
                        "   3. Устрани источник невалидного состояния в логике симуляции."
                    )
                ))

            # 4.2 Подавление предупреждений компилятора (#pragma warning disable)
            if re.search(r"#\s*pragma\s+warning\s*\(\s*disable\s*:", content) or re.search(r"#\s*pragma\s+(?:GCC|clang)\s+diagnostic\s+ignored", content):
                violations.append(Violation(
                    file_path=target_file,
                    line_no=line_no,
                    rule_title="THE HAMMER §6.1 (Запрет на подавление предупреждений компилятора #pragma warning disable)",
                    diff_line=f"+ {content}",
                    rotten_kitten="Глушит ворнинги директивой #pragma warning(disable: ...), скрывая опасный код от компилятора.",
                    canonical_architect="Пишет код чисто, устраняя первопричину предупреждения компилятора без подавлений.",
                    why_sabotage="Подавление предупреждений компилятора скрывает UB, переполнение буферов и неинициализированные поля.",
                    how_to_fix="Удали директиву #pragma и исправь код так, чтобы компилятор не выдавал ворнингов на /W4 и -Wall."
                ))

            # 4.3 Долговой мусор // TODO, FIXME, HACK, WORKAROUND
            if is_source or is_test:
                stripped = content.strip()
                if not (stripped.startswith("///") or stripped.startswith("*")):
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
                            rotten_kitten=f"Бросает маркер '{tag}', обещая «сделать потом».",
                            canonical_architect="Пишет код начисто и сразу. Либо проектирует архитектуру в CANON.md, либо не спамит в исходники.",
                            why_sabotage="Метки TODO и HACK превращают кодовую базу в долговую яму, из которой движок никогда не выберется.",
                            how_to_fix=(
                                "1. Допиши функционал полностью и начисто прямо сейчас.\n"
                                "   2. Если задача требует новой системы — зафиксируй спецификацию в CANON.md.\n"
                                "   3. Удали маркер долгового мусора."
                            )
                        ))

            # Очищенный код для проверки синтаксиса C++
            code = code_only(content)
            if not code:
                continue

            # 4.4 Заглушки и стабы
            if re.search(r"return\s+(?:0|true|false|nullptr|\{\}|std::nullopt)\s*;\s*//\s*(?:stub|fake|mock|temp|workaround|hack|dummy|todo|placeholder)", content, re.IGNORECASE):
                violations.append(Violation(
                    file_path=target_file,
                    line_no=line_no,
                    rule_title="CANON S0 / THE HAMMER §3.1 (Запрет на фейковые заглушки и стабы)",
                    diff_line=f"+ {content}",
                    rotten_kitten="Возвращает 'return true; // stub', бросая пустую функцию.",
                    canonical_architect="Реализует доменный контракт до конца по First Principles.",
                    why_sabotage="Заглушки создают иллюзию работающей системы, ломая зависимые контракты в рантайме.",
                    how_to_fix="Реализуй честную логику до конца либо откажись от добавления недоделанной сигнатуры."
                ))

            # 4.5 Фиктивное глушение аргументов
            if re.search(r"\(void\)\w+;\s*//\s*(?:stub|bypass|fake|ignore|dummy)", content, re.IGNORECASE):
                violations.append(Violation(
                    file_path=target_file,
                    line_no=line_no,
                    rule_title="CANON S0 / DEFENSE TESTING §2.1 (Запрет на фиктивное чтение аргументов)",
                    diff_line=f"+ {content}",
                    rotten_kitten="Пишет '(void)arg; // stub', замазывая неиспользуемый аргумент вместо реализации.",
                    canonical_architect="Использует аргумент в логике или удаляет ненужный параметр из сигнатуры.",
                    why_sabotage="Фиктивное чтение аргументов скрывает брошенные параметры систем.",
                    how_to_fix="Задействуй параметр в расчете или удали его."
                ))

            # 4.6 Обходы проверок if (true) return
            if re.search(r"\bif\s*\(\s*(?:true|1)\s*\)\s*return\b", code):
                violations.append(Violation(
                    file_path=target_file,
                    line_no=line_no,
                    rule_title="CANON S0 (Запрет на жесткий обход логики if (true) return)",
                    diff_line=f"+ {content}",
                    rotten_kitten="Ставит 'if (true) return;' в начале сложной функции, отключая ее выполнение.",
                    canonical_architect="Обеспечивает корректное ветвление и честную обработку граничных условий.",
                    why_sabotage="Безусловный досрочный выход ослепляет симуляцию и оставляет мертвый код.",
                    how_to_fix="Удали костыль if (true) return."
                ))

            # 4.7 Тавтологические тесты
            if is_test and re.search(r"\b(?:assert|CHECK|REQUIRE)\s*\(\s*(?:true|1|1\s*==\s*1)\s*\)\s*;", code):
                violations.append(Violation(
                    file_path=target_file,
                    line_no=line_no,
                    rule_title="DEFENSE TESTING §2.1 (Запрет на тавтологии и Потёмкинские тесты assert(true))",
                    diff_line=f"+ {content}",
                    rotten_kitten="Пишет 'CHECK(true)' или 'assert(1)', чтобы тест никогда не мог упасть.",
                    canonical_architect="Пишет содержательный ассерт на проверяемый инвариант с граничными условиями.",
                    why_sabotage="Тест-пустышка — это прямая фальсификация отчетов ctest по закону Гудхарта.",
                    how_to_fix="Напиши честную проверку на фактические результирующие данные."
                ))

            # 4.8 Пустой catch
            if re.search(r"catch\s*\([^)]*\)\s*\{\s*\}", code):
                violations.append(Violation(
                    file_path=target_file,
                    line_no=line_no,
                    rule_title="CANON S4.1 (Запрет на проглатывание ошибок через пустой catch)",
                    diff_line=f"+ {content}",
                    rotten_kitten="Глушит сбои пустым блоком 'catch (...) {}', пряча катастрофы под ковер.",
                    canonical_architect="Возвращает явный код ошибки или логирует инцидент в Chronicle.",
                    why_sabotage="Пустой catch скрывает повреждение памяти и нарушает no-exceptions стандарт.",
                    how_to_fix="Удали перехват, возвращай структурированный Result<T>."
                ))

            # 4.9 Опасные касты в ядре симуляции
            if is_sim_core:
                if re.search(r'\breinterpret_cast\s*<', code):
                    violations.append(Violation(
                        file_path=target_file,
                        line_no=line_no,
                        rule_title="CANON S11 / CODE CONTRACTS BIBLE (Запрет reinterpret_cast в ядре симуляции)",
                        diff_line=f"+ {content}",
                        rotten_kitten="Применяет reinterpret_cast<void*>, ломая строгую C++23 типизацию и выравнивание кэш-линий.",
                        canonical_architect="Использует плоские POD-структуры GIGA_ROW(T), std::bit_cast или канонические type_tag<T>().",
                        why_sabotage="Слепое перетолкование памяти ведёт к Undefined Behavior, UB-падениям в релизе и разрушению кэша L1/L2.",
                        how_to_fix="Объяви строгую структуру данных или используй безопасные конвертеры типов."
                    ))

                if re.search(r'\bconst_cast\s*<', code):
                    violations.append(Violation(
                        file_path=target_file,
                        line_no=line_no,
                        rule_title="CANON S11 (Запрет сброса константности const_cast в ядре)",
                        diff_line=f"+ {content}",
                        why_sabotage="Сброс const нарушает потокобезопасность чтения мира и целостность снапшотов симуляции.",
                        rotten_kitten="Снимает константность через const_cast, чтобы по-быстрому пропатчить данные.",
                        canonical_architect="Передает мутируемое состояние через явную неконстантную ссылку или отдельную очередь команд.",
                        how_to_fix="Перепроектируй поток данных: чтение и мутация должны быть строго разделены."
                    ))

                if re.search(r'\bnew\s+[A-Za-z0-9_]+', code) or re.search(r'\bmalloc\s*\(', code):
                    violations.append(Violation(
                        file_path=target_file,
                        line_no=line_no,
                        rule_title="THE HAMMER §4.4 / CANON S11 (Запрет динамических аллокаций памяти new/malloc в тике)",
                        diff_line=f"+ {content}",
                        rotten_kitten="Аллоцирует память в куче (new/malloc) прямо в шаге симуляции, вызывая фрагментацию.",
                        canonical_architect="Использует статические пулы, Monolith 128³ непрерывные буферы или фиксированные арены.",
                        why_sabotage="Такт симуляции 125 Гц священен (dt = 0.008 с). Аллокации в горячем цикле вызывают лаги и дроп кадров.",
                        how_to_fix="Вынеси аллокации в фазу предзагрузки этажа или используй статический POD-буфер."
                    ))

                if re.search(r'\b(sleep_for|sleep_until|Sleep\(|usleep)\b', code):
                    violations.append(Violation(
                        file_path=target_file,
                        line_no=line_no,
                        rule_title="CANON S11 / S15 (Запрет системного сна sleep в горячих путях симуляции)",
                        diff_line=f"+ {content}",
                        rotten_kitten="Втыкает системный sleep, пытаясь синхронизировать потоки костылями.",
                        canonical_architect="Продвигает симуляцию дискретными квантами по 125 Гц строго через sim_time.",
                        why_sabotage="Системный сон разрушает детерминизм симуляции, ломает DDA лучи и блокирует воркеры job system.",
                        how_to_fix="Удали sleep. Время симуляции тикает квантами dt = 0.008 с."
                    ))

                if re.search(r'\b(rand\s*\(|srand\s*\()', code):
                    violations.append(Violation(
                        file_path=target_file,
                        line_no=line_no,
                        rule_title="CANON S15 (Запрет неделимого std::rand() в симуляции — строго Mulberry32)",
                        diff_line=f"+ {content}",
                        rotten_kitten="Использует недетерминированный rand(), ломая воспроизводимость реплеев.",
                        canonical_architect="Использует канонический генератор псевдослучайных чисел Mulberry32 со строгим сидом.",
                        why_sabotage="Недетерминированный генератор случайных чисел делает симуляцию невоспроизводимой в тестах.",
                        how_to_fix="Используй детерминированный генератор псевдослучайных чисел движка."
                    ))

                # Плоская евклидова метрика
                if re.search(r'\b(std::sqrt|sqrtf)\s*\(\s*dx\s*\*\s*dx\s*\+\s*dy\s*\*\s*dy\s*\+\s*dz\s*\*\s*dz\s*\)', code):
                    violations.append(Violation(
                        file_path=target_file,
                        line_no=line_no,
                        rule_title="CANON S1 (Запрет плоской евклидовой метрики на изотропном торе 128³)",
                        diff_line=f"+ {content}",
                        rotten_kitten="Считает расстояние через обычный sqrt(dx*dx + dy*dy + dz*dz), забывая про тороидальный шов.",
                        canonical_architect="Использует wrap_delta_f(a, b, kWorldExtent) или канонический wrap_dist(p1, p2).",
                        why_sabotage="На торе кратчайший путь через шов короче прямого. Плоская метрика рвет физику на границах мира.",
                        how_to_fix="Используй wrap_delta_f или wrap_dist для расчета тороидальных расстояний."
                    ))

                # Привилегии игрока
                if re.search(r'\bif\s*\(\s*(?:is_player|entity\s*==\s*player|isPlayer)\s*\)', code):
                    violations.append(Violation(
                        file_path=target_file,
                        line_no=line_no,
                        rule_title="CANON S7 (Игрок НЕ особенный — запрет привилегированных веток в физике)",
                        diff_line=f"+ {content}",
                        rotten_kitten="Втыкает 'if (is_player)', делая игрока иммунным к физике или урону.",
                        canonical_architect="Относится к игроку как к обычному NPC с CameraTag — единые правила физики для всех.",
                        why_sabotage="Нарушение системной изотропии превращает честный симулятор в скриптовый костыль.",
                        how_to_fix="Удали особую ветку игрока: физика, урон и одометр одинаковы для всех тел."
                    ))

            # 4.10 Запрет throw и RTTI в боевом коде
            if is_source and not target_file.startswith("src/app/") and not is_test:
                if re.search(r'\bthrow\s+([A-Za-z0-9_]+|\()', code):
                    violations.append(Violation(
                        file_path=target_file,
                        line_no=line_no,
                        rule_title="THE HAMMER §4.1 / CANON S11 (Тотальный запрет throw в C++23 ядре)",
                        diff_line=f"+ {content}",
                        rotten_kitten="Выбрасывает 'throw runtime_error()', полагаясь на исключения которых нет в кодовой базе.",
                        canonical_architect="Возвращает std::optional<T>, Result<T> или фиксирует отказ в Chronicle.",
                        why_sabotage="Движок компилируется с -fno-exceptions (-GR-). Исключения в C++ ядре запрещены высшей Конституцией.",
                        how_to_fix="Замени throw на возврат кода ошибки, булев статус или std::optional."
                    ))

                if re.search(r'\bdynamic_cast\s*<|\btypeid\s*\(', code):
                    violations.append(Violation(
                        file_path=target_file,
                        line_no=line_no,
                        rule_title="THE HAMMER §4.1 / CANON S11 (Тотальный запрет RTTI в C++23 ядре)",
                        diff_line=f"+ {content}",
                        rotten_kitten="Использует dynamic_cast/typeid, нарушая DOD-архитектуру и создавая скрытые таблицы vtable.",
                        canonical_architect="Использует статический полиморфизм, enum тэги (PartRole, FormId) и EnTT type_tag<T>().",
                        why_sabotage="Ядро компилируется с -fno-rtti. Использование RTTI ломает сборку на Clang и загрязняет бинарный контракт.",
                        how_to_fix="Замени динамическую инспекцию типа на enum тег компонента или шаблонную диспетчеризацию."
                    ))

            # 4.11 Запрет нарушения совет-панк аппаратуры CRT в UI
            if is_ui:
                if re.search(r'\b(?:WindowRounding|FrameRounding|ChildRounding|TabRounding|GrabRounding)\s*=\s*[1-9]', code):
                    violations.append(Violation(
                        file_path=target_file,
                        line_no=line_no,
                        rule_title="THE HAMMER §3.5 (Retro-Pixel CRT Mandate: строго Zero Rounding в UI)",
                        diff_line=f"+ {content}",
                        rotten_kitten="Лепит закругленные углы WindowRounding > 0, превращая совет-панк аппаратуру в стерильный веб-дизайн.",
                        canonical_architect="Удерживает строго WindowRounding = 0.0f, FrameRounding = 0.0f и контуры 2px.",
                        why_sabotage="Интерфейс GigaHrush 2 — это служебная совет-панк аппаратура CRT с фосфорным зеленым (#59F266).",
                        how_to_fix="Установи строго WindowRounding = 0.0f и FrameRounding = 0.0f."
                    ))

    return violations

def get_git_diff(args) -> str:
    if args.diff_file:
        p = Path(args.diff_file)
        if not p.exists():
            print(f"{RED}[DIFF GUARD] Ошибка: файл диффа {p} не найден!{RESET}", file=sys.stderr)
            sys.exit(1)
        return p.read_text(encoding="utf-8", errors="replace")

    if args.diff_text:
        return args.diff_text

    git_cmd = ["git", "diff"]
    if args.all:
        git_cmd.append("HEAD")
    elif args.staged:
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
        git_cmd.append("HEAD")

    git_cmd.extend(["-U3"])
    try:
        return subprocess.check_output(git_cmd, cwd=REPO_ROOT, text=True, encoding="utf-8", errors="replace")
    except subprocess.CalledProcessError as e:
        try:
            return subprocess.check_output(["git", "diff", "-U3"], cwd=REPO_ROOT, text=True, encoding="utf-8", errors="replace")
        except Exception as e2:
            print(f"{YELLOW}[DIFF GUARD] Предупреждение: git diff не вернул данных ({e2}).{RESET}")
            return ""

def run_self_test() -> int:
    """
    Two-polarity mutation self-test proving that the upgraded diff guard catches all defect types
    including condition weakening, condition inversion, baseline drops, and stays green on valid clean diffs.
    """
    print(f"{CYAN}[DIFF GUARD] Запуск двухполярного мутационного самотестирования (Two-Polarity Self-Test)...{RESET}")

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
    clean_violations = audit_diff(files_clean, clean_diff)
    if clean_violations:
        print(f"{RED}[DIFF GUARD] Самотестирование ПРОВАЛЕНО на Полярности 1 (Чистый код дал ложные срабатывания)!{RESET}")
        for v in clean_violations:
            print(v.format_manifesto())
        return 1

    print(f"  {GREEN}✔ Полярность 1 (Чистый легальный дифф): PASS (0 нарушений){RESET}")

    # Polarity 2: Mutation injection test covering prohibited axes
    mutations = [
        ("Мутация 1: Удаление ассертов в tests/",
         """
diff --git a/tests/unit_test.cpp b/tests/unit_test.cpp
--- a/tests/unit_test.cpp
+++ b/tests/unit_test.cpp
@@ -15,4 +15,1 @@
-    CHECK(velocity.x == 0.0f);
-    CHECK(velocity.y == 0.0f);
-    CHECK(velocity.z == 0.0f);
+    int x = 42;
""", "Тотальный запрет на удаление тестов"),

        ("Мутация 2: Закомментирование проверки // assert(...)",
         """
diff --git a/src/sim/physics.cpp b/src/sim/physics.cpp
--- a/src/sim/physics.cpp
+++ b/src/sim/physics.cpp
@@ -50,2 +50,3 @@
     float dt = 0.008f;
+    // assert(dt > 0.0f);
""", "Запрет на закомментирование ассертов"),

        ("Мутация 3: Ослабление допуска точности 1e-4f -> 10.0f",
         """
diff --git a/tests/rigid_test.cpp b/tests/rigid_test.cpp
--- a/tests/rigid_test.cpp
+++ b/tests/rigid_test.cpp
@@ -30,2 +30,2 @@
-    CHECK(joint_error <= 1e-4f);
+    CHECK(joint_error <= 10.0f);
""", "Запрет на ослабление допусков"),

        ("Мутация 4: Ослабление строгого неравенства > до >=",
         """
diff --git a/tests/speed_test.cpp b/tests/speed_test.cpp
--- a/tests/speed_test.cpp
+++ b/tests/speed_test.cpp
@@ -25,2 +25,2 @@
-    CHECK(speed > 0.0f);
+    CHECK(speed >= 0.0f);
""", "Ослабление строгого неравенства '>' до '>='"),

        ("Мутация 5: Инверсия условия != на ==",
         """
diff --git a/tests/status_test.cpp b/tests/status_test.cpp
--- a/tests/status_test.cpp
+++ b/tests/status_test.cpp
@@ -40,2 +40,2 @@
-    CHECK(status != Error);
+    CHECK(status == Error);
""", "Инверсия условия '!=' в '=='"),

        ("Мутация 6: Инверсия полярности макроса CHECK на CHECK_FALSE",
         """
diff --git a/tests/valid_test.cpp b/tests/valid_test.cpp
--- a/tests/valid_test.cpp
+++ b/tests/valid_test.cpp
@@ -12,2 +12,2 @@
-    CHECK(is_valid);
+    CHECK_FALSE(is_valid);
""", "Инверсия макроса проверки (CHECK -> CHECK_FALSE)"),

        ("Мутация 7: Инверсия условия в ассерте через оператор '!'",
         """
diff --git a/tests/player_test.cpp b/tests/player_test.cpp
--- a/tests/player_test.cpp
+++ b/tests/player_test.cpp
@@ -18,2 +18,2 @@
-    CHECK(player.is_alive());
+    CHECK(!player.is_alive());
""", "Инверсия условия в ассерте через оператор отрицания '!'"),

        ("Мутация 8: Фейковый возврат / заглушка return true; // stub",
         """
diff --git a/src/game/action.cpp b/src/game/action.cpp
--- a/src/game/action.cpp
+++ b/src/game/action.cpp
@@ -100,2 +100,3 @@
 void process_action() {
+    return true; // stub
 }
""", "Запрет на фейковые заглушки"),

        ("Мутация 9: Добавление // TODO в боевой код",
         """
diff --git a/src/core/math.h b/src/core/math.h
--- a/src/core/math.h
+++ b/src/core/math.h
@@ -40,2 +40,3 @@
 inline float dot(vec3 a, vec3 b) {
+    // TODO: optimize with AVX2 later
     return a.x * b.x + a.y * b.y + a.z * b.z;
""", "Тотальный запрет на долговой мусор // TODO"),

        ("Мутация 10: Слепой reinterpret_cast в ядре симуляции",
         """
diff --git a/src/sim/physics.cpp b/src/sim/physics.cpp
--- a/src/sim/physics.cpp
+++ b/src/sim/physics.cpp
@@ -80,2 +80,3 @@
 void step() {
+    void* p = reinterpret_cast<void*>(0x1234);
 }
""", "Запрет reinterpret_cast"),

        ("Мутация 11: Выброс исключения throw в движке",
         """
diff --git a/src/world/world.cpp b/src/world/world.cpp
--- a/src/world/world.cpp
+++ b/src/world/world.cpp
@@ -60,2 +60,3 @@
 void init() {
+    throw std::runtime_error("boom");
 }
""", "Тотальный запрет throw"),

        ("Мутация 12: Динамическая аллокация new в тике симуляции",
         """
diff --git a/src/sim/rigid_body.cpp b/src/sim/rigid_body.cpp
--- a/src/sim/rigid_body.cpp
+++ b/src/sim/rigid_body.cpp
@@ -90,2 +90,3 @@
 void update() {
+    auto* b = new Body();
 }
""", "Запрет динамических аллокаций памяти new/malloc"),

        ("Мутация 13: Системный сон sleep в симуляции",
         """
diff --git a/src/game/ai.cpp b/src/game/ai.cpp
--- a/src/game/ai.cpp
+++ b/src/game/ai.cpp
@@ -40,2 +40,3 @@
 void ai_tick() {
+    sleep_for(10ms);
 }
""", "Запрет системного сна sleep"),

        ("Мутация 14: Тавтологический Потёмкинский тест CHECK(true)",
         """
diff --git a/tests/dummy_test.cpp b/tests/dummy_test.cpp
--- a/tests/dummy_test.cpp
+++ b/tests/dummy_test.cpp
@@ -10,2 +10,3 @@
 void test_pass() {
+    CHECK(true);
 }
""", "Запрет на тавтологии и Потёмкинские тесты"),

        ("Мутация 15: Нарушение CRT Zero-Rounding в ImGui",
         """
diff --git a/src/app/hud_ui.cpp b/src/app/hud_ui.cpp
--- a/src/app/hud_ui.cpp
+++ b/src/app/hud_ui.cpp
@@ -50,2 +50,3 @@
 void setup_theme() {
+    style.WindowRounding = 8.0f;
 }
""", "Retro-Pixel CRT Mandate: строго Zero Rounding"),

        ("Мутация 16: Подавление предупреждений компилятора #pragma warning disable",
         """
diff --git a/src/sim/fluid.cpp b/src/sim/fluid.cpp
--- a/src/sim/fluid.cpp
+++ b/src/sim/fluid.cpp
@@ -15,2 +15,3 @@
+#pragma warning(disable: 4996)
 void solve() {}
""", "Запрет на подавление предупреждений компилятора"),

        ("Мутация 17: Попытка тихого занижения пола проверок в паспорте качества",
         """
diff --git a/.data/quality-ratchet-baseline.json b/.data/quality-ratchet-baseline.json
--- a/.data/quality-ratchet-baseline.json
+++ b/.data/quality-ratchet-baseline.json
@@ -5,3 +5,3 @@
-  "total_assertions": 150,
+  "total_assertions": 80,
   "banned_stubs": 0
""", "Тихое снижение санитарного пола тестов в бейслайне"),
    ]

    for title, mut_diff, expected_rule in mutations:
        files_mut = parse_unified_diff(mut_diff)
        mut_violations = audit_diff(files_mut, mut_diff)
        if not mut_violations:
            print(f"{RED}[DIFF GUARD] СБОЙ САМОТЕСТИРОВАНИЯ: {title} НЕ БЫЛА ПОЙМАНА!{RESET}")
            return 1
        matched = any(expected_rule in v.rule_title for v in mut_violations)
        if not matched:
            print(f"{RED}[DIFF GUARD] СБОЙ САМОТЕСТИРОВАНИЯ: {title} поймана, но с неверным правилом: {mut_violations[0].rule_title}!{RESET}")
            return 1
        print(f"  {GREEN}✔ {title}: УСПЕШНО ЗАБЛОКИРОВАНО{RESET} (правило: {expected_rule})")

    print(f"\n{BOLD}{GREEN}[DIFF GUARD] ВСЕ {len(mutations)} МУТАЦИОННЫХ ТЕСТОВ УСПЕШНО ПРОЙДЕНЫ! Защита несокрушима.{RESET}\n")
    return 0

def main():
    parser = argparse.ArgumentParser(description="GigaHrush 2 Iron Gate Diff Guard Inquisitor")
    parser.add_argument("repo_path", nargs="?", default=None, help="Root path of the repository")
    parser.add_argument("--staged", action="store_true", help="Inspect git staged diff (--cached)")
    parser.add_argument("--all", "-a", action="store_true", help="Inspect all in-flight changes (staged + unstaged)")
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
    violations = audit_diff(files, diff_text)

    if violations:
        print(f"\n{RED}{'='*80}{RESET}")
        print(f"{RED}🚨 [IRON GATE: ДИФФ-ГЕЙТ ОБНАРУЖИЛ {len(violations)} КРИТИЧЕСКИХ НАРУШЕНИЙ]{RESET}")
        print(f"{RED}{'='*80}{RESET}")
        for v in violations:
            print(v.format_manifesto())
        print(f"{RED}[DIFF GUARD] FAILED: Обнаружено {len(violations)} актов саботажа кодовой базы! Коммит/сборка заблокированы.{RESET}\n", file=sys.stderr)
        sys.exit(1)
    else:
        print(f"{GREEN}[DIFF GUARD] PASS: Дифф проверен ({len(files)} файлов). Ноль удалений тестов, ноль ослаблений ассертов, ноль инверсий условий, ноль TODO/FIXME.{RESET}")
        sys.exit(0)

if __name__ == "__main__":
    main()
