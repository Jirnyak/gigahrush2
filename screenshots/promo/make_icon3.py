import sys
from PIL import Image, ImageFilter

icon = Image.open("icon-512.png").convert("RGBA")
target_size = (512, 384)

# Blurred background version
bg = icon.resize(target_size, Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(15))
bg = bg.point(lambda p: p * 0.5)

scaled_icon = icon.resize((384, 384), Image.Resampling.LANCZOS)
x = (512 - 384) // 2
bg.paste(scaled_icon, (x, 0), scaled_icon)
bg.convert("RGB").save("gamepush_final/icon_4x3_512x384_blurpad.jpg", "JPEG", quality=95)
