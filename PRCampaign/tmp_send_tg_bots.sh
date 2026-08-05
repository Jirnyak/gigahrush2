#!/bin/bash

pbcopy <<< "Привет! Я автор браузерного survival horror / ARPG \"ГИГАХРУЩ\".
Сеттинг: бесконечная бетонная панелька, Самосбор, аномалии и симуляция жизни (A-Life).
Сделано с нуля на TypeScript + WebGL без сторонних движков. Работает сразу в браузере, ничего качать не нужно.
Недавно мы выпустили патчи с оптимизацией FPS и английским языком, игра сейчас активно собирает фидбек.

Играть: https://myindie.ru/games/game/gigahrush
ТГ проекта: https://t.me/gigah_rush

Буду рад, если проект покажется интересным для публикации. Спасибо!"

bots=("KwagaGames_robot" "RythmOffers_Bot" "catgeekbot" "SikriPredlozhka_bot")

for bot in "${bots[@]}"; do
    echo "Processing Telegram Bot: $bot"
    osascript <<AS
    tell application "Google Chrome"
        activate
        set tgWin to missing value
        set tgTab to missing value
        set tgTabIndex to 0
        repeat with w in windows
            set t_index to 1
            repeat with t in tabs of w
                if URL of t contains "web.telegram.org" then
                    set tgWin to w
                    set tgTab to t
                    set tgTabIndex to t_index
                    exit repeat
                end if
                set t_index to t_index + 1
            end repeat
            if tgWin is not missing value then exit repeat
        end repeat
        
        if tgWin is not missing value then
            set active tab index of tgWin to tgTabIndex
            set index of tgWin to 1
            set URL of tgTab to "https://web.telegram.org/a/#?tgaddr=tg%3A%2F%2Fresolve%3Fdomain%3D" & "$bot"
        end if
    end tell
    
    delay 4
    
    tell application "Google Chrome"
        if tgWin is not missing value then
            tell tgTab
                execute javascript "
                    var input = document.querySelector('#editable-message-text');
                    if (input) input.focus();
                "
            end tell
        end if
    end tell

    delay 1

    tell application "System Events"
        keystroke "v" using command down
        delay 1
        key code 36
        delay 2
    end tell
AS
done
echo "Telegram finished."
