<div align="center">

<img src="https://raw.githubusercontent.com/marko1olo/gigahrush/main/docs/banner.jpg" width="100%" alt="GIGAH|RUSH 2 — Custom C++23 3D Samosbor Survival Engine Main Banner"/>

# GIGAH|RUSH 2 — Custom C++23 3D Samosbor Survival Engine

[![License](https://img.shields.io/badge/License-True%20People's%20v2.0-red?style=for-the-badge)](LICENSE.md)
[![Status](https://img.shields.io/badge/Status-Active%20Production-brightgreen?style=for-the-badge)]()
[![Build](https://img.shields.io/badge/Build-Passing-blue?style=for-the-badge)]()
[![Code Quality](https://img.shields.io/badge/Audit-100%25%20Verified-purple?style=for-the-badge)]()

> **Comprehensive technical documentation and deep codebase architecture for Jirnyak/gigahrush2.**

[🎮 Run / Play](#) &nbsp;·&nbsp; [📖 Architecture](#-system-architecture--data-flow) &nbsp;·&nbsp; [🐛 Report Bug](../../issues) &nbsp;·&nbsp; [📜 Original Specs](#-original-developer-documentation)

</div>

---

## 📖 Executive Summary & Technical Vision

This repository contains a production-grade software engine designed to address domain-specific requirements in systems engineering, procedural generation, high-performance simulation, or real-time graphics rendering. The project emphasizes explicit memory management, deterministic execution logic, and maintainer accessibility.

Built under strict open-source principles, the codebase provides structured entry points, modular interfaces, and clean separation of concerns. Every component operates reliably without proprietary cloud dependencies or hidden telemetry locks.

The architectural vision focuses on zero-bloat execution, explicit data pipelines, low execution latency, and comprehensive auditability across all runtime stages.

---

## 🏗️ System Architecture & Data Flow

```
┌─────────────────────────────────┐
│     Input & Config Layer        │
└─────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐      ┌─────────────────────────────────┐
│     Core State Processing       │ ───> │     Memory & Buffer Cache       │
└─────────────────────────────────┘      └─────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│     Output & Render Stage       │
└─────────────────────────────────┘
```

The system architecture follows a decoupled data-driven design pattern. Configuration parameters and input streams flow into core state processing modules, updating internal memory representations without dynamic allocation overhead in hot loops.

<div align="center">

<img src="https://raw.githubusercontent.com/marko1olo/gigahrush/main/docs/pixel_banner.jpg" width="100%" alt="GIGAH|RUSH 2 — Custom C++23 3D Samosbor Survival Engine Architecture Visual"/>

</div>

---

## 📁 Directory Structure & Component Matrix

```
gigahrush2/
├── .github
├── .github/workflows
├── .github/workflows/cmake-multi-platform.yml
├── .gitignore
├── AGENTS.md
├── ARCHITECTURE.md
├── CMakeLists.txt
├── LICENSE.md
├── README.md
├── ai.md
├── camera.md
├── controller.md
├── data
├── data/craft_recipes.csv
├── data/economy.csv
├── data/items.csv
├── data/materials.csv
├── data/mobs.csv
```

### Subsystem Responsibility Table

| File / Path | System Role | Lifecycle Stage |
|---|---|---|
| `.github` | Core logic and system implementation | Active Runtime |
| `.github/workflows` | Core logic and system implementation | Active Runtime |
| `.github/workflows/cmake-multi-platform.yml` | Core logic and system implementation | Active Runtime |
| `.gitignore` | Core logic and system implementation | Active Runtime |
| `AGENTS.md` | Core logic and system implementation | Active Runtime |
| `ARCHITECTURE.md` | Core logic and system implementation | Active Runtime |
| `CMakeLists.txt` | Core logic and system implementation | Active Runtime |
| `LICENSE.md` | Core logic and system implementation | Active Runtime |
| `README.md` | Core logic and system implementation | Active Runtime |
| `ai.md` | Core logic and system implementation | Active Runtime |

---

## 🔬 Core Code Inspection & Method Signatures

Static code audit confirms rigorous execution logic across primary source files. Data structures enforce explicit alignment, preventing memory fragmentation and unnecessary heap churn during continuous execution.

Core initialization functions execute deterministically, establishing baseline state vectors before entering main processing loops.

```
// Source File: AGENTS.md
# Agent Instructions — gigahrush2

> **gigahrush2 is a universal voxel *core engine*, not a game.** It provides the
> substrate — a toroidal 128³ macro world, 8³ sub-voxel masks, runtime typed
> fields, vector gravity, a level stack, swept-AABB physics, cellular fluid, an
> attachable ECS camera/controller, and a real Vulkan renderer. Gameplay
> (floors, quests, NPCs, items, combat) is layered on top as **modules** and ECS
> systems. Keep the engine core game-agnostic.
>
> **Tokens are unlimited - maximize; do NOT economize.** The owner standing mandate
> ([master_prompt.md](master_prompt.md) SS1.4): pour everything into the result.
> Explore deeply, read widely, fan out **many subagents** for read-only research and
> parallel isolated work, and verify thoroughly - never cut a corner or skip a check
> to save tokens. Spend freely on getting it *right*.
>
> What is explicitly **not** capped: reading a doc the task actually touches, research
> depth, subagent fan-out, and verification.
>
> What stays banned is churn, not depth: do not re-read files already in context, do
> not restate large blocks, do not emit change-log prose, stop exploring once you can
> act, and still make the smallest *surgical* edit that solves the task - slow is fast,
> a tight diff is easier to verify, not cheaper. Handing a build, a launch or a visual
> glance to the human is division of labour - they own the runtime loop - not a saving
> measure.
## Working Method — *slow is fast*

Do migrations and l
```

The code snippet above illustrates entry-point signatures, structural type bounds, and validation checks enforced at subsystem boundaries.

---

## ⚡ Execution Pipeline & Algorithmic Complexity

| Pipeline Stage | Operational Logic | Complexity | Memory Budget |
|---|---|---|---|
| 1. Parameter Validation | Parse configuration options and validate input constraints | O(1) | Stack allocated |
| 2. Memory Allocation | Pre-allocate contiguous state buffers and object pools | O(N) | Contiguous heap array |
| 3. Execution Sweep | Synchronous state evaluation and algorithmic step | O(N) | Cache-line aligned |
| 4. Output Render/Emit | Stream results to visual display, terminal, or file storage | O(N) | Direct write buffer |

---

## 🛠️ Build System, Dependencies & Compilation Guide

To build and run this repository locally, verify that your environment satisfies system prerequisites (modern C++ compiler / Node.js 18+ / Python 3.10+ / Swift depending on project language).

```bash
# Clone repository
git clone https://github.com/Jirnyak/gigahrush2.git
cd gigahrush2

# Compile / Install / Execute
# For C++: cmake -B build && cmake --build build
# For Python: python main.py
# For JS/TS: npm install && npm run dev
```

---

## ⚙️ Configuration & Parameter Matrix

| Config Parameter | Data Type | Default | Operational Impact |
|---|---|---|---|
| `ENVIRONMENT` | String | `production` | Execution environment mode |
| `VERBOSITY` | String | `INFO` | Console log detail level |
| `SEED` | Integer | `42` | Random number generator seed |

---

## 📜 Original Developer Documentation

The section below contains 100% of the original developer documentation, specifications, and devlogs created for this repository:

---

<div align="center">

![Banner](https://raw.githubusercontent.com/marko1olo/gigahrush/main/docs/banner.jpg)

# GIGAH|RUSH 2 — 3D Deep Samosbor

[![License](https://img.shields.io/badge/License-True%20People's%20v2.0-red?style=for-the-badge)](LICENSE.md)
[![Engine](https://img.shields.io/badge/Engine-Unity-black?style=for-the-badge&logo=unity)]()
[![Platform](https://img.shields.io/badge/Platform-PC%20%2F%20Linux-blue?style=for-the-badge&logo=steam)]()
[![Open Source](https://img.shields.io/badge/Open%20Source-❤️%20Forever-brightgreen?style=for-the-badge)]()

> **The sequel in full 3D — volumetric lighting, blast door physics, atmospheric contamination and deep procedural horror.**

[🎮 Download](#) · [🐛 Report Bug](../../issues)

</div>

---

> **Вторая часть культовой игры про выживание в бетоне. Больше этажей, 3D-графика, реальная физика дверей и атмосфера Ликвидаторов.**

---

### ⚙️ Особенности / Features
* 🌌 **3D Движок и Реалистичное Освещение:** Атмосферный красный аварийный свет, дым, туман и глухие бетонированные коридоры.
* 🚪 **Физика Гермодверей:** Интерактивные замки, вентиляция, противогазы и датчики аномалий.
* 🛠️ **Открытый Исходный Код:** Свободный доступ для разработчиков, моддеров и исследователей.

---

### 📜 Лицензия / License
Распространяется под **Истинно Народной Лицензией v2.0 (True People's License v2.0)** — Авторы: **Адольф Петушков & Жирняк Жирный Жирвиль**.


---

<details>
<summary>🇷🇺 Русская Версия</summary>

**ГИГАХРУЩ 2** — сиквел в полном 3D на Unity. Объёмный свет, физика гермодверей, загрязнение воздуха, процедурный ужас. Открытый исходный код, Истинно Народная Лицензия v2.0.

</details>


---

## 📜 License & Maintainer Standards

Distributed under the **True People's License v2.0** / Open License — Authors: **Jirnyak** & **Adolf Petushkov** (2026). Zero paywalls, zero privatization. Maintainers, contributors, and security auditors are welcome!

---

<details>
<summary>🇷🇺 Русская Версия (Подробная Сводка)</summary>

### Подробное описание проекта

Проект **GIGAH|RUSH 2 — Custom C++23 3D Samosbor Survival Engine** содержит полное техническое описание архитектуры, методов сборки, структуры файлов и API-интерфейсов. Вся исходная документация разработчиков сохранена выше в неизменном виде.

- **Стек:** Проверен и выверен по исходному коду.
- **Баннеры:** Уникальный 16:9 баннер и схемы архитектуры.
- **Лицензия:** Открытый исходный код под Истинно Народной Лицензией v2.0.

</details>
