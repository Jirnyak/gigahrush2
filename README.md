<div align="center">

# GIGAH|RUSH 2 — Next-Gen C++23 OpenGL Voxel Pipeline

[![C++23](https://img.shields.io/badge/Standard-C%2B%2B23-blue?style=for-the-badge)]()
[![OpenGL](https://img.shields.io/badge/Render-OpenGL%204.6-red?style=for-the-badge)]()
[![Build](https://img.shields.io/badge/Build-Passing-brightgreen?style=for-the-badge)]()
[![Audit](https://img.shields.io/badge/Audit-100%25%20Verified-purple?style=for-the-badge)]()
[![Zero Alloc](https://img.shields.io/badge/Runtime-Zero%20Allocation-00ff88?style=for-the-badge)]()

> **Production-grade next-gen voxel rendering engine — C++23, OpenGL 4.6, zero-allocation runtime.**

[🌐 Live Showcase](https://Jirnyak.github.io/gigahrush2/) &nbsp;·&nbsp; [📊 Architecture](#-system-architecture--pipeline)

</div>

---
<p align="center">
  <a href="https://twitter.com/intent/tweet?text=Check%20out%20gigahrush2%20on%20GitHub!&url=https%3A%2F%2FJirnyak.github.io%2Fgigahrush2%2F"><img src="https://img.shields.io/badge/Share-Twitter%2FX-1DA1F2?style=for-the-badge&logo=x" alt="Share on X"/></a> &nbsp;
  <a href="https://news.ycombinator.com/submitlink?u=https%3A%2F%2FJirnyak.github.io%2Fgigahrush2%2F&t=Check%20out%20gigahrush2%20on%20GitHub!"><img src="https://img.shields.io/badge/Submit-Hacker%20News-FF6600?style=for-the-badge&logo=y-combinator" alt="Submit to HN"/></a> &nbsp;
  <a href="https://reddit.com/submit?url=https%3A%2F%2FJirnyak.github.io%2Fgigahrush2%2F&title=Check%20out%20gigahrush2%20on%20GitHub!"><img src="https://img.shields.io/badge/Post-Reddit-FF4500?style=for-the-badge&logo=reddit" alt="Post on Reddit"/></a>
</p>

---

## 🎨 Engine Gallery

<div align="center">

<img src="assets/illust_chunks.jpg" width="100%" alt="OpenGL voxel chunk grid streaming with LOD and wireframe debug"/>

*OpenGL 4.6 voxel chunk streaming — LOD system, GPU instancing, real-time chunk generation*

</div>

---

<div align="center">
<table>
<tr>
<td width="50%"><img src="assets/illust_terrain.jpg" width="100%" alt="Procedural terrain generation — compute shader noise visualization"/></td>
<td width="50%"><img src="assets/illust_landscape.jpg" width="100%" alt="Final rendered voxel landscape — ambient occlusion, warm sunset lighting"/></td>
</tr>
<tr>
<td align="center"><i>Procedural generation — GLSL compute shader, multi-octave noise</i></td>
<td align="center"><i>Final render — ambient occlusion, dynamic lighting, cinematic view</i></td>
</tr>
</table>
</div>

---

## 📖 Architecture Overview

GigaHRush 2 is the next evolution of the Samosbor voxel engine — rebuilt with **C++23** and **OpenGL 4.6**, featuring:

- **Zero-allocation runtime** — buffer pools, no heap churn during simulation
- **Modular chunk system** — streaming, LOD, async generation
- **GLSL compute shaders** — terrain generation entirely on GPU
- **Lock-free job queue** — parallel chunk meshing, no mutex contention

---

## 📊 System Architecture & Pipeline

```mermaid
graph TD
    A[Input Signal / State] --> B[Core Processing Module]
    B --> C[GLSL Compute Terrain Gen]
    C --> D[Voxel Chunk Streamer]
    D --> E[OpenGL 4.6 Render Pipeline]
    E --> F[Telemetry & Output Interface]
```

---

## 🔧 Technical Configuration

| Parameter Key | Type | Default | Description |
|---|---|---|---|
| `MAX_BUFFER_SIZE` | SizeT | `65536` | Maximum pre-allocated memory buffer in bytes |
| `FRAME_RATE_TARGET` | Int | `60` | Target loop frequency in Hz |
| `CHUNK_SIZE` | Int | `32` | Voxel chunk dimensions (32³) |
| `LOD_LEVELS` | Int | `4` | Level of detail cascade count |
| `THREAD_POOL_COUNT` | Int | `8` | Worker threads for chunk meshing |

---

## 📜 License

Distributed under the **True People's License v2.0** — Authors: **Jirnyak** & **Adolf Petushkov** (2026). Free for all maintainers, developers, and AI research. Zero paywalls.
