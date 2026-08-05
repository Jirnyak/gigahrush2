import os
from PIL import Image

def fill_image(src_path, dst_path, target_size):
    img = Image.open(src_path).convert("RGB")
    target_w, target_h = target_size
    img_ratio = img.width / img.height
    target_ratio = target_w / target_h

    if img_ratio > target_ratio:
        new_h = target_h
        new_w = int(new_h * img_ratio)
    else:
        new_w = target_w
        new_h = int(new_w / img_ratio)

    img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
    left = (new_w - target_w) / 2
    top = (new_h - target_h) / 2
    img = img.crop((left, top, left + target_w, top + target_h))
    
    img.save(dst_path, "JPEG", quality=95)

os.makedirs('gamepush_final/1280x720', exist_ok=True)
os.makedirs('gamepush_final/720x1280', exist_ok=True)

screenshots = [f for f in sorted(os.listdir('.')) if f.startswith('Screenshot') and f.endswith('.png')]

for i, s in enumerate(screenshots):
    fill_image(s, f"gamepush_final/1280x720/screenshot_{i+1}.jpg", (1280, 720))
    fill_image(s, f"gamepush_final/720x1280/screenshot_{i+1}.jpg", (720, 1280))

# Also make the backgrounds and icons using the same pure stretch fill
fill_image(screenshots[0], "gamepush_final/cover_landscape_1920x1080.jpg", (1920, 1080))
fill_image(screenshots[0], "gamepush_final/background_1920x1080.jpg", (1920, 1080))
fill_image("Screenshot 2026-06-15 at 00.45.13.png", "gamepush_final/cover_portrait_1080x1920.jpg", (1080, 1920))
fill_image(screenshots[0], "gamepush_final/icon_800x1200.jpg", (800, 1200))
print("Done")
