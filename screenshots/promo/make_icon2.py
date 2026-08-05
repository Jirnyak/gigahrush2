import sys
from PIL import Image

# Read the icon
icon = Image.open("icon-512.png").convert("RGBA")

# Create a 512x384 background (let's use a blurred version of the icon itself to avoid black bars, which looks nice, or just a solid color)
# The user wants "Иконка", maybe they just want the center crop. Let's provide a version that scales to fit.
target_size = (512, 384)

# We will fit the 512x512 icon into 512x384. 
# Best way is to scale down to 384x384 and put it on a dark background or just transparent if saving as PNG.
bg = Image.new("RGBA", target_size, (0, 0, 0, 255))
scaled_icon = icon.resize((384, 384), Image.Resampling.LANCZOS)
x = (512 - 384) // 2
bg.paste(scaled_icon, (x, 0), scaled_icon)

bg.convert("RGB").save("gamepush_final/icon_4x3_512x384_padded.jpg", "JPEG", quality=95)

# Also let's do a version where we just crop the center (if they prefer no borders)
left = 0
top = (512 - 384) // 2
cropped = icon.crop((left, top, left + 512, top + 384))
cropped.convert("RGB").save("gamepush_final/icon_4x3_512x384_cropped.jpg", "JPEG", quality=95)

print("Generated padded and cropped icon versions")
