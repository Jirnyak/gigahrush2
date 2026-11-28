#!/usr/bin/env python3
"""КУБИК — рамка и сеяная выборка для выборочной глубокой проверки кода.

Метод перенят из timaert (его AGENTS.md §5 п.15, владелец: «да хороший метод надо
запомнить»; решение владельца gigahrush2 2026-11-28 — скрипт в дереве, но НЕ гейт).
Скрипт НИЧЕГО НЕ СУДИТ и PASS не печатает: он выводит из кода три списка мест,
бросает по ним сеяный кубик и печатает выборку. Судят читатели (по наряду `--brief`),
каждое их «НОВОЕ» лид перепроверяет сам по коду и реестру; итог — строка журнала
(сид, рамка, СОШЛОСЬ / В ПЛАНЕ / НОВОЕ).

Три списка (рамка выводится из дерева заново на каждый бросок, нигде не хранится):
  1. ДВЕРИ  — свободные функции заголовков ядра (src/core, src/world, src/sim,
              src/ecs) и системные двери игры: `*_step` заголовков src/game плюс
              двери, которые канон называет единственными (CANON_DOORS ниже).
  2. ПОЛЯ   — члены структур заголовков-строк (список GIGA_ROW_HEADERS из
              tools/check_row_law.cmake) и пула жителей src/game/npc_pool.h.
  3. УТВЕРЖДЕНИЯ — строки SKELETON.md и CANON.md с адресом кода
              (`путь:строка «…»` или `символ@путь`).

Выборка: по 28 мест на список — 20 рабочих и 8 запасных по порядку (запас берут,
только если рабочее место судить невозможно). Сид — первые 8 hex головы (`git
rev-parse HEAD`), если не задан `--seed`. ГПСЧ — splitmix64 и частичный
Фишер–Йетс: выборка зависит только от (рамка, сид), не от версии Python.
Правило трёх: ноль расхождений из N мест значит «с уверенностью 95 % расходится
меньше 3/N мест» — 60 рабочих мест без НОВОГО дают «меньше 5 %».

Когда бросать: после закрытия эпика и перед новой стеной (гейтом, тестом).

    python3 tools/dice_frames.py                 # рамка + выборка от головы
    python3 tools/dice_frames.py --seed 1a2b3c4d # тот же бросок повторно
    python3 tools/dice_frames.py --out /tmp/dice # плюс JSON рамки и выборки
    python3 tools/dice_frames.py --brief         # наряд читателю
"""

import argparse
import json
import pathlib
import re
import subprocess
import sys

PICK = 28      # мест на список: 20 рабочих + 8 запасных
WORKING = 20

# Двери, которые канон называет единственными (CANON S22/S25/S27.1/S29, combat.h).
CANON_DOORS = {
    "serve_start", "serve_step", "needs_satisfy", "apply_damage", "guide_step",
    "encumbrance_step", "emplace_mob", "inventory_give", "carve_sphere",
}

CORE_DIRS = ("src/core", "src/world", "src/sim", "src/ecs")

KEYWORDS = {
    "if", "for", "while", "switch", "return", "sizeof", "static_assert", "alignof",
    "decltype", "defined", "operator", "noexcept", "requires", "alignas",
    "static_cast", "reinterpret_cast", "const_cast", "bit_cast",
}

FN_RE = re.compile(
    r"^\s*(?:template\s*<[^>]*>\s*)?(?:\[\[[a-z_]+\]\]\s*)*"
    r"(?:(?:inline|constexpr|static|friend|explicit|consteval)\s+)*"
    r"(?:const\s+)?[A-Za-z_][A-Za-z0-9_:<>,\s\*&]*?[\s\*&]([a-z_][A-Za-z0-9_]*)\s*\(")

MEMBER_RE = re.compile(
    r"^\s*(?:alignas\([^)]*\)\s*)?(?:mutable\s+)?"
    r"([A-Za-z_][A-Za-z0-9_:<>,\s\*&]*?)\s+([A-Za-z_][A-Za-z0-9_]*)"
    r"\s*(\[[^\]]*\])?\s*(?:=[^;]*|\{[^;]*\})?;")

ADDR_RE = re.compile(r"`(?:src|tests|shaders|tools)/[A-Za-z0-9_./+-]+:[0-9]+"
                     r"|`[A-Za-z_][A-Za-z0-9_:]*@(?:src|tests|shaders|tools)/[A-Za-z0-9_./+-]+`")


def strip_comment(line):
    return line.split("//", 1)[0]


def door_frame(repo):
    files = []
    for d in CORE_DIRS:
        files += sorted(p for p in (repo / d).glob("*.h"))
    game = sorted((repo / "src/game").rglob("*.h"))
    doors = []
    for path in files + game:
        rel = str(path.relative_to(repo))
        is_core = not rel.startswith("src/game/")
        seen = set()
        for n, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            s = strip_comment(raw)
            if not s.strip() or s.lstrip().startswith(("#", "*", "/")):
                continue
            m = FN_RE.match(s)
            if not m:
                continue
            name = m.group(1)
            head = s[:m.start(1)]
            if name in KEYWORDS or "=" in head or "(" in head or "return" in head.split():
                continue
            if not is_core and not (name.endswith("_step") or name in CANON_DOORS):
                continue
            if name in seen:
                continue
            seen.add(name)
            doors.append({"file": rel, "line": n, "name": name})
    return doors


def row_headers(repo):
    # Список — аргументы `set(GIGA_ROW_HEADERS …)`; в комментариях блока есть
    # скобки, поэтому конец ищется по `)` вне комментария.
    lines = (repo / "tools/check_row_law.cmake").read_text(encoding="utf-8").splitlines()
    heads, inside = [], False
    for raw in lines:
        code = raw.split("#", 1)[0]
        if not inside:
            if "set(GIGA_ROW_HEADERS" not in code:
                continue
            inside = True
            code = code.split("set(GIGA_ROW_HEADERS", 1)[1]
        heads += re.findall(r"src/[A-Za-z0-9_/]+\.h", code)
        if ")" in code:
            break
    heads = sorted(set(heads))
    if "src/game/npc_pool.h" not in heads:
        heads.append("src/game/npc_pool.h")
    return heads


def field_frame(repo):
    fields = []
    for rel in row_headers(repo):
        path = repo / rel
        if not path.exists():
            continue
        depth = 0
        stack = []  # (имя структуры, глубина её тела)
        pending = None
        for n, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            s = strip_comment(raw)
            sm = re.match(r"^\s*(?:struct|class)\s+(?:alignas\([^)]*\)\s*)?([A-Za-z_]\w*)\b[^;]*$", s)
            if sm:
                pending = sm.group(1)
            for ch in s:
                if ch == "{":
                    depth += 1
                    if pending is not None:
                        stack.append((pending, depth))
                        pending = None
                elif ch == "}":
                    if stack and stack[-1][1] == depth:
                        stack.pop()
                    depth -= 1
            if not stack or stack[-1][1] != depth:
                continue
            if "(" in s or re.match(r"^\s*(static|using|typedef|friend|enum|struct|class|public|private|protected)\b", s):
                continue
            for typ, name in member_decls(s):
                fields.append({"file": rel, "line": n, "struct": stack[-1][0],
                               "name": name, "type": typ})
    return fields


def top_level_split(text):
    """Режет по запятым глубины 0 (вне <>, {}, (), [])."""
    parts, depth, cur = [], 0, ""
    for ch in text:
        if ch in "<{([":
            depth += 1
        elif ch in ">})]":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    parts.append(cur)
    return parts


def member_decls(s):
    """`T a = 1, b{2};` -> [(T, a), (T, b)]; не член — пусто."""
    mm = MEMBER_RE.match(s)
    if not mm:
        return []
    body = s.strip()[:-1] if s.strip().endswith(";") else s.strip()
    parts = top_level_split(body)
    first = re.match(r"^(?:alignas\([^)]*\)\s*)?(?:mutable\s+)?(.*?)\s*([A-Za-z_]\w*)\s*(\[[^\]]*\])?\s*(?:=.*|\{.*\})?$",
                     parts[0].strip())
    if not first:
        return []
    typ = " ".join(first.group(1).split())
    out = [(typ, first.group(2))]
    for p in parts[1:]:
        m = re.match(r"^\s*\**\s*([A-Za-z_]\w*)", p)
        if m:
            out.append((typ, m.group(1)))
    return out


def claim_frame(repo):
    claims = []
    for doc in ("SKELETON.md", "CANON.md"):
        in_fence = False
        for n, raw in enumerate((repo / doc).read_text(encoding="utf-8").splitlines(), 1):
            if raw.lstrip().startswith("```"):
                in_fence = not in_fence
                continue
            if in_fence or raw.lstrip().startswith("#") or not ADDR_RE.search(raw):
                continue
            verdict = ("РАСХОЖДЕНИЕ" if "РАСХОЖДЕНИЕ" in raw
                       else "ПРАВДА" if "ПРАВДА" in raw else "")
            claims.append({"doc": doc, "line": n, "verdict": verdict,
                           "claim": " ".join(raw.split())})
    return claims


def splitmix64(state):
    state = (state + 0x9E3779B97F4A7C15) & 0xFFFFFFFFFFFFFFFF
    z = state
    z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & 0xFFFFFFFFFFFFFFFF
    z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & 0xFFFFFFFFFFFFFFFF
    return state, z ^ (z >> 31)


def sample(items, k, seed, salt):
    """Частичный Фишер–Йетс: первые k позиций перестановки индексов."""
    idx = list(range(len(items)))
    state = (seed * 0x100000001B3 + salt) & 0xFFFFFFFFFFFFFFFF
    for i in range(min(k, len(idx))):
        state, r = splitmix64(state)
        j = i + r % (len(idx) - i)
        idx[i], idx[j] = idx[j], idx[i]
    return [items[i] for i in idx[:min(k, len(idx))]]


BRIEF = """\
# Наряд читателю кубика (gigahrush2; метод timaert §5 п.15)

Ты проверяешь СЛУЧАЙНО выбранные места кода на соответствие законам проекта.
Только чтение: ничего не править, не собирать, не запускать, git не трогать,
файлов не создавать. Отвечай по-русски.

Закон — CANON.md (системы S1–S29) и AGENTS.md. Реальность кода с адресами —
SKELETON.md (грепом). Известные долги — строки РАСХОЖДЕНИЕ в SKELETON.md, разделы
problems.md (грепом по символу), очередь NEXT_SESSION.md.

Первые двадцать мест списка — выборка, следующие восемь — запас: бери запас по
порядку, только если рабочее место судить невозможно (символ исчез, строка пуста).

## Пять вопросов на каждое место — ответы только из кода

1. Что код делает с числами. Тело двери целиком и на уровень вниз; для поля —
   объявление и ширина; для утверждения — код по адресу. Арифметикой и колонками.
   Комментариям и именам НЕ ВЕРЬ.
2. Кто пишет и кто читает, со счётом. Грепом по src/ (tests/ отдельной строкой).
   Писателей поля больше одной двери — назови все; читателей ноль — «сирота».
3. Что говорит закон: раздел CANON (S-номер) или пункт AGENTS.md. Сходится ли код?
4. Записан ли долг: РАСХОЖДЕНИЕ в SKELETON.md, § в problems.md, пункт очереди
   NEXT_SESSION.md — назови адрес.
5. Вердикт — одно из трёх слов:
   СОШЛОСЬ — код делает то, что говорит закон; писатель один (или двери названы
             законом), читатели есть;
   В ПЛАНЕ — расходится, и расхождение уже записано (адрес) или закон сам говорит
             «строится / НЕ ИСПОЛНЕНО»;
   НОВОЕ   — расходится и нигде не записано: вторая дверь к той же величине,
             величина или функция без читателя, ветка «если нет — заведу сам»,
             ветка по виду или по носителю камеры, число без вывода в двери ядра,
             аллокация в тике, Z-up литерал, утверждение карты, которому код не
             соответствует.

Почерк агентов искать особо: дверь, чинящая отсутствующее предусловие; код,
достроенный вокруг остатка снесённой системы; параметр, одинаковый у всех
звонящих; функция без звонящих; `static thread_local` как скрытый scratch;
два ответа на один вопрос о мире.

## Правила суда

- Сомнение не есть находка. НОВОЕ — только когда код прочитан и счёт грепа это
  подтверждает; иначе СОШЛОСЬ или В ПЛАНЕ со словом «сомнение» и одной фразой.
- Генерация этажа (модули src/game/floors, генераторы) законами живого тика не
  судится: буферы и поиски там разрешены. src/app и src/render — оболочка:
  законы сима к ним не применяются, «рендер — только читатель» применяется.
- Не предлагай исправлений и не оценивай стиль.

## Отчёт

Таблица в двадцать строк, без вступления:
`№ · место · вердикт · писателей/читателей · закон · одна фраза сути`
Затем «НОВОЕ подробно» — по находке до пяти строк: что расходится, адреса,
команда грепа и её счёт, прочитан ли весь путь вызова. Итог одной строкой:
`ИТОГ: сошлось N · в плане N · новое N · не судимо N`. Не длиннее 90 строк.
"""


def main():
    ap = argparse.ArgumentParser(description="Рамка и сеяная выборка кубика (не гейт).")
    ap.add_argument("--repo", default=str(pathlib.Path(__file__).resolve().parent.parent))
    ap.add_argument("--seed", help="8 hex; по умолчанию — первые 8 hex HEAD")
    ap.add_argument("--out", help="каталог для JSON рамки и выборки (вне дерева)")
    ap.add_argument("--brief", action="store_true", help="напечатать наряд читателю")
    args = ap.parse_args()

    if args.brief:
        print(BRIEF)
        return 0

    repo = pathlib.Path(args.repo).resolve()
    if args.seed:
        seed_hex = args.seed
    else:
        seed_hex = subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"],
                                           text=True).strip()[:8]
    seed = int(seed_hex, 16)

    frames = {"doors": door_frame(repo), "fields": field_frame(repo), "claims": claim_frame(repo)}
    pick = {k: sample(v, PICK, seed, salt) for salt, (k, v) in enumerate(frames.items(), 1)}

    if args.out:
        out = pathlib.Path(args.out).resolve()
        if out == repo or repo in out.parents:
            print("отказ: --out внутри дерева — рамка и выборка скретч, не состояние проекта",
                  file=sys.stderr)
            return 2
        out.mkdir(parents=True, exist_ok=True)
        for k, v in frames.items():
            (out / f"frame_{k}.json").write_text(json.dumps(v, ensure_ascii=False, indent=0),
                                                 encoding="utf-8")
        (out / "sample.json").write_text(
            json.dumps({"seed": seed_hex, **pick}, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"рамка: двери {len(frames['doors'])}, поля {len(frames['fields'])}, "
          f"утверждения {len(frames['claims'])}; сид {seed_hex}")
    for k in ("doors", "fields", "claims"):
        print(f"\n== {k}")
        for i, it in enumerate(pick[k], 1):
            if i == WORKING + 1:
                print("   -- запас, по порядку --")
            if k == "doors":
                print(f"{i:2}. {it['name']}@{it['file']}:{it['line']}")
            elif k == "fields":
                print(f"{i:2}. {it['struct']}::{it['name']} ({it['type']}) @{it['file']}:{it['line']}")
            else:
                print(f"{i:2}. [{it['doc']}:{it['line']}] {it['claim'][:230]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
