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
        return "Found"
    else
        return "Not found"
    end if
end tell
