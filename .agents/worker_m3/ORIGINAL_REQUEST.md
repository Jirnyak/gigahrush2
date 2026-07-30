## 2026-07-30T01:24:24Z
You are a Worker agent implementing Milestone 3 (R3: MacroSim 2^20 Benchmark Registration).
Your working directory is: C:\hades\gigahrush2\.agents\worker_m3

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Single-Compiler Owner Rule: Strictly respect the Single-Compiler Owner Rule. Execute builds sequentially. Do NOT launch concurrent compiler/ctest instances.

Task Details:
1. Inspect `CMakeLists.txt` and `tools/branch_port_pending/macro_bench.cpp`.
2. Register `tools/branch_port_pending/macro_bench.cpp` as target `macro_bench` in `CMakeLists.txt` (with standard include directories, dependencies, C++23 standard).
3. Ensure `tools/branch_port_pending/macro_bench.cpp` has any necessary header updates or fixes so it compiles cleanly as a C++23 target under CMake.
4. Run `tools\win\build.bat Release` and verify `macro_bench` target compiles cleanly without errors or warnings.
5. Run `ctest --test-dir build-win -C Release` to ensure all tests pass.
6. Write your complete report to `C:\hades\gigahrush2\.agents\worker_m3\handoff.md`.
7. Send a message to parent when finished.
