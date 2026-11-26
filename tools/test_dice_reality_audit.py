#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/test_dice_reality_audit.py — Unit tests for the Monte Carlo Reality Audit Engine.
Modeled after Dental CRM & Timeart Zero-Trust testing doctrine (scripts/tests/dice-audit.test.mjs).

Verifies:
 1. PRNG determinism (Mulberry32 with integer & string seeds, divergence across seeds).
 2. CLI argument parsing (defaults, explicit flags, --samples, --seed, --list, --strict, --json, --root).
 3. Line inspector inspect_code_line on clean C++23 code.
 4. Line inspector inspect_code_line across all 13 defect types (throw, try-catch, RTTI, TODO,
    fake assert, div-zero, magic 128, magic 0.25f, Euclidean metric, sleep, player special,
    test env sniffing, compiler warning suppression).
 5. Simulation doors audit (audit_simulation_doors) on clean and defective synthetic doors.
 6. Memory and CSV data audit (audit_memory_and_csv_fields) on clean and defective CSV data.
 7. Anti-Goodhart test inquisition audit (audit_tests) on tautologies, commented asserts, phantom tests.
 8. Full run_dice_audit determinism and 175-sample structure.
 9. Failure Manifesto generation without runtime crashes.
10. E2E CLI execution (--help, --json, --strict returning exit code 1 on defects).
"""

import sys
import os
import tempfile
import shutil
import subprocess
import json
from pathlib import Path

# Импортируем тестируемый модуль
sys.path.insert(0, str(Path(__file__).resolve().parent))
import dice_reality_audit as da

GREEN = "\033[1;32m"
RED = "\033[1;31m"
CYAN = "\033[1;36m"
YELLOW = "\033[1;33m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"

def test_1_prng_determinism():
    print(f"{CYAN}[1/10] Testing PRNG Mulberry32 determinism...{RESET}")
    # 1.1 Числовой сид
    p1 = da.DynamicPrng(42)
    p2 = da.DynamicPrng(42)
    seq1 = [p1.next_u32() for _ in range(50)]
    seq2 = [p2.next_u32() for _ in range(50)]
    assert seq1 == seq2, "Одинаковый числовой сид обязан выдавать идентичные числа!"

    # 1.2 Строковый сид
    p_str1 = da.DynamicPrng("giga-seed-2026")
    p_str2 = da.DynamicPrng("giga-seed-2026")
    s1 = [p_str1.next_u32() for _ in range(30)]
    s2 = [p_str2.next_u32() for _ in range(30)]
    assert s1 == s2, "Одинаковый строковый сид обязан выдавать идентичные числа!"

    # 1.3 Разные сиды дают разные последовательности
    p_diff = da.DynamicPrng(9999)
    assert p1.next_u32() != p_diff.next_u32(), "Разные сиды обязаны различаться!"
    print(f"  {GREEN}✔ PRNG determinism OK{RESET}")

def test_2_cli_args_parsing():
    print(f"{CYAN}[2/10] Testing CLI arguments parser...{RESET}")
    # 2.1 Дефолтные значения
    opts_def = da.parse_cli_args([])
    assert opts_def.samples == 100, f"Default samples must be 100, got {opts_def.samples}"
    assert opts_def.seed is None
    assert opts_def.list == "all"
    assert opts_def.strict is False
    assert opts_def.json is False

    # 2.2 Явные флаги
    opts_custom = da.parse_cli_args(["--samples", "50", "--seed", "test-42", "--list", "tests", "--strict", "--json", "--root", "C:/test"])
    assert opts_custom.samples == 50
    assert opts_custom.seed == "test-42"
    assert opts_custom.list == "tests"
    assert opts_custom.strict is True
    assert opts_custom.json is True
    assert opts_custom.root == "C:/test"
    print(f"  {GREEN}✔ CLI parser OK{RESET}")

def test_3_inspect_code_line_clean():
    print(f"{CYAN}[3/10] Testing inspect_code_line on clean C++23 code...{RESET}")
    sample_clean = {
        "relPath": "src/sim/physics.cpp",
        "lineNum": 42,
        "current": "vec3 delta = wrap_delta3(posA, posB, kWorldExtent);",
        "before": ["// Step contact"],
        "after": ["float dist = length(delta);"]
    }
    res = da.inspect_code_line(sample_clean)
    assert res["status"] == "CLEAN", f"Clean sample flagged as DEFECT: {res}"
    assert len(res["defects"]) == 0
    assert "Ядро" in res["system"]["layer"]
    print(f"  {GREEN}✔ Clean code classification OK{RESET}")

def test_4_inspect_code_line_all_defects():
    print(f"{CYAN}[4/10] Testing inspect_code_line on all 13 defect types...{RESET}")
    defect_cases = [
        # (current_code, rel_path, expected_rule)
        ("throw std::runtime_error(\"boom\");", "src/sim/physics.cpp", "CANON_S11_NO_EXCEPTIONS_THROW"),
        ("try { solve(); } catch (...) {}", "src/world/world.cpp", "CANON_S11_NO_EXCEPTIONS_TRY_CATCH"),
        ("auto* ptr = dynamic_cast<Mob*>(entity);", "src/game/mob.cpp", "CANON_S11_NO_RTTI"),
        ("const std::type_info& t = typeid(item);", "src/game/craft.cpp", "CANON_S11_NO_RTTI"),
        ("int x = 0; // TODO: implement later", "src/core/math.cpp", "ANTI_GOODHART_TODO_STUB"),
        ("assert(true);", "src/sim/solver.cpp", "ANTI_GOODHART_FAKE_ASSERT"),
        ("CHECK(1);", "src/game/combat.cpp", "ANTI_GOODHART_FAKE_ASSERT"),
        ("float step = total / count;", "src/sim/solver.cpp", "MATH_SAFETY_POTENTIAL_DIV_ZERO"),
        ("int idx = coord * 128 + offset;", "src/sim/grid.cpp", "CANON_S1_MAGIC_MACRO_DIM_128"),
        ("float sub = raw * 0.25f;", "src/sim/submask.cpp", "CANON_S2_MAGIC_VOXEL_SIZE_025"),
        ("float d = sqrtf(dx*dx + dy*dy + dz*dz);", "src/sim/physics.cpp", "CANON_S1_TOROIDAL_METRIC_VIOLATION"),
        ("std::this_thread::sleep_for(10ms);", "src/sim/tick.cpp", "CANON_S11_SIMULATION_SLEEP_BAN"),
        ("if (is_player) { damage = 0; }", "src/sim/combat.cpp", "CANON_S7_PLAYER_IS_NOT_SPECIAL"),
        ("if (std::getenv(\"TEST\")) return 0;", "src/sim/movement.cpp", "ANTI_GOODHART_TEST_ENV_SNIFF"),
        ("#pragma warning(disable: 4996)", "src/sim/contacts.cpp", "COMPILER_WARNING_SUPPRESSION"),
        ("float clamped = std::clamp(val, 10.0f, 0.0f);", "src/sim/solver.cpp", "INVERTED_CONDITION_CLAMP"),
        ("if (!body) body->integrate(dt);", "src/sim/physics.cpp", "INVERTED_CONDITION_NULL_DEREF"),
        ("if (speed > 10.0 && speed < 5.0) return 0;", "src/sim/kinematics.cpp", "INVERTED_CONDITION_IMPOSSIBLE_RANGE"),
    ]

    for code, rel_path, expected_rule in defect_cases:
        sample = {
            "relPath": rel_path,
            "lineNum": 10,
            "current": code,
            "before": [],
            "after": []
        }
        res = da.inspect_code_line(sample)
        assert res["status"] == "DEFECT", f"Expected DEFECT for '{code}' in '{rel_path}', got CLEAN!"
        matched = any(expected_rule in d["rule"] for d in res["defects"])
        assert matched, f"Expected rule {expected_rule} for '{code}', got: {[d['rule'] for d in res['defects']]}"

    print(f"  {GREEN}✔ All 16 defect types successfully caught OK{RESET}")

def test_5_simulation_doors_audit():
    print(f"{CYAN}[5/10] Testing simulation doors audit (Список 1: *_step)...{RESET}")
    tmp_dir = Path(tempfile.mkdtemp(prefix="giga-dice-doors-"))
    try:
        sim_dir = tmp_dir / "src/sim"
        sim_dir.mkdir(parents=True, exist_ok=True)

        # 5.1 Чистая дверь
        clean_file = sim_dir / "clean_door.cpp"
        clean_file.write_text("""
void physics_step(Registry& reg, LevelStack& stack, float dt) {
    for (auto e : reg.view<Body>()) {
        integrate(reg.get<Body>(e), dt);
    }
}
""", encoding="utf-8")

        prng = da.DynamicPrng(42)
        report_clean = da.audit_simulation_doors(tmp_dir, prng, 5)
        assert report_clean["total"] == 1
        assert report_clean["sampled"][0]["status"] == "CLEAN"

        # 5.2 Дверь с динамической аллокацией new и sleep
        dirty_file = sim_dir / "dirty_door.cpp"
        dirty_file.write_text("""
void dirty_sim_step(Registry& reg, float dt) {
    auto* b = new Body();
    sleep_for(1ms);
}
""", encoding="utf-8")

        report_dirty = da.audit_simulation_doors(tmp_dir, prng, 5)
        assert report_dirty["total"] == 2
        dirty_door = [d for d in report_dirty["sampled"] if "dirty_door" in d["relPath"]][0]
        assert dirty_door["status"] == "DEFECT"
        assert any("new/malloc" in iss for iss in dirty_door["issues"])
        assert any("sleep" in iss for iss in dirty_door["issues"])
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    print(f"  {GREEN}✔ Simulation doors audit OK{RESET}")

def test_6_csv_memory_audit():
    print(f"{CYAN}[6/10] Testing memory and CSV data audit (Список 2: data/*.csv)...{RESET}")
    tmp_dir = Path(tempfile.mkdtemp(prefix="giga-dice-csv-"))
    try:
        data_dir = tmp_dir / "data"
        data_dir.mkdir(parents=True, exist_ok=True)

        # 6.1 Чистый CSV
        clean_csv = data_dir / "items.csv"
        clean_csv.write_text("id,name,mass,hp,damage\nmedkit,Аптечка,0.5,50,0\nrifle,Винтовка,3.5,100,25\n", encoding="utf-8")

        prng = da.DynamicPrng(42)
        res_clean = da.audit_memory_and_csv_fields(tmp_dir, prng, 5)
        assert res_clean["total"] == 2
        assert all(r["status"] == "CLEAN" for r in res_clean["sampled"])

        # 6.2 CSV с браком (отрицательная масса, несовпадение колонок)
        dirty_csv = data_dir / "broken.csv"
        dirty_csv.write_text("id,name,mass,hp,damage\nbad_item,Брак,-5.0,10,0\nbad_col,Колонка,1.0,20\n", encoding="utf-8")

        res_dirty = da.audit_memory_and_csv_fields(tmp_dir, prng, 5)
        broken_records = [r for r in res_dirty["sampled"] if "broken.csv" in r["file"]]
        assert any(r["status"] == "DEFECT" for r in broken_records)
        assert any(any("масса" in iss for iss in r["issues"]) for r in broken_records)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    print(f"  {GREEN}✔ Memory & CSV data audit OK{RESET}")

def test_7_anti_goodhart_test_inquisition():
    print(f"{CYAN}[7/10] Testing Anti-Goodhart test inquisition (Список 3: audit_tests)...{RESET}")
    tmp_dir = Path(tempfile.mkdtemp(prefix="giga-dice-tests-"))
    try:
        tests_dir = tmp_dir / "tests"
        tests_dir.mkdir(parents=True, exist_ok=True)

        # 7.1 Чистый тест
        clean_test = tests_dir / "suite_clean.inl"
        clean_test.write_text("""
static void test_clean_physics() {
    float dist = 5.0f;
    CHECK(dist > 0.0f);
    CHECK(dist < 10.0f);
}
""", encoding="utf-8")

        prng = da.DynamicPrng(42)
        res_clean = da.audit_tests(tmp_dir, prng, 5)
        assert res_clean["total"] > 0
        assert all(r["status"] == "CLEAN" for r in res_clean["sampled"])

        # 7.2 Тест с тавтологией и закомментированным ассертом
        dirty_test = tests_dir / "suite_dirty.inl"
        dirty_test.write_text("""
static void test_tautology_fake() {
    CHECK(true);
    // CHECK(false);
}
""", encoding="utf-8")

        res_dirty = da.audit_tests(tmp_dir, prng, 10)
        dirty_samples = [s for s in res_dirty["sampled"] if "suite_dirty" in s["file"]]
        assert any(s["status"] == "DEFECT" for s in dirty_samples)
        assert any(any("Тавтология" in iss for iss in s["issues"]) for s in dirty_samples)
        assert any(any("Закомментированный ассерт" in iss for iss in s["issues"]) for s in dirty_samples)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    print(f"  {GREEN}✔ Anti-Goodhart test inquisition OK{RESET}")

def test_8_full_run_dice_audit_determinism():
    print(f"{CYAN}[8/10] Testing full run_dice_audit determinism and 175-sample structure...{RESET}")
    root = da.REPO_ROOT
    opts = da.parse_cli_args(["--samples", "100", "--seed", "audit-fixed-seed-2026"])

    rep1 = da.run_dice_audit(opts, root)
    rep2 = da.run_dice_audit(opts, root)

    # Проверка структуры 175 точек (100 строк + 25 дверей + 25 данных + 25 тестов)
    assert len(rep1["lines"]) == 100, f"Lines count must be 100, got {len(rep1['lines'])}"
    assert len(rep1["doors"]["sampled"]) == 25, f"Doors count must be 25, got {len(rep1['doors']['sampled'])}"
    assert len(rep1["fields"]["sampled"]) == 25, f"Fields count must be 25, got {len(rep1['fields']['sampled'])}"
    assert len(rep1["tests"]["sampled"]) == 25, f"Tests count must be 25, got {len(rep1['tests']['sampled'])}"
    assert rep1["summary"]["totalSamples"] == 175, f"Total evaluated must be 175, got {rep1['summary']['totalSamples']}"

    # Проверка детерминизма байт-в-байт
    assert rep1["lines"] == rep2["lines"], "Линии обязаны быть идентичными при одинаковом сиде!"
    assert rep1["doors"]["sampled"] == rep2["doors"]["sampled"], "Двери обязаны совпадать!"
    assert rep1["fields"]["sampled"] == rep2["fields"]["sampled"], "Поля обязаны совпадать!"
    assert rep1["tests"]["sampled"] == rep2["tests"]["sampled"], "Тесты обязаны совпадать!"
    print(f"  {GREEN}✔ 175-sample structure and reproducibility OK{RESET}")

def test_9_failure_manifesto_format():
    print(f"{CYAN}[9/10] Testing Failure Manifesto output formatting...{RESET}")
    mutant = {
        "relPath": "src/sim/physics.cpp",
        "lineNum": 42,
        "rule": "CANON_S1_TOROIDAL_METRIC_VIOLATION",
        "law": "CANON S1 (Изотропный 3D тор 128³)",
        "question": "3. Соответствие контракту данных и законам физики",
        "message": "Плоская евклидова метрика в обход тора",
        "code": "float d = sqrtf(dx*dx + dy*dy + dz*dz);",
        "fix": "Используй wrap_delta_f или wrap_dist"
    }
    # Вызываем генератор манифеста и проверяем отсутствие исключений
    da.print_failure_manifesto(mutant)
    print(f"  {GREEN}✔ Failure Manifesto formatting OK{RESET}")

def test_10_e2e_cli_execution():
    print(f"{CYAN}[10/10] Testing E2E CLI execution (--help, --json, --strict)...{RESET}")
    script_path = Path(__file__).resolve().parent / "dice_reality_audit.py"

    # 10.1 --help
    res_help = subprocess.run([sys.executable, str(script_path), "--help"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    assert res_help.returncode == 0, f"--help failed: {res_help.stderr}"
    assert "Кубик-Тест Тимаэрта" in res_help.stdout
    assert "--strict" in res_help.stdout

    # 10.2 --json
    res_json = subprocess.run([sys.executable, str(script_path), "--samples", "2", "--seed", "123", "--json"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    assert res_json.returncode == 0, f"--json failed: {res_json.stderr}"
    parsed = json.loads(res_json.stdout)
    assert "meta" in parsed
    assert "summary" in parsed
    assert len(parsed["lines"]) == 2

    # 10.3 --strict на синтетическом дереве с дефектами обязана возвращать код 1
    tmp_dir = Path(tempfile.mkdtemp(prefix="giga-dice-strict-"))
    try:
        sim_dir = tmp_dir / "src/sim"
        sim_dir.mkdir(parents=True, exist_ok=True)
        (sim_dir / "broken.cpp").write_text("void broken() { throw 42; }\n", encoding="utf-8")

        res_strict = subprocess.run([sys.executable, str(script_path), "--root", str(tmp_dir), "--strict", "--samples", "5"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        assert res_strict.returncode == 1, f"--strict must exit with code 1 on defects, got {res_strict.returncode}"
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    print(f"  {GREEN}✔ E2E CLI execution OK{RESET}")

def test_11_mutant_killer_suite():
    print(f"{CYAN}[11/11] Testing Inverted Condition Mutant Killer suite...{RESET}")
    # 11.1 Прямой вызов функции run_mutant_killer
    ret = da.run_mutant_killer(seed=12345)
    assert ret == 0, f"run_mutant_killer must exit with 0, got {ret}"

    # 11.2 E2E CLI флаг --mutant-killer
    script_path = Path(__file__).resolve().parent / "dice_reality_audit.py"
    res_cli = subprocess.run([sys.executable, str(script_path), "--mutant-killer", "--seed", "777"],
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    assert res_cli.returncode == 0, f"--mutant-killer CLI failed: {res_cli.stderr}"
    assert "100% PASS" in res_cli.stdout or "ВСЕ МУТАНТЫ УБИТЫ" in res_cli.stdout
    assert "Выжило мутантов:" in res_cli.stdout
    assert "100.00%" in res_cli.stdout
    print(f"  {GREEN}✔ Inverted Condition Mutant Killer OK (100% killed, 0 survivors){RESET}")

def main():
    print(f"\n{BOLD}{CYAN}================================================================================{RESET}")
    print(f"{BOLD}{CYAN}🧪 GIGAHRUSH 2 — MONTE CARLO REALITY AUDITOR UNIT TEST SUITE{RESET}")
    print(f"{DIM}   Modeled after DENTE Dental CRM & Timeart Zero-Trust testing doctrine{RESET}")
    print(f"{BOLD}{CYAN}================================================================================{RESET}\n")

    test_1_prng_determinism()
    test_2_cli_args_parsing()
    test_3_inspect_code_line_clean()
    test_4_inspect_code_line_all_defects()
    test_5_simulation_doors_audit()
    test_6_csv_memory_audit()
    test_7_anti_goodhart_test_inquisition()
    test_8_full_run_dice_audit_determinism()
    test_9_failure_manifesto_format()
    test_10_e2e_cli_execution()
    test_11_mutant_killer_suite()

    print(f"\n{BOLD}{GREEN}================================================================================{RESET}")
    print(f"{BOLD}{GREEN}🎉 [DICE AUDIT UNIT TESTS: ALL 11 TEST SUITES PASS — 100% OK]{RESET}")
    print(f"{BOLD}{GREEN}================================================================================{RESET}\n")
    sys.exit(0)

if __name__ == "__main__":
    main()
