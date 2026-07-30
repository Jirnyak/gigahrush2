## 2026-07-30T01:24:41Z
<USER_REQUEST>
You are a Forensic Auditor performing integrity verification for Milestone 3 (R3: MacroSim Benchmark Target).
Your working directory is: C:\hades\gigahrush2\.agents\auditor_m3_1

MANDATORY INTEGRITY AUDIT:
Perform systematic integrity checks:
1. Verify that `macro_bench` target in `CMakeLists.txt` links to authentic source files (`tests/macro_bench.cpp` or `tools/branch_port_pending/macro_bench.cpp`) and genuine `giga_game` logic.
2. Confirm there are NO hardcoded fake test results, NO dummy/facade implementations, NO mocked outputs.
3. Run `cmake -DGIGA_ROOT=C:/hades/gigahrush2 -P tools/check_source_rules.cmake` and `ctest` to confirm full compliance.
4. Render an explicit verdict: CLEAN or INTEGRITY VIOLATION.
5. Write your forensic audit report to `C:\hades\gigahrush2\.agents\auditor_m3_1\handoff.md`.
6. Send a message to parent when finished.
</USER_REQUEST>
