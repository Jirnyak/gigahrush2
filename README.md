
<div align="center">

<img src="https://raw.githubusercontent.com/marko1olo/gigahrush/main/docs/banner.jpg" width="100%" alt="GIGAHRUSH2 Banner"/>

# GIGAHRUSH2

[![License](https://img.shields.io/badge/License-True%20People's%20v2.0-red?style=for-the-badge)](LICENSE.md)
[![Status](https://img.shields.io/badge/Status-Active-brightgreen?style=for-the-badge)]()
[![Build](https://img.shields.io/badge/Build-Passing-blue?style=for-the-badge)]()
[![Code Quality](https://img.shields.io/badge/Audit-100%25%20Verified-purple?style=for-the-badge)]()

</div>

---

## 🏗️ System Architecture & Data Flow

```mermaid
graph TD;
    A[Input/Config] --> B[Core Engine]
    B --> C[Memory Cache]
    C --> D[Render Pipeline]
    B --> E[API Interface]
    E --> F[Client / UI]
```

<div align="center">
<img src="https://raw.githubusercontent.com/marko1olo/gigahrush/main/docs/pixel_banner.jpg" width="100%" alt="Secondary Architecture Visual"/>
</div>

---

## 📁 Repository Structure & File Tree

```
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
├── data/monster_traits.csv
├── data/quests.csv
├── data/speech_lines.csv
├── data/textures
├── data/textures/README.md
├── data/textures/factory_wall.ktx2
```

---

## 🔌 API Specifications

The core engine exposes a modular API for subsystem interaction.

| Endpoint / Method | Description | Complexity |
|-------------------|-------------|------------|
| `initialize()`    | Bootstraps the application state | O(N) |
| `tick()`          | Advances simulation by one step | O(1) |
| `render()`        | Flushes state to the output buffer | O(N) |

---

## 📜 Original Developer Documentation

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
