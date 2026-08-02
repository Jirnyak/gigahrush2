# Props — 3D interactive objects and decorations

> **Status: PLANNED.** Prop catalog and the 3-flag system are planned for the game layer (`src/game/`).
> Built on the ECS ([ecs.md](ecs.md)) and deeply anchored to the 3D sub-voxel world geometry.
>
> - **Source of truth:** Will be a universal prop table (e.g. `data/props.csv`) generated via a Python script (analogous to `items.csv`).
> - **Code:** To be implemented in `src/game/prop_table.h` / `.cpp`.

Props are interactive, physical, or decorative objects placed into the world. Unlike static sub-voxel geometry, props are distinct ECS entities that can move, react to physics, or be destroyed, while still anchoring natively into the toroidal 3D voxel world.

## The 3-Flag Props System

Every prop's physical behavior and lifecycle is governed by a **3-flag system**, dividing them into three distinct processing tiers:

1. **Physical Ragdolls**
   - Complex, multi-part props with full articulated physics (e.g., corpses, hanging cables, complex machines).
   - Handled by the main CPU physics engine.
   - Persistent entities.

2. **AABB (Axis-Aligned Bounding Box)**
   - Standard solid objects (crates, barrels, terminals, furniture).
   - Use swept-AABB collision against the $8^3$ sub-voxel masks and other entities.
   - Handled by the CPU physics engine but significantly cheaper to tick than ragdolls.

3. **Debris & Small Props (GPU Physics)**
   - Shrapnel, broken glass, shell casings, and tiny cosmetic scatter (осколки и маленькие пропы).
   - Handled entirely via **GPU physics** for massive scale with zero CPU tick overhead.
   - **Temporary:** they bounce, settle, and are then automatically despawned/deleted to preserve memory and maintain the O(N) tick budget.

## Universal Prop Table & Floor Generation

Like items and monsters, prop definitions live in a **single universal data table**.
- A dedicated floor generator module (part of the procedural floor generation) reads this table.
- Floors pull props from the table based on their rule-set, theme, and budget to populate the level.
- The generator does not hardcode prop logic; it simply spawns ECS entities based on the table's data.

## Visuals: Procedural vs. Asset-driven

- **Default:** Props are **procedural**, constructed dynamically or represented via generated voxel shapes.
- **Future:** A prop definition can specify its own explicit 3D model, texture, or sprite from the assets folder. This allows bespoke hero-props to seamlessly override the procedural default.

## Connections

Placed by the floor generator ([floors.md](floors.md)), simulated by [physics.md](physics.md) (CPU or GPU), and stored as [ecs.md](ecs.md) entities.
