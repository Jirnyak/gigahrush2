import base64
import subprocess
import sys
import time

def inject_image(image_path, filename):
    with open(image_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode('utf-8')
    
    js = f"""
    (async function() {{
        const b64 = "data:image/jpeg;base64,{b64}";
        const res = await fetch(b64);
        const blob = await res.blob();
        const file = new File([blob], "{filename}", {{ type: 'image/jpeg' }});
        
        const dt = new DataTransfer();
        dt.items.add(file);
        
        let target = document.activeElement;
        if (!target || target === document.body) {{
            target = document.querySelector('.ce-block') || document.querySelector('.ce-paragraph') || document.body;
        }}
        
        const pasteEvent = new ClipboardEvent('paste', {{
            clipboardData: dt,
            bubbles: true,
            cancelable: true
        }});
        
        target.dispatchEvent(pasteEvent);
        
        const dropEvent = new DragEvent('drop', {{
            dataTransfer: dt,
            bubbles: true,
            cancelable: true
        }});
        target.dispatchEvent(dropEvent);
        
        return "Injected " + "{filename}";
    }})();
    """
    
    script = f'''
    tell application "Google Chrome"
        tell active tab of window 1
            execute javascript "{js}"
        end tell
    end tell
    '''
    
    res = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
    print("AppleScript Result:", res.stdout.strip())
    if res.stderr:
        print("AppleScript Error:", res.stderr.strip(), file=sys.stderr)

if __name__ == "__main__":
    inject_image("/Users/jirnyak/Mirror/gigahrush/screenshots/promo/gamepush_premium/screenshots_landscape/screenshot_2.jpg", "screenshot_2.jpg")
    time.sleep(1)
    inject_image("/Users/jirnyak/Mirror/gigahrush/screenshots/promo/gamepush_premium/screenshots_landscape/screenshot_4.jpg", "screenshot_4.jpg")
