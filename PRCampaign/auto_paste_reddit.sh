#!/bin/bash

# We will just write a pure osascript, it's safer.

cat <<'APPLESCRIPT' > /Users/jirnyak/Mirror/gigahrush/PRCampaign/do_paste.scpt
set theTitle to "You know that \"Gigahrushchevka\" internet meme? I made a browser survival horror game inside it."

set theBody to "Hi everyone! 

A lot of people online know the \"Gigahrushchevka\" concept — the terrifying idea of an endless, infinite brutalist Soviet apartment block that goes on forever, like the Backrooms.

I loved the concept so much that I built a free browser survival-horror game out of it, called **GIGAH|RUSH**.

You start in a safe living area, pack your backpack with food, ammo, and medicine, and take the elevator into procedurally generated hostile floors. The world keeps living without you: NPCs trade, fight, and hide from **Samosbor** — a catastrophic event that seals doors, fills the corridors with purple fog, and wakes up monsters. 

It runs entirely in the browser (no installation or engine required, just pure WebGL/canvas).

You can play it here directly in your browser:
- Direct Web Build: https://gigahrush.bileter.workers.dev
- Itch.io: https://tenevik.itch.io/gigahrush

I'd love feedback on the horror atmosphere and whether the first expedition feels fair or too punishing!"

tell application "Google Chrome"
    activate
    tell window 1
        make new tab with properties {URL:"https://www.reddit.com/r/indiegames/submit"}
    end tell
end tell

delay 5

set the clipboard to theTitle
tell application "Google Chrome"
    activate
    tell active tab of window 1
        try
            execute javascript "
                var t = document.querySelector('textarea[placeholder*=\"Title\"], textarea[name=\"title\"]');
                if (t) { t.focus(); t.click(); }
            "
        end try
    end tell
end tell

delay 1
tell application "System Events" to keystroke "v" using command down
delay 1

set the clipboard to theBody
tell application "Google Chrome"
    activate
    tell active tab of window 1
        try
            execute javascript "
                var b = document.querySelector('div[role=\"textbox\"], div[contenteditable=\"true\"], textarea[name=\"text\"]');
                if (b) { b.focus(); b.click(); }
            "
        end try
    end tell
end tell

delay 1
tell application "System Events" to keystroke "v" using command down
delay 1
APPLESCRIPT

osascript /Users/jirnyak/Mirror/gigahrush/PRCampaign/do_paste.scpt
