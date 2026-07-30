# HANDOFF DOCUMENT — GigaHrush2 (Soviet Khrushchevka Visual & Gameplay Overhaul)

## 1. Project Location & Repository State
- **Workspace Directory**: `C:\hades\gigahrush2`
- **Git Branch**: `main` (synced with `origin/main`)
- **Build Command**: `build_cmd.bat`
- **Executable**: `build-win\Release\gigahrush2.exe`

---

## 2. Core User Feedback & Critiques

### A. Visual Aesthetics & Atmosphere
> *"Чувак, всё перепорчено, блядь. Ты на свои картинки посмотри. Отстегпак одни, блядь. Это не похоже на хрущёвку. Сделай хрущёвку, пожалуйста."*
> *"кабели - говно. серая хуйня - говно. это не пострйока и не интерьер. откл.чи оптимизм."*
> *"Эта плитка довольно таки пересвечена."*
> *"ну пол из кирпичей? будь реалистом!!!!!! земля, бетон, линолеум - пол. вариативно. стены - кирпич плитка, бетон."*

- **User Verdict**: **DECLINED**. The current procedural textures and low-poly block renders still read like generic asset pack white/grey boxes rather than a grim, moody, authentic Soviet Khrushchevka / Samosbor atmosphere.

---

## 3. Key Technical & Visual Targets for Next Agent

1. **Photorealistic Soviet Khrushchevka Textures**:
   - Replace procedural noise fallbacks with authentic Poly Haven / photorealistic PBR texture maps for walls, linoleum, parquet, concrete, and Soviet wallpaper.
   - Implement authentic Soviet panel walls: lower half glossy oil paint (green `пантоловый`/stairwell blue), upper half faded wallpaper with damp stains, cracks, and prominent precast panel joins (`панельные швы`).
2. **Prop & Environment Geometry Polish**:
   - Remove any generic placeholder boxes or blocky geometry.
   - Place realistic 3D props: cast-iron radiators (`чугунные батареи`), padded vinyl doors (`дерматиновые двери`), CRT monitors, realistic wall-mounted electrical conduit, switches, and junction boxes.
3. **Atmospheric Lighting & Fog**:
   - Eliminate flat ambient lighting and overexposed specular highlights.
   - Tuned filmic tone mapping with deep contrast, moody volumetric fog (Samosbor haze), and warm incandescent bulb light falloff (`лампочка Ильича`).

---

## 4. Mandatory Verification & Process Rules

- **Autonomy & Verification**: Execute commands via `build_cmd.bat`, generate screenshots with `gigahrush2.exe --shot C:\Temp\shot.png --no-hud`, copy to artifacts, inspect with `view_file`, and critique visually before showing the user.
- **Git Protocol**: Stage only modified files, commit with conventional commit messages, `git pull origin main --rebase`, and `git push origin main`.
- **Zero Sugarcoating**: Be brutally honest about visual flaws and test results.

---

## 5. Quick Start Instructions for Next Agent
1. Read `HANDOFF.md`.
2. Inspect `shaders/cube.frag`, `src/render/cube_pass.cpp`, `src/render/prop_placer.cpp`, and `src/game/floor_gen.cpp`.
3. Rebuild with `build_cmd.bat` and run `--shot` captures to analyze current visuals before starting work.
