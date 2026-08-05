import sys
from PIL import Image

def fill_image(src_path, dst_path, target_size):
    img = Image.open(src_path).convert("RGB")
    target_w, target_h = target_size
    img_ratio = img.width / img.height
    target_ratio = target_w / target_h

    if img_ratio > target_ratio:
        # Source is wider, scale height to target, crop width
        new_h = target_h
        new_w = int(new_h * img_ratio)
    else:
        # Source is taller, scale width to target, crop height
        new_w = target_w
        new_h = int(new_w / img_ratio)

    img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
    left = (new_w - target_w) / 2
    top = (new_h - target_h) / 2
    img = img.crop((left, top, left + target_w, top + target_h))
    
    img.save(dst_path, "JPEG", quality=95)
    print(f"Saved: {dst_path}")

fill_image("Screenshot 2026-06-15 at 00.45.13.png", "gamepush_premium/cover_portrait_1080x1920.jpg", (1080, 1920))
fill_image("Screenshot 2026-06-15 at 00.45.13.png", "Screenshot_004513_1080x1920.jpg", (1080, 1920))
