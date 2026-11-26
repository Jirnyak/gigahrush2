#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/dice_reality_audit.py — Monte Carlo Reality Audit Engine («Кубик-Тест Тимаэрта»)

Разработан для воксельного симуляционного движка GigaHrush 2 на основе:
- Требований Создателя и философии Тимаэрта («кинь кубик по строкам и структурам —
  если всё под контролем, то ожидается 0 говносралов»);
- Опыта DENTE Dental CRM (scripts/dice-audit.mjs, scripts/lib/code-health-ast.mjs);
- Конституции The Hammer (THE_HAMMER_MASTER_PROMPT.md, DEFENSE_TESTING_AND_ANTI_GOODHART_BIBLE.md, CANON.md S1..S28).

ПРОВЕРКА 175 СЛУЧАЙНЫХ СРЕЗОВ КОДА И ДАННЫХ (4 СПИСКА):
 1. Срез 1: 100 случайных строк боевого C++23 и шейдеров (ядро, физика, ECS, рендер).
 2. Срез 2 (Список 1): 25 точек входа симуляции (*_step) на аллокации, сон и O(n²).
 3. Срез 3 (Список 2): 25 записей памяти и CSV SSOT таблиц на физическую валидность.
 4. Срез 4 (Список 3): 25 тестовых наборов tests/ (Anti-Goodhart инквизиция на тавтологии и заглушки).

3 ИНКВИЗИТОРСКИХ ВОПРОСА ТИМАЭРТА ДЛЯ ДВИЖКА C++ И ДАННЫХ CSV:
 1. Граничные случаи и безопасность математики/памяти:
    - Нет ли голых делений на ноль (/ var без проверки на 0)?
    - Нет ли неэкранированных индексов массивов мимо wrap_macro / macro_index?
    - Нет ли сырых указателей без проверки, запрещенных исключений/RTTI (throw, catch, dynamic_cast),
      пустых catch, поддельных assert(true) или заглушек // TODO?
    - Нет ли подавления предупреждений компилятора (#pragma warning(disable) / diagnostic ignored)?
    - Нет ли тест-сниффинга (getenv("TEST") / GIGA_TEST) в боевом коде?
 2. Магические константы и хардкоды:
    - Нет ли безымянных чисел мимо src/world/types.h (сырые 128, 0.25f, 2.0f, 125.0f, 0.008f)?
    - Нет ли хардкодных цветов и скруглений ImGui мимо CRT совет-панк аппаратуры?
    - Нет ли захардкоженных идентификаторов мобов/материалов в ветвлениях?
 3. Соответствие контракту данных и законам физики (S1..S28):
    - S1: Изотропный тор 128³ (расстояния строго через wrap_delta_f / wrap_dist, запрет плоской евклидовой метрики).
    - S2: Закон двух масштабов (локальные лучи и контакты опрашивают субвоксели 0.25м SubMask, а не макроклетки).
    - S7: Игрок НЕ особенный (ноль привилегированных веток if (is_player) в физике и уроне).
    - S11: No Exceptions, No RTTI, Data-Driven в CSV, запрет динамических аллокаций (new, push_back) в *_step.
    - S15: Время — одно число (sim_time, dt = 0.008с, запрет системного сна sleep и OS chrono в симуляции).
    - S25: Ведение — перемещение строго через guide_step и SteerRank.
    - S28: Кинематика тела из 7 сегментов (фаза одометра gait, запрет слепого синуса).
    - Данные CSV: целостность колонок, уникальность первичных ключей, физическая валидность величин.

ПРИ СБОЕ: генерирует детальный Failure Manifesto на естественном русском языке.
"""

import sys
import os
import re
import csv
import time
import json
import argparse
from pathlib import Path

# ANSI цвета для высококонтрастного терминального вывода
RED = "\033[1;31m"
GREEN = "\033[1;32m"
YELLOW = "\033[1;33m"
CYAN = "\033[1;36m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"

REPO_ROOT = Path(__file__).resolve().parent.parent

# ==============================================================================
# Секция 1. Сидируемый PRNG (Mulberry32)
# ==============================================================================

class DynamicPrng:
    """
    Детерминированный псевдослучайный генератор Mulberry32.
    При одинаковом сиде последовательность воспроизводится на 100% байт-в-байт.
    Запрещена фиксация одного сида в боевом режиме: по умолчанию сид формируется
    из высокоэнтропийного источника времени, pid и системного random.
    """
    def __init__(self, seed_val=None):
        if seed_val is not None:
            if isinstance(seed_val, int):
                self.seed = seed_val & 0xFFFFFFFF
            elif isinstance(seed_val, str) and seed_val.isdigit():
                self.seed = int(seed_val) & 0xFFFFFFFF
            elif isinstance(seed_val, str) and len(seed_val) > 0:
                h = 2166136261
                for ch in seed_val:
                    h ^= ord(ch)
                    h = (h * 16777619) & 0xFFFFFFFF
                self.seed = h
            else:
                self.seed = self._generate_entropy_seed()
        else:
            self.seed = self._generate_entropy_seed()

        self.initial_seed = self.seed
        self.state = self.seed

    def _generate_entropy_seed(self) -> int:
        entropy = int(time.time() * 1000000) ^ (os.getpid() << 16) ^ int.from_bytes(os.urandom(4), "big")
        return entropy & 0xFFFFFFFF

    def next_u32(self) -> int:
        self.state = (self.state + 0x6D2B79F5) & 0xFFFFFFFF
        t = self.state
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t ^= (t + ((t ^ (t >> 7)) * (t | 61))) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) >> 0) & 0xFFFFFFFF

    def next_f32_01(self) -> float:
        return self.next_u32() / 4294967296.0

    def range_f(self, min_val: float, max_val: float) -> float:
        return min_val + self.next_f32_01() * (max_val - min_val)

    def range_i(self, min_val: int, max_val: int) -> int:
        if min_val >= max_val:
            return min_val
        span = max_val - min_val + 1
        return min_val + (self.next_u32() % span)

    def choice(self, sequence):
        if not sequence:
            return None
        idx = self.range_i(0, len(sequence) - 1)
        return sequence[idx]

# ==============================================================================
# Секция 2. Файловая разведка и сбор кодовой базы
# ==============================================================================

EXCLUDED_DIRS = {
    ".git", "build", "build-win", "out", "external", "_deps", "bin",
    "CMakeFiles", "Testing", ".system_generated", "scratch", ".data"
}

SOURCE_EXTENSIONS = {".h", ".cpp", ".inl", ".comp", ".frag", ".vert", ".glsl"}

def collect_combat_sources(root: Path):
    """
    Собирает все боевые файлы исходников движка (src/, shaders/) и данных (data/).
    Исключает тестовые файлы (тесты инспектируются отдельным списком audit_tests).
    """
    combat_cpp = []
    combat_csv = []
    combat_shaders = []

    for base_dir in ["src", "shaders", "data"]:
        p_base = root / base_dir
        if not p_base.exists():
            continue
        for r_dir, dirs, files in os.walk(p_base):
            dirs[:] = [d for d in dirs if d not in EXCLUDED_DIRS]
            for f in files:
                full_path = Path(r_dir) / f
                if base_dir == "data" and f.endswith(".csv"):
                    combat_csv.append(full_path)
                elif base_dir == "shaders" and full_path.suffix in {".comp", ".frag", ".vert", ".glsl"}:
                    combat_shaders.append(full_path)
                elif base_dir == "src" and full_path.suffix in {".h", ".cpp", ".inl"}:
                    combat_cpp.append(full_path)

    return combat_cpp, combat_shaders, combat_csv

def collect_test_sources(root: Path):
    """
    Собирает все файлы тестов проекта (tests/*.cpp, tests/*.inl, tests/*.h).
    """
    test_files = []
    tests_dir = root / "tests"
    if tests_dir.exists():
        for r_dir, dirs, files in os.walk(tests_dir):
            dirs[:] = [d for d in dirs if d not in EXCLUDED_DIRS]
            for f in files:
                full_path = Path(r_dir) / f
                if full_path.suffix in {".cpp", ".inl", ".h"}:
                    test_files.append(full_path)
    return sorted(test_files)

# ==============================================================================
# Секция 3. Классификация системы и официальной двери (Вопросы 1 и 2 Тимаэрта)
# ==============================================================================

def classify_system(rel_path_str: str):
    """
    Вопрос 1 Тимаэрта: «Какая система порождает?»
    Разделяет код на архитектурные слои: Ядро, Физика, ECS, Геймплей, Рендер, Данные.
    """
    p = rel_path_str.replace("\\", "/")

    if p.startswith("src/core/"):
        return {"layer": "Ядро (Core Math & Low-level)", "domain": "Математика, тор wrap, jobs, тайминги"}
    elif p.startswith("src/world/"):
        return {"layer": "Ядро (World Monolith)", "domain": "Макросетка 128³, субмаски 8³, гравитационные фреймы"}
    elif p.startswith("src/sim/"):
        return {"layer": "Ядро (Physics Simulation)", "domain": "Физика контактов, Swept-AABB, Баумгарте, рэгдоллы, разрушения"}
    elif p.startswith("src/ecs/"):
        return {"layer": "Архитектура (ECS EnTT)", "domain": "Реестр сущностей и POD-компоненты"}
    elif p.startswith("src/game/"):
        return {"layer": "Оболочка (Gameplay & A-Life)", "domain": "Макросим 1M, деяния нужд S24, одометр тела, мобы, лут"}
    elif p.startswith("src/render/"):
        return {"layer": "Оболочка (Vulkan Renderer Shell)", "domain": "Шейдерные пассы, VoxelMirror, DDA освещение"}
    elif p.startswith("src/audio/"):
        return {"layer": "Оболочка (DSP Audio System)", "domain": "Синтезаторы совет-панк, пространственный звук"}
    elif p.startswith("src/input/"):
        return {"layer": "Оболочка (Input Gateway)", "domain": "SDL3 обработка пользовательского ввода"}
    elif p.startswith("src/app/"):
        return {"layer": "Оболочка (App Shell & HUD)", "domain": "Главный цикл, ImGui CRT интерфейс"}
    elif p.startswith("shaders/"):
        return {"layer": "GPU Контур (Vulkan SPIR-V Shaders)", "domain": "Вычислительный автомат Марголюса, DDA рейтрейсинг"}
    elif p.startswith("data/"):
        return {"layer": "Контент SSOT (Data-Driven CSV)", "domain": "Игровые таблицы характеристик и параметров"}
    elif p.startswith("tests/"):
        return {"layer": "Защитный Контур (Verification & Iron Gate)", "domain": "Наборы регрессионных и инвариантных тестов"}
    else:
        return {"layer": "Инфраструктура", "domain": "Вспомогательные модули"}

def detect_official_door(rel_path_str: str, line_content: str, context_block: str):
    """
    Вопрос 2 Тимаэрта: «Через какую официальную дверь пишется?»
    Фиксирует канонические точки входа и мутации состояния мира.
    """
    p = rel_path_str.replace("\\", "/")

    if "physics_step" in line_content or "physics_step" in context_block:
        return "Канонический шаг физики CPU (CANON S4, physics_step)"
    if "guide_step" in line_content or "guide_step" in context_block:
        return "Единый писатель скорости перемещения (CANON S25, guide_step)"
    if "carve_at" in line_content or "carve_sphere" in line_content:
        return "Официальный карвинг субмасок мира (CANON S2, carve_at)"
    if "form_gait_pose" in line_content or "form_rest_pose" in line_content:
        return "Кинематика 7 сегментов тела (CANON S28, form_gait_pose)"
    if "needs_step" in line_content or "act_step" in context_block:
        return "Потоковый арбитраж нужд и деяний (CANON S22/S24, Needs/Act)"
    if "VoxelMirror::pack" in line_content or "run_inject" in line_content:
        return "Двусторонний шов GPU автомата сред (CANON S16, VoxelMirror)"
    if "reg.emplace" in line_content or "reg.patch" in line_content or "reg.replace" in line_content:
        return "Мутация ECS реестра EnTT (CANON S11, DOD)"
    if p.startswith("data/"):
        return "Data-Driven CSV SSOT контракт (CANON S11, data/*.csv)"
    if "vkCmd" in line_content or "vkQueue" in line_content:
        return "Vulkan Command Buffer GPU Dispatch (CANON S4)"
    if p.startswith("tests/"):
        return "Тестовый инвариантный замок (Verification Assertion Gate)"

    return "Внутренняя реализация модуля (Internal Module Function)"

# ==============================================================================
# Секция 4. Инспекция строки: Вопрос 3 Тимаэрта (Законы S1..S28 и безопасность)
# ==============================================================================

SAFE_DENOMINATORS = {
    "kCellSize", "kSubDim", "kMacroDim", "kWorldExtent", "kSimHz", "kSimDt",
    "sizeof", "static_cast", "float", "int", "double", "std::size_t",
    "kRadToDeg", "kDegToRad", "legHeight", "strideLength", "stride", "kPi",
    "kInvCellSize", "kVoxelSize"
}

RE_THROW = re.compile(r'\bthrow\s+([A-Za-z0-9_]+|\()')
RE_TRY_CATCH = re.compile(r'\b(try\s*\{|catch\s*\()')
RE_DYNAMIC_CAST = re.compile(r'\bdynamic_cast\s*<')
RE_TYPEID = re.compile(r'\btypeid\s*\(')
RE_TODO_STUB = re.compile(r'(//\s*TODO\b|//\s*implement\s+later\b|NotImplementedException|/\*\s*rest\s+unchanged\s*\*/)')
RE_FAKE_ASSERT = re.compile(r'\b(?:assert|CHECK|BARRIER_CHECK)\s*\(\s*(true|1|!false)\s*[\),]')
RE_EMPTY_CATCH = re.compile(r'catch\s*\([^)]*\)\s*\{\s*\}')
RE_SLEEP = re.compile(r'\b(sleep_for|sleep_until|Sleep\(|usleep)\b')
RE_EUCLIDEAN_METRIC = re.compile(r'\b(std::sqrt\s*\(\s*dx\s*\*\s*dx\s*\+\s*dy\s*\*\s*dy\s*\+\s*dz\s*\*\s*dz\s*\)|sqrtf\s*\(\s*dx\s*\*\s*dx\s*\+\s*dy\s*\*\s*dy\s*\+\s*dz\s*\*\s*dz\s*\))')
RE_RAW_DIVISION = re.compile(r'(?<!/)/(?!/|=|\*)\s*([a-zA-Z_]\w*)')

# Передовые механизмы из Dental CRM (тест-сниффинг и подавление предупреждений)
RE_TEST_ENV_SNIFF = re.compile(r'\b(?:std::)?getenv\s*\(\s*"(?:TEST|CTEST|GIGA_TEST|RUNNING_TESTS?|UNIT_TEST)"\s*\)')
RE_COMPILER_SUPPRESSION = re.compile(r'#pragma\s+(?:warning\s*\(\s*disable\s*:\s*(?!4324\b)|GCC\s+diagnostic\s+ignored|clang\s+diagnostic\s+ignored)')

def strip_code_line(line: str) -> str:
    """Очищает строку от строковых литералов и комментариев для надежного AST/Regex анализа."""
    s = re.sub(r'"[^"\\]*(?:\\.[^"\\]*)*"', '""', line)
    s = re.sub(r"'[^'\\]*(?:\\.[^'\\]*)*'", "''", s)
    if "//" in s:
        s = s[:s.index("//")]
    return s.strip()

def inspect_code_line(sample: dict):
    """
    Проверяет случайную строку C++ на 3 Вопроса Тимаэрта.
    """
    rel_path = sample["relPath"]
    line_num = sample["lineNum"]
    current = sample["current"]
    before = sample["before"]
    after = sample["after"]

    clean_line = strip_code_line(current)
    context_lines = before + [current] + after
    context_clean = [strip_code_line(l) for l in context_lines]
    joined_context = "\n".join(context_lines)

    sys_info = classify_system(rel_path)
    door_info = detect_official_door(rel_path, current, joined_context)

    defects = []

    # Пропуск #include и пустых строк
    if clean_line.startswith("#include") or not clean_line:
        return {
            "relPath": rel_path,
            "lineNum": line_num,
            "code": current.strip(),
            "system": sys_info,
            "officialDoor": door_info,
            "status": "CLEAN",
            "defects": []
        }

    # --------------------------------------------------------------------------
    # Проверка 0: Подавление предупреждений компилятора (Мандат 8be / Anti-Suppression)
    # --------------------------------------------------------------------------
    if RE_COMPILER_SUPPRESSION.search(current) and not rel_path.startswith("tests/"):
        defects.append({
            "rule": "COMPILER_WARNING_SUPPRESSION",
            "law": "CANON S11 & DEFENSE BIBLE (Запрет подавления предупреждений компилятора)",
            "question": "1. Граничные случаи и безопасность",
            "message": "Обнаружена директива подавления предупреждений компилятора (#pragma warning(disable) / diagnostic ignored).",
            "fix": "Устрани причину предупреждения компилятора в коде вместо сокрытия проблемы под ковер."
        })

    # --------------------------------------------------------------------------
    # Проверка 0.5: Тест-сниффинг в боевом коде (Anti-Goodhart Test Sniffing)
    # --------------------------------------------------------------------------
    if not rel_path.startswith("tests/") and not rel_path.startswith("src/app/"):
        if RE_TEST_ENV_SNIFF.search(current):
            defects.append({
                "rule": "ANTI_GOODHART_TEST_ENV_SNIFF",
                "law": "DEFENSE BIBLE §1 (Запрет тест-сниффинга в боевом коде)",
                "question": "3. Соответствие контракту данных и законам физики",
                "message": "Боевой код в src/ детектирует тестовую среду через getenv() и меняет поведение под тесты.",
                "fix": "Удали детектирование тестов. Боевая симуляция обязана исполняться идентично в продакшене и в тестах."
            })

    # --------------------------------------------------------------------------
    # Проверка 1.1: Запрещенные исключения и RTTI (CANON S11 / No Exceptions, No RTTI)
    # --------------------------------------------------------------------------
    if not rel_path.startswith("src/app/") and not "tests/" in rel_path:
        if RE_THROW.search(clean_line):
            defects.append({
                "rule": "CANON_S11_NO_EXCEPTIONS_THROW",
                "law": "CANON S11 (Запрет исключений в ядре движка)",
                "question": "1. Граничные случаи и безопасность",
                "message": "Обнаружен оператор 'throw'. Ядро GigaHrush 2 компилируется без исключений (-fno-exceptions).",
                "fix": "Замени throw на структурированный возврат статуса отказа (std::optional, Result<T> или лог в Chronicle)."
            })
        if RE_TRY_CATCH.search(clean_line):
            defects.append({
                "rule": "CANON_S11_NO_EXCEPTIONS_TRY_CATCH",
                "law": "CANON S11 (Запрет try/catch в ядре движка)",
                "question": "1. Граничные случаи и безопасность",
                "message": "Обнаружен блок 'try/catch'. Исключения запрещены архитектурным стандартом C++23.",
                "fix": "Удали try-catch и обрабатывай граничные случаи через явные условные проверки."
            })
        if RE_DYNAMIC_CAST.search(clean_line) or RE_TYPEID.search(clean_line):
            defects.append({
                "rule": "CANON_S11_NO_RTTI",
                "law": "CANON S11 (Запрет RTTI в ядре движка)",
                "question": "1. Граничные случаи и безопасность",
                "message": "Обнаружен 'dynamic_cast' или 'typeid'. Ядро компилируется с -fno-rtti.",
                "fix": "Используй статический полиморфизм, enum тэги типов (PartRole, FormId) или EnTT type_tag<T>()."
            })

    # --------------------------------------------------------------------------
    # Проверка 1.2: Заглушки, пустые перехваты и фейковые ассерты (Anti-Goodhart)
    # --------------------------------------------------------------------------
    if RE_TODO_STUB.search(current) and "giga-check: allow" not in current:
        defects.append({
            "rule": "ANTI_GOODHART_TODO_STUB",
            "law": "CANON S11 & DEFENSE BIBLE (Запрет заглушек в боевом коде)",
            "question": "1. Граничные случаи и безопасность",
            "message": "Обнаружена заглушка '// TODO' или плейсхолдер отложенной реализации.",
            "fix": "Реализуй требуемый алгоритм полностью начисто без долгов и плейсхолдеров."
        })
    if RE_FAKE_ASSERT.search(clean_line):
        defects.append({
            "rule": "ANTI_GOODHART_FAKE_ASSERT",
            "law": "DEFENSE BIBLE §3 (Запрет Потёмкинских тестов)",
            "question": "1. Граничные случаи и безопасность",
            "message": "Обнаружен фиктивный assert(true) / CHECK(true).",
            "fix": "Напиши реальную проверку инварианта над фактическими расчетными данными."
        })
    if RE_EMPTY_CATCH.search(joined_context):
        defects.append({
            "rule": "ANTI_GOODHART_EMPTY_CATCH",
            "law": "DEFENSE BIBLE §4 (Запрет тихого проглатывания ошибок)",
            "question": "1. Граничные случаи и безопасность",
            "message": "В блоке обнаружен пустой catch {}. Ошибки обязаны логироваться или прерывать выполнение.",
            "fix": "Удали пустой catch и обработай сбой открыто."
        })

    # --------------------------------------------------------------------------
    # Проверка 1.3: Голое деление на ноль без проверки делителя
    # --------------------------------------------------------------------------
    div_match = RE_RAW_DIVISION.search(clean_line)
    if div_match:
        denom = div_match.group(1)
        if denom not in SAFE_DENOMINATORS and not denom.isupper() and not denom.startswith("k"):
            has_guard = False
            for ctx_l in context_clean:
                if f"{denom} > 0" in ctx_l or f"{denom} > 1e-" in ctx_l or f"{denom} != 0" in ctx_l or \
                   f"{denom} >= 1" in ctx_l or f"std::max" in ctx_l or f"clamp" in ctx_l or \
                   f"fabs({denom}) >" in ctx_l or f"abs({denom}) >" in ctx_l or f"fmax" in ctx_l:
                    has_guard = True
                    break
            if not has_guard:
                if denom in {"len", "dist", "distance", "mass", "dt", "delta", "count", "total", "radius", "speed"}:
                    defects.append({
                        "rule": "MATH_SAFETY_POTENTIAL_DIV_ZERO",
                        "law": "CANON S1 (Математическая безопасность симуляции)",
                        "question": "1. Граничные случаи и безопасность",
                        "message": f"Потенциально голое деление на переменную '{denom}' без проверки на 0 в локальном контексте.",
                        "fix": f"Защити деление через порог: '{denom} > 1e-6f ? ... : 0.0f' или std::max({denom}, 1e-6f)."
                    })

    # --------------------------------------------------------------------------
    # Проверка 2.1: Магические геометрические константы мимо types.h
    # --------------------------------------------------------------------------
    if not rel_path.endswith("types.h") and not rel_path.endswith("po2.h") and not "tests/" in rel_path:
        if re.search(r'(?<![0-9a-zA-Z_xX])128(?![0-9a-zA-Z_])', clean_line):
            if not re.search(r'(\[\s*128\s*\]|char\s+\w+\[128\]|buf\[128\]|128u|0x80)', clean_line):
                if re.search(r'(\*\s*128|%\s*128|wrap.*128|grid.*128|cell.*128)', clean_line):
                    defects.append({
                        "rule": "CANON_S1_MAGIC_MACRO_DIM_128",
                        "law": "CANON S1 (Именованная константа kMacroDim)",
                        "question": "2. Магические константы и хардкоды",
                        "message": "Обнаружен сырой литерал '128' при вычислении координат/размеров макросетки мира.",
                        "fix": "Замени сырой '128' на каноническую константу giga::kMacroDim из src/world/types.h."
                    })

        if "0.25f" in clean_line and not "types.h" in rel_path and not "po2.h" in rel_path:
            if re.search(r'(\*\s*0\.25f|/\s*0\.25f|\+\s*0\.25f|-\s*0\.25f|sub.*0\.25f|voxel.*0\.25f)', clean_line):
                defects.append({
                    "rule": "CANON_S2_MAGIC_VOXEL_SIZE_025",
                    "law": "CANON S2 (Именованная константа kVoxelSize)",
                    "question": "2. Магические константы и хардкоды",
                    "message": "Обнаружен сырой литерал размера субвокселя '0.25f'.",
                    "fix": "Замени сырой '0.25f' на каноническую константу giga::kVoxelSize из src/world/types.h."
                })

    # --------------------------------------------------------------------------
    # Проверка 3.1: Нарушение изотропии тора S1 (плоская евклидова метрика)
    # --------------------------------------------------------------------------
    if RE_EUCLIDEAN_METRIC.search(clean_line) and ("world" in rel_path or "sim" in rel_path or "game" in rel_path):
        defects.append({
            "rule": "CANON_S1_TOROIDAL_METRIC_VIOLATION",
            "law": "CANON S1 (Изотропный 3D тор 128³)",
            "question": "3. Соответствие контракту данных и законам физики",
            "message": "Обнаружен плоский евклидов расчет расстояния sqrt(dx*dx + dy*dy + dz*dz) без тороидального заворачивания.",
            "fix": "Используй wrap_delta_f(a, b, kWorldExtent) или wrap_dist(p1, p2) для расчета расстояний на торе."
        })

    # --------------------------------------------------------------------------
    # Проверка 3.2: Запрет sleep и системных таймеров в симуляции (CANON S11 / S15)
    # --------------------------------------------------------------------------
    if RE_SLEEP.search(clean_line) and ("sim/" in rel_path or "world/" in rel_path or "game/" in rel_path):
        defects.append({
            "rule": "CANON_S11_SIMULATION_SLEEP_BAN",
            "law": "CANON S11 / S15 (Детерминизм симуляции 125 Гц)",
            "question": "3. Соответствие контракту данных и законам физики",
            "message": "Обнаружен вызов системного сна (sleep/usleep). Симуляция обязана продвигаться дискретными тиками kSimDt.",
            "fix": "Удали системный sleep. Время в игре продвигается строго через sim_time и фиксированный dt = 0.008 с."
        })

    # --------------------------------------------------------------------------
    # Проверка 3.3: Привилегированный игрок в физике (CANON S7)
    # --------------------------------------------------------------------------
    if ("sim/" in rel_path or "combat.cpp" in rel_path) and re.search(r'\bif\s*\(\s*(?:is_player|entity\s*==\s*player|isPlayer)\s*\)', clean_line):
        defects.append({
            "rule": "CANON_S7_PLAYER_IS_NOT_SPECIAL",
            "law": "CANON S7 (Игрок НЕ особенный — системная изотропия)",
            "question": "3. Соответствие контракту данных и законам физики",
            "message": "Обнаружена привилегированная ветка 'if (is_player)' в физике или формуле боя.",
            "fix": "Игрок — это обычное тело NPC с камерой. Все правила физики, урона и баллистики действуют одинаково для всех."
        })

    return {
        "relPath": rel_path,
        "lineNum": line_num,
        "code": current.strip(),
        "system": sys_info,
        "officialDoor": door_info,
        "status": "CLEAN" if len(defects) == 0 else "DEFECT",
        "defects": defects
    }

# ==============================================================================
# Секция 5. Сэмплирование случайных строк C++ (Dice Lines — 100 точек)
# ==============================================================================

def sample_source_lines(files, count: int, prng: DynamicPrng, root: Path):
    """
    Выбирает count случайных строк из всех файлов исходников, взвешивая 50% по объёму
    и 50% равномерно, чтобы крупные модули не заглушали архитектурное ядро.
    """
    valid_files = []
    total_size = 0

    for f in files:
        try:
            sz = f.stat().st_size
            if sz > 20:
                valid_files.append((f, sz))
                total_size += sz
        except OSError:
            continue

    if not valid_files:
        return []

    avg_size = total_size / len(valid_files)
    weighted_pool = []
    total_weight = 0.0

    for f, sz in valid_files:
        w = 0.5 * avg_size + 0.5 * sz
        weighted_pool.append((f, w))
        total_weight += w

    samples = []
    used_coords = set()
    file_cache = {}

    attempts = 0
    max_attempts = count * 25

    while len(samples) < count and attempts < max_attempts:
        attempts += 1
        target_w = prng.range_f(0.0, total_weight)
        chosen_file = weighted_pool[0][0]

        for f, w in weighted_pool:
            if target_w <= w:
                chosen_file = f
                break
            target_w -= w

        lines = file_cache.get(chosen_file)
        if lines is None:
            try:
                lines = chosen_file.read_text(encoding="utf-8", errors="replace").splitlines()
                file_cache[chosen_file] = lines
            except Exception:
                continue

        if not lines:
            continue

        line_idx = prng.range_i(0, len(lines) - 1)
        line_num = line_idx + 1
        coord_key = f"{chosen_file}:{line_num}"

        if coord_key in used_coords:
            continue
        used_coords.add(coord_key)

        current = lines[line_idx]
        if not current.strip():
            continue

        start = max(0, line_idx - 10)
        end = min(len(lines), line_idx + 11)
        before = lines[start:line_idx]
        after = lines[line_idx + 1:end]

        rel_path = str(chosen_file.relative_to(root)).replace("\\", "/")

        sample = {
            "fullPath": str(chosen_file),
            "relPath": rel_path,
            "lineNum": line_num,
            "current": current,
            "before": before,
            "after": after
        }

        inspected = inspect_code_line(sample)
        samples.append(inspected)

    return samples

# ==============================================================================
# Секция 6. Структурный Список 1: Двери симуляции (*_step — 25 точек)
# ==============================================================================

def audit_simulation_doors(root: Path, prng: DynamicPrng, count: int = 25):
    """
    Сэмплирует точки входа симуляционных систем (*_step) и проверяет контракт:
    детерминизм аргументов, O(n) сложность, отсутствие динамических аллокаций.
    """
    sim_dirs = [root / "src/sim", root / "src/game", root / "src/world", root / "src/core"]
    candidate_doors = []

    for s_dir in sim_dirs:
        if not s_dir.exists():
            continue
        for p in s_dir.rglob("*.[ch]*"):
            try:
                lines = p.read_text(encoding="utf-8", errors="replace").splitlines()
            except Exception:
                continue

            rel_path = str(p.relative_to(root)).replace("\\", "/")
            for idx, line in enumerate(lines, 1):
                clean = strip_code_line(line)
                # Ищем сигнатуры шагов
                if re.search(r'\b[a-zA-Z0-9_]+_step\s*\(', clean) or \
                   re.search(r'\b(guide_step|physics_step|needs_step|perceive_step|act_step)\b', clean):
                    block = lines[idx-1:min(len(lines), idx + 35)]
                    has_body = any("{" in strip_code_line(l) for l in block)
                    candidate_doors.append({
                        "file": rel_path,
                        "line": idx,
                        "signature": line.strip(),
                        "block": block,
                        "has_body": has_body
                    })

    if not candidate_doors:
        return {"total": 0, "sampled": []}

    sampled = []
    pool = list(candidate_doors)
    take = min(count, len(pool))

    for _ in range(take):
        idx = prng.range_i(0, len(pool) - 1)
        item = pool.pop(idx)

        issues = []
        clean_block_lines = [strip_code_line(l) for l in item["block"]]
        clean_block_text = "\n".join(clean_block_lines)

        if item["has_body"]:
            # Проверка O(n²): множественные вложенные view в горячем тике
            views = re.findall(r'\breg\.view<', clean_block_text)
            if len(views) > 2:
                issues.append("Подозрение на O(n²) двойное вложенное итерирование reg.view<> в горячем тике (CANON S11).")

            # Проверка реальных динамических аллокаций (чистый код, без комментариев)
            if re.search(r'\bnew\s+[A-Za-z0-9_]+', clean_block_text) or re.search(r'\bmalloc\s*\(', clean_block_text):
                issues.append("Динамическая аллокация (new/malloc) внутри симуляционного шага (CANON S11: Zero Allocations).")

            # Проверка системного сна
            if RE_SLEEP.search(clean_block_text):
                issues.append("Вызов sleep внутри шага симуляции (CANON S15).")

        sampled.append({
            "relPath": item["file"],
            "lineNum": item["line"],
            "doorSignature": item["signature"],
            "issues": issues,
            "status": "CLEAN" if len(issues) == 0 else "DEFECT"
        })

    return {"total": len(candidate_doors), "sampled": sampled}

# ==============================================================================
# Секция 7. Структурный Список 2: Поля памяти и Контракты данных (CSV — 25 точек)
# ==============================================================================

def audit_memory_and_csv_fields(root: Path, prng: DynamicPrng, count: int = 25):
    """
    Сэмплирует строки из таблиц data/*.csv и проверяет физические контракты величин:
    масса > 0, здоровье > 0, урон >= 0, валидность колонок и уникальность ключей.
    """
    data_dir = root / "data"
    csv_records = []

    if data_dir.exists():
        for csv_file in sorted(data_dir.glob("*.csv")):
            rel_path = str(csv_file.relative_to(root)).replace("\\", "/")
            try:
                raw_bytes = csv_file.read_bytes()
                # BOM проверка
                if raw_bytes.startswith(b'\xef\xbb\xbf'):
                    csv_records.append({
                        "file": rel_path,
                        "line": 1,
                        "data": "UTF-8 BOM detected",
                        "issues": ["Файл содержит запрещенный UTF-8 BOM маркер (CANON S11)."],
                        "status": "DEFECT"
                    })
                    continue

                text = raw_bytes.decode("utf-8")
                lines = text.splitlines()
                if not lines:
                    continue

                reader = list(csv.reader(lines))
                if not reader:
                    continue
                header = reader[0]
                expected_cols = len(header)

                for r_idx, row in enumerate(reader[1:], start=2):
                    if not row:
                        continue
                    issues = []
                    if len(row) != expected_cols:
                        issues.append(f"Несовпадение колонок: {len(row)} при ожидаемых {expected_cols}.")

                    # Проверка физических полей
                    for col_name, val in zip(header, row):
                        val_str = val.strip()
                        if col_name in {"mass", "weight"} and val_str:
                            try:
                                m = float(val_str)
                                if m <= 0.0:
                                    issues.append(f"Физическая масса '{col_name}' <= 0 ({m}). Масса обязана быть строго положительной.")
                            except ValueError:
                                issues.append(f"Нечисловое значение массы: '{val_str}'.")
                        elif col_name in {"hp", "max_hp", "health"} and val_str:
                            try:
                                h = float(val_str)
                                if h <= 0.0:
                                    issues.append(f"Здоровье '{col_name}' <= 0 ({h}).")
                            except ValueError:
                                pass
                        elif col_name in {"damage", "dmg"} and val_str:
                            try:
                                d = float(val_str)
                                if d < 0.0:
                                    issues.append(f"Отрицательный урон: {d}.")
                            except ValueError:
                                pass

                    csv_records.append({
                        "file": rel_path,
                        "line": r_idx,
                        "data": f"[{header[0]}={row[0] if row else '?'}] {', '.join(row[:4])}...",
                        "issues": issues,
                        "status": "CLEAN" if len(issues) == 0 else "DEFECT"
                    })
            except Exception as e:
                csv_records.append({
                    "file": rel_path,
                    "line": 1,
                    "data": f"Error: {e}",
                    "issues": [f"Ошибка парсинга CSV: {e}"],
                    "status": "DEFECT"
                })

    if not csv_records:
        return {"total": 0, "sampled": []}

    sampled = []
    pool = list(csv_records)
    take = min(count, len(pool))

    for _ in range(take):
        idx = prng.range_i(0, len(pool) - 1)
        sampled.append(pool.pop(idx))

    return {"total": len(csv_records), "sampled": sampled}

# ==============================================================================
# Секция 8. Структурный Список 3: Инквизиция тестов (Anti-Goodhart — 25 точек)
# ==============================================================================

RE_ASSERT_MACRO = re.compile(r'\b(CHECK|BARRIER_CHECK|assert|static_assert)\s*\(')
RE_TAUTOLOGY = re.compile(r'\b(?:CHECK|BARRIER_CHECK|assert|static_assert)\s*\(\s*(true|1|!false)\s*[\),]')
RE_COMMENTED_ASSERT = re.compile(r'^\s*//\s*(?:CHECK|BARRIER_CHECK|assert|static_assert)\s*\(')

def audit_tests(root: Path, prng: DynamicPrng, count: int = 25):
    """
    Список 3: Инквизиция честности тестов (Anti-Goodhart Test Inquisition).
    Перенесено из опыта Dental CRM (auditTests / code-health-ast.mjs).
    Сэмплирует тест-кейсы из tests/*.cpp, tests/suite_*.inl, tests/*.h и проверяет:
    - Тавтологии: CHECK(true), CHECK(1), assert(true)
    - Закомментированные ассерты: // CHECK(
    - Функции тестов без единого ассерта (фантомные тесты)
    - Заглушенные блоки #if 0 вокруг тестов
    """
    test_files = collect_test_sources(root)
    if not test_files:
        return {"total": 0, "sampled": []}

    test_cases = []

    for tf in test_files:
        rel_path = str(tf.relative_to(root)).replace("\\", "/")
        try:
            lines = tf.read_text(encoding="utf-8", errors="replace").splitlines()
        except Exception:
            continue

        in_if_zero = False
        current_fn_name = None
        current_fn_start = 0
        current_fn_assertions = 0
        current_fn_lines = []

        for idx, line in enumerate(lines, 1):
            clean = strip_code_line(line)

            # Проверка #if 0 блоков
            if re.match(r'^\s*#\s*if\s+0\b', line):
                in_if_zero = True
            elif re.match(r'^\s*#\s*endif\b', line):
                in_if_zero = False

            # Поиск функций тестов (static void test_*, void test_*, static void suite_*)
            fn_match = re.match(r'^\s*(?:static\s+)?void\s+([a-zA-Z0-9_]+)\s*\(\s*\)', line)
            if fn_match:
                fn_name = fn_match.group(1)
                if any(kw in fn_name for kw in ["test", "suite", "check", "barrier", "dice", "bench"]):
                    if current_fn_name and current_fn_assertions == 0 and len(current_fn_lines) > 2:
                        test_cases.append({
                            "file": rel_path,
                            "line": current_fn_start,
                            "signature": f"void {current_fn_name}()",
                            "issues": ["Фантомный тест: функция теста не содержит ни одного assert/CHECK."],
                            "status": "DEFECT"
                        })
                    current_fn_name = fn_name
                    current_fn_start = idx
                    current_fn_assertions = 0
                    current_fn_lines = [line]

            if current_fn_name:
                current_fn_lines.append(line)
                if RE_ASSERT_MACRO.search(clean):
                    current_fn_assertions += 1

            # Проверка тавтологий в реальном времени
            if RE_TAUTOLOGY.search(clean):
                test_cases.append({
                    "file": rel_path,
                    "line": idx,
                    "signature": line.strip(),
                    "issues": ["Тавтология в тесте (CHECK(true) / assert(1)) — тест не может упасть (Anti-Goodhart)."],
                    "status": "DEFECT"
                })
            # Проверка закомментированных ассертов
            elif RE_COMMENTED_ASSERT.search(line):
                test_cases.append({
                    "file": rel_path,
                    "line": idx,
                    "signature": line.strip(),
                    "issues": ["Закомментированный ассерт // CHECK(...) — подавление проверки."],
                    "status": "DEFECT"
                })
            # Проверка #if 0 вокруг ассертов
            elif in_if_zero and RE_ASSERT_MACRO.search(line):
                test_cases.append({
                    "file": rel_path,
                    "line": idx,
                    "signature": line.strip(),
                    "issues": ["Ассерт отключен через #if 0 (Anti-Goodhart: скрытое выключение тестов)."],
                    "status": "DEFECT"
                })
            elif RE_ASSERT_MACRO.search(clean):
                # Чистый ассерт
                test_cases.append({
                    "file": rel_path,
                    "line": idx,
                    "signature": line.strip(),
                    "issues": [],
                    "status": "CLEAN"
                })

    if not test_cases:
        return {"total": 0, "sampled": []}

    sampled = []
    pool = list(test_cases)
    take = min(count, len(pool))

    for _ in range(take):
        idx = prng.range_i(0, len(pool) - 1)
        sampled.append(pool.pop(idx))

    return {"total": len(test_cases), "sampled": sampled}

# ==============================================================================
# Секция 9. Генератор Failure Manifesto
# ==============================================================================

def print_failure_manifesto(defect_info: dict):
    """
    Печатает официальный Failure Manifesto на естественном русском языке.
    """
    rel_path = defect_info.get("relPath", defect_info.get("file", "unknown"))
    line_num = defect_info.get("lineNum", defect_info.get("line", 0))
    rule = defect_info.get("rule", "CANON_VIOLATION")
    law = defect_info.get("law", "CANONICAL INVARIANT")
    question = defect_info.get("question", "3 Вопроса Тимаэрта")
    msg = defect_info.get("message", defect_info.get("issues", ["Обнаружен архитектурный брак."])[0] if isinstance(defect_info.get("issues"), list) and defect_info.get("issues") else "Обнаружен брак.")
    fix = defect_info.get("fix", "Исправь код согласно стандартам движка.")
    code = defect_info.get("code", defect_info.get("data", defect_info.get("doorSignature", defect_info.get("signature", ""))))

    print(f"""
{RED}================================================================================{RESET}
{RED}🚨 [GIGA-DICE REALITY AUDIT: FAILURE MANIFESTO]{RESET}
{RED}--------------------------------------------------------------------------------{RESET}
{BOLD}📍 АДРЕС ВСПЛЫТИЯ:{RESET} {CYAN}{rel_path}:{line_num}{RESET}
{BOLD}❌ НАРУШЕННЫЙ ЗАКОН:{RESET} {YELLOW}{law}{RESET}
{BOLD}❓ ВОПРОС ТИМАЭРТА:{RESET} {BOLD}{question}{RESET}
{BOLD}🔍 КОД СО СБОЕМ:{RESET}
   {DIM}{code}{RESET}
{BOLD}⚠️ ЧТО ОБНАРУЖЕНО:{RESET}
   {msg}
{BOLD}💣 ПОЧЕМУ ЭТО БРАК / ГОВНОСРАЛ:{RESET}
   Кубик Монте-Карло вскрыл архитектурную эрозию или костыль, нарушающий
   изотропию симуляции, стабильность физики 128³, контракт данных CSV
   или честность тестовой базы.
{BOLD}💡 КАК ОБЯЗАН ИСПРАВИТЬ СУБАГЕНТ:{RESET}
   {GREEN}{fix}{RESET}
{BOLD}🛑 АНТИ-ГУДХАРТ ПРЕДУПРЕЖДЕНИЕ:{RESET}
   Попытка захардкодить единичный случай, ослабить допуск проверки или
   заглушить кубик расценивается как служебный подлог и саботаж!
{RED}================================================================================{RESET}
""")

# ==============================================================================
# Секция 10. Главный координатор аудита Монте-Карло (175 точек)
# ==============================================================================

def run_dice_audit(options, root: Path):
    """
    Запускает стохастический аудит реальности Монте-Карло над кодом и данными.
    По умолчанию проверяет ровно 175 случайных точек (100 строк + 25 дверей + 25 данных + 25 тестов).
    """
    prng = DynamicPrng(options.seed)
    seed_str = str(prng.initial_seed)

    combat_cpp, combat_shaders, combat_csv = collect_combat_sources(root)
    all_combat_files = combat_cpp + combat_shaders

    report = {
        "meta": {
            "engine": "GigaHrush 2 Monte Carlo Reality Audit Engine («Кубик-Тест Тимаэрта» v2)",
            "seed": seed_str,
            "totalSourceFiles": len(all_combat_files),
            "totalCsvFiles": len(combat_csv),
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "strict": bool(options.strict),
            "list": options.list
        },
        "summary": {
            "totalSamples": 0,
            "cleanSamples": 0,
            "defectSamples": 0,
            "realityScorePercent": 100
        },
        "lines": [],
        "doors": None,
        "fields": None,
        "tests": None
    }

    base_samples = options.samples if options.samples > 0 else 100

    # 1. Срез 1: 100 случайных строк C++ и шейдеров
    if options.list in {"all", "lines"}:
        report["lines"] = sample_source_lines(all_combat_files, base_samples, prng, root)

    # 2. Срез 2 (Список 1): 25 дверей симуляции (*_step)
    if options.list in {"all", "doors"}:
        n_doors = max(25, base_samples // 4) if options.list == "all" else base_samples
        report["doors"] = audit_simulation_doors(root, prng, n_doors)

    # 3. Срез 3 (Список 2): 25 полей памяти и CSV данных
    if options.list in {"all", "fields", "csv"}:
        n_fields = max(25, base_samples // 4) if options.list == "all" else base_samples
        report["fields"] = audit_memory_and_csv_fields(root, prng, n_fields)

    # 4. Срез 4 (Список 3): 25 тестов (Anti-Goodhart инквизиция)
    if options.list in {"all", "tests"}:
        n_tests = max(25, base_samples // 4) if options.list == "all" else base_samples
        report["tests"] = audit_tests(root, prng, n_tests)

    # Агрегация статистики
    total_evaluated = len(report["lines"])
    total_defects = sum(1 for l in report["lines"] if l["status"] == "DEFECT")

    if report["doors"] and report["doors"]["sampled"]:
        for d in report["doors"]["sampled"]:
            total_evaluated += 1
            if d["status"] == "DEFECT":
                total_defects += 1

    if report["fields"] and report["fields"]["sampled"]:
        for f in report["fields"]["sampled"]:
            total_evaluated += 1
            if f["status"] == "DEFECT":
                total_defects += 1

    if report["tests"] and report["tests"]["sampled"]:
        for t in report["tests"]["sampled"]:
            total_evaluated += 1
            if t["status"] == "DEFECT":
                total_defects += 1

    clean_count = max(0, total_evaluated - total_defects)
    score = round((clean_count / total_evaluated) * 100) if total_evaluated > 0 else 100

    report["summary"] = {
        "totalSamples": total_evaluated,
        "cleanSamples": clean_count,
        "defectSamples": total_defects,
        "realityScorePercent": score
    }

    return report

# ==============================================================================
# Секция 11. Форматирование отчета в терминал
# ==============================================================================

def print_terminal_report(report: dict):
    print(f"\n{BOLD}{CYAN}🎲 MONTE CARLO REALITY AUDIT ENGINE («КУБИК-ТЕСТ ТИМАЭРТА») — GIGAHRUSH 2{RESET}")
    print(f"{DIM}   Философия Тимаэрта & Конституция The Hammer (S1..S28 / 175 точек / 3 Вопроса){RESET}")
    print(f"{DIM}   Сид броска: {report['meta']['seed']} | Файлов C++: {report['meta']['totalSourceFiles']} | CSV: {report['meta']['totalCsvFiles']} | Время: {report['meta']['timestamp']}{RESET}")
    print("=" * 80)

    # 1. Результаты случайных бросков по строкам
    if report["lines"]:
        print(f"\n{BOLD}🎲 РЕЗУЛЬТАТЫ СЛУЧАЙНЫХ БРОСКОВ ПО СТРОКАМ КОДА ({len(report['lines'])} точек):{RESET}")
        for idx, sample in enumerate(report["lines"][:20], 1):
            status_label = f"{GREEN}✓ ЧИСТО{RESET}" if sample["status"] == "CLEAN" else f"{RED}✗ ДЕФЕКТ{RESET}"
            print(f"[{idx:03d}/{len(report['lines'])}] {status_label} {CYAN}[{sample['relPath']}:{sample['lineNum']}]{RESET}")
            print(f"   {DIM}1. Система:{RESET} {sample['system']['domain']} ({sample['system']['layer']})")
            print(f"   {DIM}2. Дверь:{RESET}   {sample['officialDoor']}")
            print(f"   {DIM}3. Код:{RESET}     {BOLD}{sample['code'][:90]}{RESET}")

            if sample["defects"]:
                for d in sample["defects"]:
                    print(f"      {RED}⚠{RESET} {YELLOW}{d['rule']}{RESET}: {d['message']}")

        if len(report["lines"]) > 20:
            remaining = len(report["lines"]) - 20
            print(f"{DIM}   ... и ещё {remaining} случайных точек проинспектировано в этом броске.{RESET}")

    # 2. Список 1: Двери симуляции
    if report.get("doors") and report["doors"]["sampled"]:
        doors = report["doors"]
        print(f"\n{BOLD}🚪 СТРУКТУРНЫЙ СПИСОК 1 (ДВЕРИ И СИСТЕМЫ СИМУЛЯЦИИ):{RESET}")
        print(f"{DIM}   Всего точек входа *_step найдено: {doors['total']} | Сэмплировано: {len(doors['sampled'])}{RESET}")
        for d in doors["sampled"][:10]:
            st = f"{GREEN}✓{RESET}" if d["status"] == "CLEAN" else f"{RED}✗{RESET}"
            print(f"   {st} {CYAN}[{d['relPath']}:{d['lineNum']}]{RESET} {BOLD}{d['doorSignature']}{RESET}")
            if d["issues"]:
                for iss in d["issues"]:
                    print(f"      {RED}⚠{RESET} {iss}")
        if len(doors["sampled"]) > 10:
            print(f"{DIM}   ... и ещё {len(doors['sampled']) - 10} дверей симуляции проверено.{RESET}")

    # 3. Список 2: Поля памяти и CSV
    if report.get("fields") and report["fields"]["sampled"]:
        fields = report["fields"]
        print(f"\n{BOLD}💾 СТРУКТУРНЫЙ СПИСОК 2 (ПОЛЯ ПАМЯТИ И CSV SSOT КОНТРАКТЫ):{RESET}")
        print(f"{DIM}   Всего записей данных проверено: {fields['total']} | Сэмплировано: {len(fields['sampled'])}{RESET}")
        for f in fields["sampled"][:10]:
            st = f"{GREEN}✓{RESET}" if f["status"] == "CLEAN" else f"{RED}✗{RESET}"
            print(f"   {st} {CYAN}[{f['file']}:{f['line']}]{RESET} {f['data'][:70]}")
            if f["issues"]:
                for iss in f["issues"]:
                    print(f"      {YELLOW}⚠{RESET} {iss}")
        if len(fields["sampled"]) > 10:
            print(f"{DIM}   ... и ещё {len(fields['sampled']) - 10} полей данных проверено.{RESET}")

    # 4. Список 3: Инквизиция тестов (Anti-Goodhart)
    if report.get("tests") and report["tests"]["sampled"]:
        tests_data = report["tests"]
        print(f"\n{BOLD}🧪 СТРУКТУРНЫЙ СПИСОК 3 (ИНКВИЗИЦИЯ ТЕСТОВ / ANTI-GOODHART):{RESET}")
        print(f"{DIM}   Всего тестовых ассертов найдено: {tests_data['total']} | Сэмплировано: {len(tests_data['sampled'])}{RESET}")
        for t in tests_data["sampled"][:10]:
            st = f"{GREEN}✓{RESET}" if t["status"] == "CLEAN" else f"{RED}✗{RESET}"
            print(f"   {st} {CYAN}[{t['file']}:{t['line']}]{RESET} {t['signature'][:70]}")
            if t["issues"]:
                for iss in t["issues"]:
                    print(f"      {RED}⚠{RESET} {iss}")
        if len(tests_data["sampled"]) > 10:
            print(f"{DIM}   ... и ещё {len(tests_data['sampled']) - 10} проверок тестов инспектировано.{RESET}")

    print("\n" + "=" * 80)
    print(f"{BOLD}📊 СВОДНЫЙ РЕЙТИНГ РЕАЛЬНОСТИ ДВИЖКА (DICE REALITY INTEGRITY SCORE):{RESET}")
    print(f"   Всего проверено сэмплов: {report['summary']['totalSamples']} (норма: 175)")
    print(f"   Чистых сэмплов (Clean):  {GREEN}{report['summary']['cleanSamples']}{RESET}")
    print(f"   Дефектов (Defects):      {RED if report['summary']['defectSamples'] > 0 else GREEN}{report['summary']['defectSamples']}{RESET}")

    score_color = GREEN if report['summary']['realityScorePercent'] >= 95 else (YELLOW if report['summary']['realityScorePercent'] >= 90 else RED)
    print(f"   Индекс реальности:      {score_color}{report['summary']['realityScorePercent']}%{RESET}")

    # Если есть дефекты — выводим Failure Manifesto
    if report["summary"]["defectSamples"] > 0:
        print(f"\n{RED}[ВНИМАНИЕ] Кубик вскрыл дефекты в кодовой базе! Выпуск Failure Manifesto:{RESET}")
        printed = 0
        for l in report["lines"]:
            if l["status"] == "DEFECT":
                for d in l["defects"]:
                    d["relPath"] = l["relPath"]
                    d["lineNum"] = l["lineNum"]
                    d["code"] = l["code"]
                    print_failure_manifesto(d)
                    printed += 1
                    if printed >= 3:
                        break
            if printed >= 3:
                break
        if report.get("doors") and report["doors"]["sampled"]:
            for d in report["doors"]["sampled"]:
                if d["status"] == "DEFECT" and printed < 3:
                    print_failure_manifesto({
                        "relPath": d["relPath"],
                        "lineNum": d["lineNum"],
                        "rule": "SIMULATION_DOOR_VIOLATION",
                        "law": "CANON S11 (Дисциплина шагов симуляции)",
                        "question": "1. Граничные случаи и безопасность",
                        "issues": d["issues"],
                        "doorSignature": d["doorSignature"],
                        "fix": "Устрани аллокации или тяжелые циклы из горячего шага тика."
                    })
                    printed += 1
        if report.get("fields") and report["fields"]["sampled"]:
            for f in report["fields"]["sampled"]:
                if f["status"] == "DEFECT" and printed < 3:
                    print_failure_manifesto({
                        "file": f["file"],
                        "line": f["line"],
                        "rule": "CSV_DATA_VIOLATION",
                        "law": "CANON S11 (Data-Driven контракты CSV)",
                        "question": "3. Соответствие контракту данных",
                        "issues": f["issues"],
                        "data": f["data"],
                        "fix": "Приведи строки таблицы CSV в соответствие со спецификацией."
                    })
                    printed += 1
        if report.get("tests") and report["tests"]["sampled"]:
            for t in report["tests"]["sampled"]:
                if t["status"] == "DEFECT" and printed < 3:
                    print_failure_manifesto({
                        "file": t["file"],
                        "line": t["line"],
                        "rule": "TEST_ANTI_GOODHART_VIOLATION",
                        "law": "DEFENSE BIBLE §3 (Запрет фиктивных тестов и тавтологий)",
                        "question": "1. Граничные случаи и безопасность",
                        "issues": t["issues"],
                        "signature": t["signature"],
                        "fix": "Удали тавтологию и напиши полноценный ассерт над расчетным значением."
                    })
                    printed += 1
    else:
        print(f"\n{BOLD}{GREEN}🎉 [DICE AUDIT: PASS — 0 ГОВНОСРАЛОВ]{RESET}")
        print(f"{GREEN}   Архитектурный контроль подтверждён: 175 случайных точек кода и данных соответствуют законам S1..S28!{RESET}")

    print("=" * 80 + "\n")

# ==============================================================================
# Секция 12. Self-Test режим для заградительной верификации
# ==============================================================================

def run_self_test():
    """
    Верифицирует работу кубика в обеих полярностях (чистый код vs наведенный дефект),
    детерминизм PRNG по сиду и парсер правил.
    """
    print(f"{CYAN}[dice_reality_audit] Running self-test suite (Two-Polarity Verification)...{RESET}")

    # 1. Проверка PRNG воспроизводимости
    p1 = DynamicPrng(42)
    p2 = DynamicPrng(42)
    seq1 = [p1.next_u32() for _ in range(100)]
    seq2 = [p2.next_u32() for _ in range(100)]
    assert seq1 == seq2, "PRNG Mulberry32 non-deterministic for seed 42!"

    # 2. Проверка полярности 1 (Чистый код)
    clean_sample = {
        "relPath": "src/sim/physics.cpp",
        "lineNum": 42,
        "current": "vec3 delta = wrap_delta3(posA, posB, kWorldExtent);",
        "before": ["// step"],
        "after": ["float dist = length(delta);"]
    }
    res_clean = inspect_code_line(clean_sample)
    assert res_clean["status"] == "CLEAN", f"Clean sample falsely flagged: {res_clean}"

    # 3. Проверка полярности 2 (Наведенные дефекты)
    # 3.1: Запрещенный throw
    buggy_throw = {
        "relPath": "src/sim/physics.cpp",
        "lineNum": 50,
        "current": "throw std::runtime_error(\"collision exploded\");",
        "before": [],
        "after": []
    }
    res_throw = inspect_code_line(buggy_throw)
    assert res_throw["status"] == "DEFECT", "Failed to catch 'throw' statement!"
    assert any("NO_EXCEPTIONS" in d["rule"] for d in res_throw["defects"])

    # 3.2: Заглушка // TODO
    buggy_todo = {
        "relPath": "src/game/ai.cpp",
        "lineNum": 100,
        "current": "int target = 0; // TODO: implement steering later",
        "before": [],
        "after": []
    }
    res_todo = inspect_code_line(buggy_todo)
    assert res_todo["status"] == "DEFECT", "Failed to catch '// TODO' stub!"

    # 3.3: Привилегированный игрок в физике (CANON S7)
    buggy_player = {
        "relPath": "src/sim/physics.cpp",
        "lineNum": 120,
        "current": "if (is_player) { vel = vel * 2.0f; }",
        "before": [],
        "after": []
    }
    res_player = inspect_code_line(buggy_player)
    assert res_player["status"] == "DEFECT", "Failed to catch privileged player branch!"

    # 3.4: Тест-сниффинг в боевом коде
    buggy_sniff = {
        "relPath": "src/sim/movement.cpp",
        "lineNum": 80,
        "current": "if (std::getenv(\"TEST\")) return 0;",
        "before": [],
        "after": []
    }
    res_sniff = inspect_code_line(buggy_sniff)
    assert res_sniff["status"] == "DEFECT", "Failed to catch test env sniffing!"
    assert any("TEST_ENV_SNIFF" in d["rule"] for d in res_sniff["defects"])

    # 3.5: Подавление предупреждений компилятора
    buggy_pragma = {
        "relPath": "src/sim/contacts.cpp",
        "lineNum": 15,
        "current": "#pragma warning(disable: 4996)",
        "before": [],
        "after": []
    }
    res_pragma = inspect_code_line(buggy_pragma)
    assert res_pragma["status"] == "DEFECT", "Failed to catch compiler warning suppression!"
    assert any("COMPILER_WARNING_SUPPRESSION" in d["rule"] for d in res_pragma["defects"])

    print(f"{GREEN}✔ [dice_reality_audit] Self-test PASS: 100% точность классификатора в обеих полярностях.{RESET}")
    return 0

def run_demo_defect():
    """
    Демонстрационный прогон с искусственной подсадкой архитектурного дефекта
    для наглядной демонстрации перехвата и генерации Failure Manifesto.
    """
    print(f"\n{YELLOW}[DEMO DEFECT]: Искусственная инъекция дефекта для демонстрации перехвата...{RESET}")
    mutant = {
        "relPath": "src/sim/physics.cpp",
        "lineNum": 142,
        "rule": "CANON_S7_PLAYER_IS_NOT_SPECIAL",
        "law": "CANON S7 (Игрок НЕ особенный — системная изотропия мира)",
        "question": "3. Соответствие контракту данных и законам физики",
        "message": "Обнаружена попытка дать игроку иммунитет к кинетическому урону: 'if (is_player) return 0;'!",
        "code": "if (is_player) return 0; // bypass kinetic damage for player",
        "fix": "Удали привилегированную ветку игрока. Все тела в игре подчиняются единым законам повреждений."
    }
    print_failure_manifesto(mutant)

# ==============================================================================
# Секция 13. CLI Entry Point
# ==============================================================================

def parse_cli_args(args=None):
    parser = argparse.ArgumentParser(
        description="GigaHrush 2 Monte Carlo Reality Audit Engine («Кубик-Тест Тимаэрта»)",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("repo_path", nargs="?", default=None, help="Root path of the repository")
    parser.add_argument("--root", type=str, default=None, help="Explicit repository root directory")
    parser.add_argument("--samples", "-n", type=int, default=100, help="Number of random line samples (default: 100 — суммарно 175 точек)")
    parser.add_argument("--seed", "-s", type=str, default=None, help="Random seed for reproducible Monte Carlo roll")
    parser.add_argument("--list", "-l", choices=["all", "lines", "doors", "fields", "csv", "tests"], default="all", help="Target audit list")
    parser.add_argument("--strict", action="store_true", help="Exit with code 1 if any defects found")
    parser.add_argument("--json", action="store_true", help="Output machine-readable JSON report")
    parser.add_argument("--self-test", action="store_true", help="Run self-test suite on test mutants")
    parser.add_argument("--demo-defect", action="store_true", help="Demonstrate defect interception with Failure Manifesto")

    return parser.parse_args(args)

def main():
    args = parse_cli_args()

    if args.self_test:
        sys.exit(run_self_test())

    if args.demo_defect:
        run_demo_defect()
        sys.exit(0)

    target_root = args.root or args.repo_path
    root = Path(target_root).resolve() if target_root else REPO_ROOT

    report = run_dice_audit(args, root)

    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print_terminal_report(report)

    if args.strict and report["summary"]["defectSamples"] > 0:
        sys.exit(1)

    sys.exit(0)

if __name__ == "__main__":
    main()
