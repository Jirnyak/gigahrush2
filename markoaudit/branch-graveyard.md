# КЛАДБИЩЕ ВЕТОК — что снесено 2026-09-13 и куда смотреть, если понадобится

Уборка по решению владельца: разработка вернулась в `main`
([AGENTS.md](../AGENTS.md)), всё остальное — мусор или архив.

**Перед сносом каждая ветка проверена на уникальное содержимое.** Ниже записаны
хеши концов. Git держит недостижимые объекты до сборки мусора, GitHub — дольше;
`git fetch origin <хеш>` или `https://github.com/Jirnyak/gigahrush2/commit/<хеш>`
поднимет любую из них, пока объекты живы. Это не обещание вечного хранения, а
адрес на случай «а вдруг».

## Снесено — содержимое УЖЕ в main (проверено файлом, не на память)

Агентские рабочие деревья лета, коммиты недостижимы, но код переделан и посажен
позже другими коммитами:

| Ветка | Конец | Что несла | Где это в main |
|---|---|---|---|
| `worktree-agent-a124bfcec402f1291` | `a37abce6` | walk_bits, suite_walkbits, room zones по битсету | `src/world/`, `tests/suite_walkbits.inl` |
| `worktree-agent-a4d979897e35a9f20` | `2f6c39c5` | то же + этап 1 верле | там же + `src/render/verlet_pass.h` |
| `worktree-agent-a574b3904b3a3530b` | `11dd5786` | VerletPass, verlet_sim.comp, GIGA_VERLET_PIN | `src/render/verlet_pass.h` |
| `worktree-agent-ad7fe295eb2be4d2b` | `8593ce92` | то же | там же |
| `worktree-agent-a2f503f1f5ce03178` | `b1a49294` | light_vis_bake, RebakeScheduler | `src/game/light_vis_bake.cpp` |
| `origin/light-vis-wip` | `b1a49294` | те же два коммита | там же |
| `worktree-agent-a797004f3252138e9` | `b974ce6a` | sub_march в los (пуля бьёт в субвоксель) | `src/world/los.h` |
| `worktree-agent-a9eee785e0b196164` | `6efbbaf7` | кап → каллер, проп-буфер диапазонами | `kRootPropInstances` в `main.cpp` |
| `worktree-agent-ac287eb16a64de69d` | `b1ccaa98` | лампы GpuHandoff + neon_tube | `src/render/verlet_pass.h`, `materials.csv` |
| `worktree-agent-acd5648e2f61969aa` | `350e683f` | клетка светосетки 256 Б (63 id) | `gpu_light_grid.h` `kGridCellBytes` |

`CONTINUE.md` помечал `a2f503f1f5ce03178` как «НЕДОДЕЛАНО, 2 коммита не в
torus». **Пометка протухла**: свет-бейк закрыт 2026-08-20, оба коммита по
содержанию в линии.

Ветки с НУЛЁМ уникальных коммитов (целиком содержатся в `main`), снесены без
оговорок: `torus`, `verlet-walkbits-clean`, `pick/marko-2026-08-13`,
`backup/origin-main-2026-08-15`, `marko/megastructure`,
`worktree-agent-a1fafc9ef846f1559`.

## Снесено — разобрано и ОТВЕРГНУТО ревью

78 коммитов marko1olo от 6–13 августа. Разбирались поштучно (пачки 13 и 15
августа; из всей партии уцелел один fast travel), вердикт записан в истории
`main` коммитом `cb7c141a` «правки мегаструктуры отвергнуты ревью (§55, §56)».

| Ветка | Конец | Коммитов |
|---|---|---|
| `origin/fix-z-axis-hardcodes` | `c9c28fff` | 38 |
| `origin/rescue/gemini-problem11-and-zaxis` | `37544f4e` | 40 |

## ОСТАВЛЕНО намеренно

* **`gh-pages`** — ветка развёртывания GitHub Pages. Снести = убить сайт.
* **`backup/origin-main-2026-08-06`** — **902 уникальных коммита**, дореформенная
  `main` до нещадной чистки. Единственная копия того состояния; ветка так и
  названа. Сносить такое отдельным решением, а не заодно с уборкой.
* **`dependabot/github_actions/*`** (4 шт.) — не мусор, а открытые PR на подъём
  версий GitHub Actions (checkout 4→7, deploy-pages 4→5, upload-pages-artifact
  3→5, configure-pages 4→6). Удаление ветки закрывает PR; их надо либо влить,
  либо закрыть осознанно.
