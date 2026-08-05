import os
from PIL import Image, ImageEnhance, ImageFilter, ImageDraw

def get_best_crop(img, target_ratio):
    w, h = img.size
    current_ratio = w / h
    if current_ratio > target_ratio:
        # Image is wider than needed, crop sides
        new_w = int(h * target_ratio)
        left = (w - new_w) // 2
        return img.crop((left, 0, left + new_w, h))
    else:
        # Image is taller than needed, crop top/bottom
        new_h = int(w / target_ratio)
        top = (h - new_h) // 2
        return img.crop((0, top, w, top + new_h))

def make_screenshot(src, dst, size):
    img = Image.open(src).convert("RGB")
    cropped = get_best_crop(img, size[0]/size[1])
    resized = cropped.resize(size, Image.Resampling.LANCZOS)
    resized.save(dst, "JPEG", quality=95)
    print(f"HQ Screenshot: {dst}")

def make_cover(src, icon_src, dst, size):
    img = Image.open(src).convert("RGB")
    cropped = get_best_crop(img, size[0]/size[1])
    bg = cropped.resize(size, Image.Resampling.LANCZOS)
    
    # Darken background to make logo pop
    enhancer = ImageEnhance.Brightness(bg)
    bg = enhancer.enhance(0.5)
    
    # Add subtle blur
    bg = bg.filter(ImageFilter.GaussianBlur(radius=2))
    
    if icon_src and os.path.exists(icon_src):
        icon = Image.open(icon_src).convert("RGBA")
        # Resize icon to 40% of the width or height (whichever is smaller)
        icon_max_size = min(size[0], size[1]) * 0.45
        icon_ratio = icon.width / icon.height
        if icon.width > icon.height:
            new_w = int(icon_max_size)
            new_h = int(new_w / icon_ratio)
        else:
            new_h = int(icon_max_size)
            new_w = int(new_h * icon_ratio)
            
        icon = icon.resize((new_w, new_h), Image.Resampling.LANCZOS)
        
        # Add drop shadow to icon
        shadow = Image.new("RGBA", icon.size, (0, 0, 0, 0))
        shadow_draw = ImageDraw.Draw(shadow)
        # Not perfect drop shadow, but we can paste it offset
        
        x = (size[0] - new_w) // 2
        y = (size[1] - new_h) // 2
        
        # Simple drop shadow by pasting black version of icon slightly offset
        shadow_layer = icon.copy()
        alpha = shadow_layer.split()[3]
        alpha = alpha.point(lambda p: p * 0.7) # reduce opacity
        black = Image.new("RGBA", shadow_layer.size, (0, 0, 0, 255))
        black.putalpha(alpha)
        
        bg.paste(black, (x+10, y+10), black)
        bg.paste(icon, (x, y), icon)
        
    bg.save(dst, "JPEG", quality=95)
    print(f"HQ Cover: {dst}")

os.makedirs('gamepush_hq', exist_ok=True)
os.makedirs('gamepush_hq/screenshots_landscape', exist_ok=True)
os.makedirs('gamepush_hq/screenshots_portrait', exist_ok=True)

screenshots = [f for f in sorted(os.listdir('.')) if f.startswith('Screenshot') and f.endswith('.png')]

# Screenshots
for i, s in enumerate(screenshots[:5]):
    make_screenshot(s, f"gamepush_hq/screenshots_landscape/screenshot_{i+1}.jpg", (1280, 720))
    make_screenshot(s, f"gamepush_hq/screenshots_portrait/screenshot_{i+1}.jpg", (720, 1280))

# Background (clean, no logo)
make_screenshot(screenshots[0], "gamepush_hq/background_1920x1080.jpg", (1920, 1080))

# Covers
make_cover(screenshots[0], "icon-512.png", "gamepush_hq/cover_landscape_1920x1080.jpg", (1920, 1080))
make_cover(screenshots[0], "icon-512.png", "gamepush_hq/cover_portrait_1080x1920.jpg", (1080, 1920))
make_cover(screenshots[0], "icon-512.png", "gamepush_hq/icon_800x1200.jpg", (800, 1200))
