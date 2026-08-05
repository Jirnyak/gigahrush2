import os
import subprocess
from PIL import Image, ImageFilter

def process_image(src_path, dst_path, target_size, bg_blur=15, add_icon=None):
    try:
        img = Image.open(src_path).convert("RGB")
        target_w, target_h = target_size
        
        # Calculate aspect ratios
        img_ratio = img.width / img.height
        target_ratio = target_w / target_h
        
        # 1. Resize image to cover the target size for the background
        if img_ratio > target_ratio:
            bg_h = target_h
            bg_w = int(bg_h * img_ratio)
        else:
            bg_w = target_w
            bg_h = int(bg_w / img_ratio)
            
        bg_img = img.resize((bg_w, bg_h), Image.Resampling.LANCZOS)
        left = (bg_w - target_w) / 2
        top = (bg_h - target_h) / 2
        bg_img = bg_img.crop((left, top, left + target_w, top + target_h))
        bg_img = bg_img.filter(ImageFilter.GaussianBlur(radius=bg_blur))
        
        # 2. Resize image to fit inside the target size
        if img_ratio > target_ratio:
            fg_w = target_w
            fg_h = int(fg_w / img_ratio)
        else:
            fg_h = target_h
            fg_w = int(fg_h * img_ratio)
            
        fg_img = img.resize((fg_w, fg_h), Image.Resampling.LANCZOS)
        
        # 3. Paste fg_img onto bg_img
        paste_x = (target_w - fg_w) // 2
        paste_y = (target_h - fg_h) // 2
        bg_img.paste(fg_img, (paste_x, paste_y))
        
        # 4. If an icon is provided, overlay it in the center
        if add_icon:
            icon = Image.open(add_icon).convert("RGBA")
            # scale icon if it's too large
            icon_w, icon_h = icon.size
            if icon_w > target_w * 0.8:
                scale = (target_w * 0.8) / icon_w
                icon = icon.resize((int(icon_w * scale), int(icon_h * scale)), Image.Resampling.LANCZOS)
                icon_w, icon_h = icon.size
            icon_x = (target_w - icon_w) // 2
            icon_y = (target_h - icon_h) // 2
            bg_img.paste(icon, (icon_x, icon_y), icon)

        bg_img.save(dst_path, "JPEG", quality=90)
        print(f"Generated {dst_path}")
        return True
    except Exception as e:
        print(f"Error processing {src_path}: {e}")
        return False

# Gather screenshots
screenshots = [f for f in sorted(os.listdir('.')) if f.startswith('Screenshot') and f.endswith('.png')]
if not screenshots:
    print("No screenshots found.")
    exit(1)

# Ensure dirs exist
os.makedirs('gamepush', exist_ok=True)
os.makedirs('gamepush/screenshots_landscape', exist_ok=True)
os.makedirs('gamepush/screenshots_portrait', exist_ok=True)

# Generate screenshots
for i, s in enumerate(screenshots[:5]):
    process_image(s, f"gamepush/screenshots_landscape/screenshot_{i+1}.jpg", (1280, 720))
    process_image(s, f"gamepush/screenshots_portrait/screenshot_{i+1}.jpg", (720, 1280))

# Generate Covers
best_screenshot = screenshots[0]
process_image(best_screenshot, "gamepush/cover_landscape_1920x1080.jpg", (1920, 1080))
process_image(best_screenshot, "gamepush/background_1920x1080.jpg", (1920, 1080), bg_blur=5) # For background, maybe a bit less blur but just game image
process_image(best_screenshot, "gamepush/cover_portrait_1080x1920.jpg", (1080, 1920))

# Generate Icon 800x1200
# Use a blurred screenshot as background and overlay icon-512.png
if os.path.exists('icon-512.png'):
    process_image(best_screenshot, "gamepush/icon_800x1200.jpg", (800, 1200), add_icon='icon-512.png')
else:
    process_image(best_screenshot, "gamepush/icon_800x1200.jpg", (800, 1200))

print("Image generation complete.")
