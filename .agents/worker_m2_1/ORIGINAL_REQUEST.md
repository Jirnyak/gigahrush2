## 2026-07-30T11:34:40Z
<USER_REQUEST>
You are a Worker agent working on Milestone 2 (R2: Advanced Atmospheric Shader Pipeline).
Your working directory is: C:\hades\gigahrush2\.agents\worker_m2_1
The root project directory is: C:\hades\gigahrush2

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

CONCURRENCY & COMPILATION CONSTRAINTS:
1. SINGLE-COMPILER OWNER RULE: You MUST NOT execute tools\win\build.bat, cmake, ninja, glslc, or ctest. Implement the shader changes directly in `shaders/prop.vert` and `shaders/prop.frag`. The Lead Orchestrator will execute the build and shader compilation sequentially.

TASKS:
1. Review `shaders/prop.vert`:
   - Attributes: location 0 `inPos` (vec3), location 1 `inNormal` (vec3), location 2 `inOrigin` (vec3), location 3 `inYaw` (float), location 4 `inColor` (vec3), location 5 `inMat` (uint), location 6 `inEmissive` (uint), location 7 `inFlags` (uint), location 8 `inAnimPhase` (float).
   - Push constants: `mat4 viewProj`, `vec4 sunDir`, `vec4 camPos`, `vec4 fog`, `vec4 torus`.
   - Toroidal wrap: `nearest_image(inOrigin + localPos, pc.camPos.xyz, pc.torus.x)`.
   - Outputs: `vNormal`, `vColor`, `vWorldPos`, `vAo`, `vMat`, `vEmissive`, `vFlags`, `vAnimPhase`.
2. Review `shaders/prop.frag`:
   - Inputs matching `prop.vert` outputs.
   - Include `material_surface.glsl`.
   - Triplanar UV generation from world position.
   - Procedural surface textures & derivative normal perturbation (`construct_perturbed_normal`).
   - Calibrated material roughness & Blinn-Phong specular lighting.
   - Animated emissive effects (`compute_animated_emissive` for electrical flicker, bioluminescent crystal pulse, acid pool undulation).
   - Atmospheric height-based fog: density increases at lower Z levels; enforce `fog = 1.0` at max toroidal distance `pc.fog.y` to protect wrap seam.
   - Headlamp forward light scattering (Henyey-Greenstein phase function).
   - sRGB gamma output with IGN dithering.
3. Write your handoff report to `C:\hades\gigahrush2\.agents\worker_m2_1\handoff.md`.
4. Send a message to the Lead Orchestrator summarizing your changes and referencing the report path.

</USER_REQUEST>
