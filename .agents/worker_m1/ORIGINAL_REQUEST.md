## 2026-07-30T10:45:13Z
You are worker_m1 implementing Milestone 1 (Procedural Prop Placement System) and Milestone 2 (Advanced Prop Shading & Material Features) in Gigahrush2.
Your working directory is: C:\hades\gigahrush2\.agents\worker_m1

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Carefully read the Explorer blueprints:
- C:\hades\gigahrush2\.agents\explorer_m1_1\handbook_prop_placer.md
- C:\hades\gigahrush2\.agents\explorer_m1_2\handbook_prop_shading.md
- C:\hades\gigahrush2\.agents\explorer_m1_3\handbook_prop_tests.md

Execute the following tasks:

1. Procedural Prop Placer (R1) - src/render/prop_placer.h, src/render/prop_placer.cpp, src/app/main.cpp:
   - Fix cell stride bug (x++, y++, z++ over full MacroGrid [0, kMacroDim)).
   - Fix material comparison bug for hazardous cells (below == kMatAcidPool || below == kMatElectricGrate || below == kMatWaterMark).
   - Implement intersection & corridor junction detection (N_open >= 3) to place FloodLamp instances.
   - Fix wall cabinet yaw orientation by evaluating solid wall face normals (West 0, East pi, South pi/2, North 3pi/2).
   - Incorporate seed into spatial hash (spatial_hash(x, y, z, seed)).
   - Populate PropInstance fields (origin, yaw, color, matId, emissive, flags, animPhase).
   - Implement ceiling pipes, floor grates, wall cabinets, crystals in anomalous zones, and intersection lights.
   - Wire propPlacer.populate(world.grid(), propPass, currentSeed) in src/app/main.cpp.

2. Prop Shader Effects & Pipeline Integration (R2) - shaders/prop.vert, shaders/prop.frag, src/render/prop_pass.h/.cpp:
   - Bind vertex attributes loc 7 (inFlags, R8_UINT) and loc 8 (inAnimPhase, R8_UNORM) in prop_pass.cpp and prop.vert.
   - Pass uTime via push constant pc.torus.w in prop_pass.cpp.
   - In shaders/prop.frag: implement derivative normal perturbation (bump mapping using kMatSurface[mid].w), material roughness mapping, and time-animated emissive pulse/flicker (stochastic flicker for lamps, harmonic breathing for crystals, chemical undulation + bubbles for acid pools).

3. Unit Tests & CMake Pins - tests/suite_props.inl, tests/world_test.cpp, CMakeLists.txt:
   - Create tests/suite_props.inl with comprehensive tests verifying prop counts, placement rules, hash determinism, air occupancy, attribute calibration, and capacity caps.
   - Include suite_props.inl in tests/world_test.cpp.
   - Run cmake -DGIGA_ROOT=C:/hades/gigahrush2 -P tools/check_source_rules.cmake to verify GIGA_SOURCE_RULES=PASS.
   - Update CMakeLists.txt test regex pins for the new assertion check count.

4. Build & Test Verification (SINGLE-COMPILER OWNER RULE):
   - Execute tools\win\build.bat Release and ctest --test-dir build-win -C Release sequentially.
   - Ensure 0 MSVC warnings/errors (/W4 /EHsc) and 100% CTest pass across all 4 targets (world_test, audit_test, game_test, source_rules).

Document all your changes in C:\hades\gigahrush2\.agents\worker_m1\handoff.md and report to the parent orchestrator via send_message when finished.
