from psd_tools import PSDImage
import sys
psd = PSDImage.open(sys.argv[1])
psd.composite().save(sys.argv[1] + ".png")
