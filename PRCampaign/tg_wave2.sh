#!/bin/bash

# Питч-текст для рассылки
PITCH="Привет! Мы сделали браузерный survival horror ГИГАХРУЩ — процедурный бетонный лабиринт, A-Life, рейкастер на WebGL и система Самосбора. Работает без скачивания прямо в браузере. Выкатили свежий билд и написали инженерный разбор архитектуры без движков!
Сыграть: https://gigahrush.bileter.workers.dev
Инженерный разбор: https://stopgame.ru/blogs/topic/121241/
Будем рады фидбеку!"

# Закидываем питч в буфер обмена macOS
printf "%s" "$PITCH" | pbcopy

TARGETS=(
    "korovany_chat"
    "webgl_ru"
    "typescript_ru"
    "js_ru"
    "godot_ru"
    "cg_art_chat"
    "narratorika_chat"
    "disdoc_chat"
    "marketing_games_chat"
    "thegamebiz_chat"
)

osascript -e 'tell application "Google Chrome" to activate'

for target in "${TARGETS[@]}"; do
    URL="https://web.telegram.org/a/#?tgaddr=tg%3A%2F%2Fresolve%3Fdomain%3D${target}"
    
    osascript <<EOF
    tell application "Google Chrome"
        set newTab to make new tab at end of tabs of window 1
        set URL of newTab to "$URL"
        set active tab index of window 1 to (index of newTab)
    end tell
EOF
    
    # Ждем загрузки интерфейса Telegram Web
    sleep 5
    
    # Фокус на поле ввода
    osascript <<EOF
    tell application "Google Chrome"
        tell active tab of window 1
            execute javascript "
                var input = document.querySelector('#editable-message-text');
                if (input) { input.focus(); input.click(); }
            "
        end tell
    end tell
EOF
    sleep 1
    
    # Вставка текста (Cmd + V)
    osascript -e 'tell application "System Events" to keystroke "v" using command down'
    sleep 1
    
    # Отправка сообщения (Enter)
    osascript -e 'tell application "System Events" to key code 36'
    sleep 2
    
    # Закрытие вкладки
    osascript -e 'tell application "Google Chrome" to close active tab of window 1'
    sleep 1
done

echo "TG Wave 2 completed successfully."
