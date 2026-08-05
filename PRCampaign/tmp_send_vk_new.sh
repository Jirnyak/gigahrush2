#!/bin/bash

pbcopy <<< "Браузерный survival horror / ARPG без движка про вылазки в бесконечной хрущевке.

Разрабатываю ГИГАХРУЩ — игру, где NPC живут своей жизнью (A-Life), фракции делят этажи, а САМОСБОР заставляет прятаться за гермодверями и меняет геометрию уровня. Работает прямо в браузере (написано с нуля на TypeScript + WebGL).

За последние пару недель игра получила крутой фидбек от инди-комьюнити. Мы оптимизировали просадки FPS на толпах монстров и добавили английский язык. Буду рад, если оцените геймплей и атмосферу. Первые 10 минут особенно важны — пишите, если интерфейс кажется сложным.

Играть в браузере: https://myindie.ru/games/game/gigahrush
Следить за разработкой в ТГ: https://t.me/gigah_rush"

urls=("vk.com/indie_games_ru" "vk.com/world_of_indie" "vk.com/indie_ru" "vk.com/the_indie_go" "vk.com/vkplay")

# Open tabs first
osascript <<AS
tell application "Google Chrome"
    activate
    open location "https://vk.com/indie_games_ru"
    delay 0.5
    open location "https://vk.com/world_of_indie"
    delay 0.5
    open location "https://vk.com/indie_ru"
    delay 0.5
    open location "https://vk.com/the_indie_go"
    delay 0.5
    open location "https://vk.com/vkplay"
end tell
AS

delay 3 # Wait for tabs to load

for url in "${urls[@]}"; do
    echo "Processing VK: $url"
    osascript <<AS
    tell application "Google Chrome"
        activate
        set vkWin to missing value
        set vkTab to missing value
        set vkTabIndex to 0
        repeat with w in windows
            set t_index to 1
            repeat with t in tabs of w
                if URL of t contains "$url" then
                    set vkWin to w
                    set vkTab to t
                    set vkTabIndex to t_index
                    exit repeat
                end if
                set t_index to t_index + 1
            end repeat
            if vkWin is not missing value then exit repeat
        end repeat
        
        if vkWin is not missing value then
            set active tab index of vkWin to vkTabIndex
            set index of vkWin to 1
        end if
    end tell
    
    delay 1
    
    tell application "Google Chrome"
        if vkWin is not missing value then
            tell vkTab
                execute javascript "
                    var suggestBtn = document.querySelector('#submit_post_box') || document.querySelector('.page_msg_btn');
                    if (suggestBtn) suggestBtn.click();
                    setTimeout(function() {
                        var field = document.querySelector('#post_field') || document.querySelector('.mail_box_editable');
                        if (field) field.focus();
                    }, 500);
                "
            end tell
        end if
    end tell

    delay 1.5

    tell application "System Events"
        keystroke "v" using command down
        delay 1
        key code 36
        delay 2
    end tell
    
    tell application "Google Chrome"
        if vkWin is not missing value then
            tell vkTab
                execute javascript "
                    var sendBtn = document.querySelector('#send_post') || document.querySelector('.mail_box_send');
                    if (sendBtn && sendBtn.style.display !== 'none') sendBtn.click();
                "
            end tell
        end if
    end tell
    delay 1
AS
done
echo "New VK batch finished."
