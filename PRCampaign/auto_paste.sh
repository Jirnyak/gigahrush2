#!/bin/bash
TITLE="Как устроен ГИГАХРУЩ: клеточный мир, WebGL-рейкастер и A-Life без движка"
BODY_FILE="/Users/jirnyak/Mirror/gigahrush/PRCampaign/longread_article_2026-06-09.md"

# ================================
# StopGame
# ================================
printf "%s" "$TITLE" | pbcopy
osascript <<EOF
tell application "Google Chrome"
    activate
    set tgWin to missing value
    set tgTab to missing value
    repeat with w in windows
        set t_index to 1
        repeat with t in tabs of w
            if URL of t contains "stopgame.ru/blogs/add" then
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
                var t = document.querySelector('textarea[placeholder*=\"Заголовок\"]');
                if (t) { t.focus(); t.click(); }
            "
        end tell
    end if
end tell
EOF
sleep 1
osascript -e 'tell application "System Events" to keystroke "v" using command down'
sleep 1

cat "$BODY_FILE" | pbcopy
osascript <<EOF
tell application "Google Chrome"
    set tgWin to missing value
    set tgTab to missing value
    repeat with w in windows
        set t_index to 1
        repeat with t in tabs of w
            if URL of t contains "stopgame.ru/blogs/add" then
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
osascript -e 'tell application "System Events" to keystroke "v" using command down'
sleep 2

# ================================
# PlayGround
# ================================
printf "%s" "$TITLE" | pbcopy
osascript <<EOF
tell application "Google Chrome"
    activate
    set tgWin to missing value
    set tgTab to missing value
    repeat with w in windows
        set t_index to 1
        repeat with t in tabs of w
            if URL of t contains "playground.ru/post/" then
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
                var t = document.querySelector('textarea[placeholder*=\"заголовок\"]');
                if (t) { t.focus(); t.click(); }
            "
        end tell
    end if
end tell
EOF
sleep 1
osascript -e 'tell application "System Events" to keystroke "v" using command down'
sleep 1

cat "$BODY_FILE" | pbcopy
osascript <<EOF
tell application "Google Chrome"
    set tgWin to missing value
    set tgTab to missing value
    repeat with w in windows
        set t_index to 1
        repeat with t in tabs of w
            if URL of t contains "playground.ru/post/" then
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
                var b = document.querySelector('.public-DraftEditor-content');
                if (b) { b.focus(); b.click(); }
            "
        end tell
    end if
end tell
EOF
sleep 1
osascript -e 'tell application "System Events" to keystroke "v" using command down'
sleep 2
