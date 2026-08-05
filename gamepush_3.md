# Замечание 3: Вызов GameReady (GameStart)

## Проблема
Метод GameStart вызывается не вовремя — одновременно с GameplayStart, на первый клик пользователя. По документации GamePush:
- `gameStart` — «после загрузки игры», т.е. когда меню готово
- `gameplayStart` — когда начинается активный геймплей

## Ограничение sandbox
GamePush Sandbox СТРОГО проверяет call stack. Вызов `gameStart` из `Promise.then()` или `setTimeout` — помечается "не инициирован пользователем" и проваливает Test 3 ("вовремя"). Перенос в async `markPlatformReady()` ломает тест — проверено экспериментально.

## Решение: двойной путь (dual-path)

1. **Синхронный путь (primary)**: В `markPlatformReady()` проверяем, доступен ли SDK на глобале **синхронно** (`portalGlobal().gp`). Если да — вызываем `gameStart` прямо здесь, без Promise chain. Это работает в sandbox, где SDK-скрипт уже preloaded.

2. **User-gesture fallback**: Если SDK ещё не загрузился к моменту `markPlatformReady()`, вызов `gameStart` произойдёт из `fulfillSandboxTests` по первому `pointerdown`/`keydown` — как было раньше.

3. **Флаг `gamePushGameStartSent`** гарантирует однократный вызов — какой путь сработает первым, тот и сделает вызов.

## Что нужно проверить в sandbox
- Test 3 ("Метод GameStart должен вызываться вовремя") — должен пройти
- Если в sandbox SDK preloaded: `gameStart` вызывается из `markPlatformReady` синхронно → ДО первого клика
- Если SDK не preloaded: `gameStart` вызывается на первый клик → как раньше (рабочий вариант)
