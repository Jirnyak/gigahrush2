#!/bin/bash

# Оповещение пользователя голосом, чтобы не трогал клавиатуру
say "Запускаю третью волну Телеграм. Пожалуйста, не трогайте клавиатуру двадцать секунд."

TEXT="Привет! Я автор браузерного survival horror / ARPG \"ГИГАХРУЩ\".
Сеттинг: бесконечная бетонная панелька, Самосбор, аномалии и симуляция жизни (A-Life).
Сделано с нуля на TypeScript + WebGL без сторонних движков. Работает сразу в браузере, ничего качать не нужно.
Недавно мы выпустили патчи с оптимизацией FPS и английским языком, игра сейчас активно собирает фидбек.

Играть: https://myindie.ru/games/game/gigahrush
ТГ проекта: https://t.me/gigah_rush

Буду рад, если проект покажется интересным для публикации. Спасибо!"

# Копируем текст в буфер обмена
echo "$TEXT" | pbcopy

# Список ботов-предложек
TARGETS=("KwagaGames_robot" "RythmOffers_Bot" "catgeekbot" "SikriPredlozhka_bot" "ixbtgamesbot")

for TARGET in "${TARGETS[@]}"; do
    echo "Открываю $TARGET..."
    open "tg://resolve?domain=$TARGET"
    sleep 2
    
    # Имитация ввода с клавиатуры через AppleScript
    osascript -e 'tell application "System Events"' \
              -e 'keystroke "/start"' -e 'delay 0.5' -e 'keystroke return' \
              -e 'delay 1.5' \
              -e 'keystroke "v" using command down' -e 'delay 0.5' -e 'keystroke return' \
              -e 'end tell'
    
    sleep 1
done

say "Рассылка завершена. Вы великолепны."
