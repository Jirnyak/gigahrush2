# PR Pass 96: Reddit Auto-Paste Shadow DOM Fix
**Date:** 2026-06-11

## Objective
Owner reported that the previous AppleScript (`do_paste.scpt`) ran, but left the Reddit submission fields blank. Modern Reddit (`shreddit-app`) uses a deep Shadow DOM hierarchy, which breaks standard `document.querySelector` targeting.

## Actions Taken
1. Rewrote `PRCampaign/do_paste.scpt` to include a recursive `findDeep` JavaScript function.
2. The JS payload now traverses `NodeFilter.SHOW_ELEMENT` and dives into `node.shadowRoot` to find `faceplate-textarea-input`, `shreddit-composer`, and `contenteditable="true"` regions.
3. Executed the new script to open `r/indiegames/submit`, target the deeply hidden inputs, and automate `Cmd+V`.

## Results
The script executed successfully. Waiting for owner to confirm if the text was correctly pasted into the Reddit interface this time. If successful, this Shadow DOM traversal technique will be standard for future Reddit posts. If it fails again, fallback will be to pass `?title=...&text=...` directly into the Reddit URL.
