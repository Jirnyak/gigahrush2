#!/bin/bash

# ================================
# StopGame
# ================================
cat /Users/jirnyak/Mirror/gigahrush/PRCampaign/post_stopgame.md | pbcopy
osascript <<EOF
tell application "Google Chrome"
    activate
    set tgWin to missing value
    set tgTab to missing value
    repeat with w in windows
        set t_index to 1
        repeat with t in tabs of w
            if URL of t contains "stopgame.ru/blogs/edit/121241" then
                set tgWin to w
                set tgTab to t
                set active tab index of tgWin to t_index
                set index of tgWin to 1
                exit repeat
            end if
            set t_index to t_index + 1
        end repeat
        if tgWin is not missing value then exit repeat
    end repeat
    
    if tgWin is not missing value then
        tell tgTab
            execute javascript "
                var b = document.querySelector('.ce-paragraph, .cdx-block, [contenteditable=\"true\"]');
                if (b) { b.focus(); b.click(); }
            "
        end tell
    end if
end tell
EOF
sleep 1
osascript -e 'tell application "System Events" to keystroke "a" using command down'
sleep 0.5
osascript -e 'tell application "System Events" to key code 51' # Delete
sleep 0.5
osascript -e 'tell application "System Events" to keystroke "v" using command down'
sleep 2

# ================================
# PlayGround
# ================================
cat /Users/jirnyak/Mirror/gigahrush/PRCampaign/post_playground.md | pbcopy
osascript <<EOF
tell application "Google Chrome"
    activate
    set tgWin to missing value
    set tgTab to missing value
    repeat with w in windows
        set t_index to 1
        repeat with t in tabs of w
            if URL of t contains "playground.ru/post/edit/1850988" then
                set tgWin to w
                set tgTab to t
                set active tab index of tgWin to t_index
                set index of tgWin to 1
                exit repeat
            end if
            set t_index to t_index + 1
        end repeat
        if tgWin is not missing value then exit repeat
    end repeat
    
    if tgWin is not missing value then
        tell tgTab
            execute javascript "
                var t = document.querySelector('textarea.form-control');
                if (t) { t.focus(); t.click(); }
            "
        end tell
    end if
end tell
EOF
sleep 1
osascript -e 'tell application "System Events" to keystroke "a" using command down'
sleep 0.5
osascript -e 'tell application "System Events" to key code 51' # Delete
sleep 0.5
osascript -e 'tell application "System Events" to keystroke "v" using command down'
sleep 2

# ================================
# XGM
# ================================
cat /Users/jirnyak/Mirror/gigahrush/PRCampaign/post_xgm.md | pbcopy
osascript <<EOF
tell application "Google Chrome"
    activate
    set tgWin to missing value
    set tgTab to missing value
    repeat with w in windows
        set t_index to 1
        repeat with t in tabs of w
            if URL of t contains "xgm.guru/p/xm/Kak-ustroen-GIGAKHRYSCH-kletochnyy-mir-WebGL-r-NJk/edit" then
                set tgWin to w
                set tgTab to t
                set active tab index of tgWin to t_index
                set index of tgWin to 1
                exit repeat
            end if
            set t_index to t_index + 1
        end repeat
        if tgWin is not missing value then exit repeat
    end repeat
    
    if tgWin is not missing value then
        tell tgTab
            execute javascript "
                var b = document.querySelector('#pagetext');
                if (b) { b.focus(); b.click(); }
            "
        end tell
    end if
end tell
EOF
sleep 1
osascript -e 'tell application "System Events" to keystroke "a" using command down'
sleep 0.5
osascript -e 'tell application "System Events" to key code 51' # Delete
sleep 0.5
osascript -e 'tell application "System Events" to keystroke "v" using command down'
sleep 2
