#!/bin/bash

say "Переключаю на новую волну. Пожалуйста, включите английскую раскладку."
sleep 4
say "Отправляю."

TEXT="Привет! Я автор браузерного survival horror / ARPG \"ГИГАХРУЩ\".
Сеттинг: бесконечная бетонная панелька, Самосбор, аномалии и симуляция жизни (A-Life).
Сделано с нуля на TypeScript + WebGL без сторонних движков. Работает сразу в браузере, ничего качать не нужно.
Недавно мы выпустили патчи с оптимизацией FPS и английским языком, игра сейчас активно собирает фидбек.

Играть: https://myindie.ru/games/game/gigahrush
ТГ проекта: https://t.me/gigah_rush

Буду рад, если проект покажется интересным. Спасибо!"

echo "$TEXT" | pbcopy

TARGETS=("nightingle1" "vhailor" "Crunchnp" "tproger_sales_bot" "Mahooney1")

for TARGET in "${TARGETS[@]}"; do
    open "tg://resolve?domain=$TARGET"
    sleep 1.5
    
    osascript -e 'tell application "System Events"' \
              -e 'keystroke "v" using command down' -e 'delay 0.5' -e 'keystroke return' \
              -e 'end tell'
    
    sleep 1
done

say "Свежая рассылка завершена."
