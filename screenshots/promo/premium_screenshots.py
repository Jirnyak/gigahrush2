import os
from PIL import Image, ImageFilter, ImageDraw

def process_premium(src_path, dst_path, target_size, bg_blur=25):
    try:
        img = Image.open(src_path).convert("RGBA")
        target_w, target_h = target_size
        
        img_ratio = img.width / img.height
        target_ratio = target_w / target_h
        
        # 1. Create blurred background covering the whole target area
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
        # Darken the background slightly so the foreground pops more
        bg_img = bg_img.point(lambda p: p * 0.7)
        
        # 2. Resize foreground image to fit inside target area
        if img_ratio > target_ratio:
            fg_w = target_w
            fg_h = int(fg_w / img_ratio)
        else:
            fg_h = target_h
            fg_w = int(fg_h * img_ratio)
            
        fg_img = img.resize((fg_w, fg_h), Image.Resampling.LANCZOS)
        
        # Create a drop shadow
        shadow = Image.new("RGBA", (fg_w, fg_h), (0, 0, 0, 180))
        # Add shadow to a larger transparent canvas to blur it
        shadow_canvas = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
        paste_x = (target_w - fg_w) // 2
        paste_y = (target_h - fg_h) // 2
        
        # Paste shadow offset by a few pixels
        shadow_canvas.paste(shadow, (paste_x + 8, paste_y + 12))
        shadow_canvas = shadow_canvas.filter(ImageFilter.GaussianBlur(radius=10))
        
        # Final composition
        final_img = bg_img.convert("RGBA")
        final_img.alpha_composite(shadow_canvas)
        final_img.paste(fg_img, (paste_x, paste_y), fg_img)
        
        final_img.convert("RGB").save(dst_path, "JPEG", quality=95)
        print(f"Premium saved: {dst_path}")
        return True
    except Exception as e:
        print(f"Error: {e}")
        return False

os.makedirs('gamepush_premium', exist_ok=True)
os.makedirs('gamepush_premium/screenshots_landscape', exist_ok=True)
os.makedirs('gamepush_premium/screenshots_portrait', exist_ok=True)

screenshots = [f for f in sorted(os.listdir('.')) if f.startswith('Screenshot') and f.endswith('.png')]

# Generate premium screenshots
for i, s in enumerate(screenshots[:5]):
    process_premium(s, f"gamepush_premium/screenshots_landscape/screenshot_{i+1}.jpg", (1280, 720))
    process_premium(s, f"gamepush_premium/screenshots_portrait/screenshot_{i+1}.jpg", (720, 1280))

# Also covers using same logic
process_premium(screenshots[0], "gamepush_premium/cover_landscape_1920x1080.jpg", (1920, 1080))
process_premium(screenshots[0], "gamepush_premium/cover_portrait_1080x1920.jpg", (1080, 1920))
process_premium(screenshots[0], "gamepush_premium/background_1920x1080.jpg", (1920, 1080), bg_blur=5) # Minimal blur for bg

# Icon with logo
def make_premium_icon(src, logo, dst, size):
    img = Image.open(src).convert("RGBA")
    # Same background logic
    target_w, target_h = size
    img_ratio = img.width / img.height
    target_ratio = target_w / target_h
    if img_ratio > target_ratio:
        bg_h = target_h
        bg_w = int(bg_h * img_ratio)
    else:
        bg_w = target_w
        bg_h = int(bg_w / img_ratio)
    bg = img.resize((bg_w, bg_h), Image.Resampling.LANCZOS)
    left = (bg_w - target_w) / 2
    top = (bg_h - target_h) / 2
    bg = bg.crop((left, top, left + target_w, top + target_h))
    bg = bg.filter(ImageFilter.GaussianBlur(radius=25))
    bg = bg.point(lambda p: p * 0.6) # Darker
    
    logo_img = Image.open(logo).convert("RGBA")
    lw, lh = logo_img.size
    max_w = target_w * 0.7
    scale = max_w / lw
    logo_img = logo_img.resize((int(lw*scale), int(lh*scale)), Image.Resampling.LANCZOS)
    
    # Shadow for logo
    lw, lh = logo_img.size
    shadow = Image.new("RGBA", (lw, lh), (0,0,0,180))
    sc = Image.new("RGBA", size, (0,0,0,0))
    lx = (target_w - lw)//2
    ly = (target_h - lh)//2
    sc.paste(shadow, (lx+10, ly+15))
    sc = sc.filter(ImageFilter.GaussianBlur(radius=15))
    
    final = bg.convert("RGBA")
    final.alpha_composite(sc)
    final.paste(logo_img, (lx, ly), logo_img)
    final.convert("RGB").save(dst, "JPEG", quality=95)

make_premium_icon(screenshots[0], "icon-512.png", "gamepush_premium/icon_800x1200.jpg", (800, 1200))

