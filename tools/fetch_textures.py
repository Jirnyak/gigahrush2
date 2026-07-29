#!/usr/bin/env python3
"""Fetch the 16 CC0 Poly Haven albedo maps and bake them to BC7 / KTX2.

    python tools/fetch_textures.py                 # fetch + compress everything missing
    python tools/fetch_textures.py --only rubber_tiles,metal_plate
    python tools/fetch_textures.py --force         # re-download and re-encode
    python tools/fetch_textures.py --list-tools    # just report what is installed

`data/materials.csv` is the manifest. It is not a convenience copy of a list that
lives somewhere else -- it is the *only* list. It was produced by
`tools/measure_materials.py`, which measured each photograph's linear albedo mean
and luminance standard deviation and recorded provider / licence / source URL per
row. This script reads the same rows back, re-fetches the same photographs from
Poly Haven's public API, and **re-derives the CSV's statistics from the bytes it
downloaded** as a provenance check: if the measured mean does not reproduce the
committed `lin_r/lin_g/lin_b`, we did not get the image the CSV describes, and the
material is rejected rather than compressed. Measured 2026-07-29: the check
reproduces all three channels to the full four decimal places the CSV carries.

Output is `data/textures/<id>.ktx2`: BC7, full mip chain, one file per material.

WHY BC7 AND NOT SOMETHING SUPERCOMPRESSED
-----------------------------------------
The engine's rule is that disk and GPU are unlimited and the CPU tick is sacred
(AGENTS.md, performance.md). A BC7 payload is uploaded to Vulkan verbatim -- no
transcode, no CPU work at load beyond a memcpy. Basis Universal (ETC1S/UASTC) is
smaller on disk but must be transcoded on the CPU at load and needs libktx linked
into the engine; that trades the resource we do not have for one we do. So: raw
BC7 blocks, `supercompressionScheme = 0`, `vkFormat = VK_FORMAT_BC7_SRGB_BLOCK`.

WHY _SRGB AND NOT _UNORM
-----------------------
A Poly Haven diffuse map is a display-referred photograph: the byte values are
sRGB-encoded. Declaring `BC7_SRGB_BLOCK` makes the sampler hardware linearise on
every fetch, for free, with correct filtering. Declaring `BC7_UNORM_BLOCK` would
push that onto the shader, which would then have to `pow()` after filtering --
i.e. filter in the wrong space. The container therefore says sRGB and the shader
must **not** gamma-correct the sampled albedo again. See data/textures/README.md.

MIP CHAIN IS BUILT IN LINEAR LIGHT, BY US, ON PURPOSE
----------------------------------------------------
Compressonator can generate mips itself, but it filters in the source's encoded
(non-linear) space. Measured on `blue_metal_plate` (2026-07-29): its chain loses
9.2% of the image's mean linear luminance by mip 8 -- a systematic darkening with
distance. `tools/measure_materials.py` already refuses that same mistake for the
same reason. So this script decodes to float, converts sRGB -> linear, box-filters
2x2 in linear light (a box filter over a power-of-two square is exact and
mean-preserving), re-encodes each level to sRGB bytes, and hands Compressonator
one level at a time with mip generation switched off.

THE ENCODER IS A REAL BC7 ENCODER, NOT A FALLBACK
-------------------------------------------------
BC7 has 8 block modes and a partition search; hand-rolling it badly is worse than
not doing it. This script requires an external encoder and **fails loudly** if it
cannot find one -- it will never quietly write uncompressed RGBA and call it done.
Note that `ktx create` (KTX-Software) cannot do this job: it encodes ASTC,
ETC1S/BasisLZ and UASTC only, so it is used here for *validation* if present, not
for compression. See `--list-tools`.
"""

import argparse
import csv
import hashlib
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

try:
    import numpy as np
    from PIL import Image
except ImportError:
    sys.stderr.write("fetch_textures: needs Pillow and numpy (pip install pillow numpy)\n")
    sys.exit(2)

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(REPO, "data", "materials.csv")
OUT_DIR = os.path.join(REPO, "data", "textures")
CACHE_DIR = os.path.join(OUT_DIR, ".cache")

API = "https://api.polyhaven.com/files/%s"
# api.polyhaven.com answers 403 to urllib's default "Python-urllib/3.x" UA.
# Measured 2026-07-29. Sending an identifying UA is both required and polite.
UA = "gigahrush2-fetch_textures/1.0 (CC0 texture fetch; +https://polyhaven.com)"

# Which map. Poly Haven names the albedo "Diffuse"; some assets also carry
# "Rough"/"AO"/"Displacement"/"nor_gl". Only albedo is fetched here -- normal and
# roughness are a later increment and would triple the repo weight for no
# consumer (there is no PBR pass yet).
MAP = "Diffuse"
PREFERRED_EXT = ("jpg", "png")

# Poly Haven resolution keys, chosen from the CSV's src_w so the CSV stays the
# manifest even for the resolution.
RES_KEY = {1024: "1k", 2048: "2k", 4096: "4k", 8192: "8k", 16384: "16k"}

BLOCK_BYTES = 16      # BC7 and UASTC LDR 4x4 are both 16 bytes per 4x4 texel block
BLOCK_DIM = 4
VK_FORMAT_UNDEFINED = 0
VK_FORMAT_BC7_SRGB_BLOCK = 146
VK_FORMAT_BC7_UNORM_BLOCK = 145
DXGI_BC7_UNORM = 98
DXGI_BC7_UNORM_SRGB = 99

# Khronos Data Format colour models and KTX2 supercompression schemes, from the
# KTX 2.0 / khr_df specs. Verified against files this script writes and reads.
KHR_DF_MODEL_ETC1S = 163
KHR_DF_MODEL_UASTC = 166
KHR_DF_MODEL_BC7 = 134
SC_NONE = 0
SC_BASISLZ = 1
SC_ZSTD = 2

# The three encodings --format selects. Per entry:
#   vkFormat, supercompressionScheme, DFD colorModel, DFD bytesPlane0,
#   whether the level payload is the literal uncompressed block data.
FORMATS = {
    "bc7":   (VK_FORMAT_BC7_SRGB_BLOCK, SC_NONE,     KHR_DF_MODEL_BC7,   16, True),
    "uastc": (VK_FORMAT_UNDEFINED,      SC_ZSTD,     KHR_DF_MODEL_UASTC, 16, False),
    "etc1s": (VK_FORMAT_UNDEFINED,      SC_BASISLZ,  KHR_DF_MODEL_ETC1S,  8, False),
}

KTX2_ID = bytes([0xAB, 0x4B, 0x54, 0x58, 0x20, 0x32, 0x30, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A])

# Khronos Data Format Descriptor for BC7, sRGB transfer. Byte-for-byte the
# descriptor KTX-Software's own `ktx validate` accepts (cross-checked 2026-07-29
# against a Compressonator-written container, with only the transfer-function
# byte changed from LINEAR(1) to SRGB(2)):
#   totalSize 44 | vendorId 0 descriptorType 0 | version 2 blockSize 40
#   colorModel 134 (BC7), primaries 1 (BT.709/sRGB), transfer 2 (sRGB), flags 0
#   texelBlockDimension 3,3,0,0 (=> 4x4x1x1), bytesPlane0 16
#   one sample: bitOffset 0, bitLength 127, channelType 0, lower 0, upper 0xFFFFFFFF
DFD_BC7_SRGB = bytes.fromhex(
    "2c000000"
    "00000000"
    "02002800"
    "86010200"
    "03030000"
    "1000000000000000"
    "0000" "7f" "00"
    "00000000"
    "00000000"
    "ffffffff"
)
assert len(DFD_BC7_SRGB) == 44

LUM = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
STAT_SAMPLE = 256      # must match tools/measure_materials.py
STAT_TOL = 0.0020      # absolute tolerance on the linear channel means


# ---------------------------------------------------------------- colour space

def srgb_to_linear(a):
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(a):
    a = np.clip(a, 0.0, 1.0)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * (a ** (1.0 / 2.4)) - 0.055)


def measure_like_measure_materials(im):
    """Reproduce tools/measure_materials.py exactly, so the numbers are comparable."""
    a = np.asarray(im.resize((STAT_SAMPLE, STAT_SAMPLE), Image.BILINEAR),
                   dtype=np.float32) / 255.0
    lin = srgb_to_linear(a).reshape(-1, 3)
    return lin.mean(0), float((lin @ LUM).std())


def linear_mip_chain(im):
    """Full mip chain, box-filtered in LINEAR light, returned as sRGB uint8."""
    lin = srgb_to_linear(np.asarray(im, dtype=np.float32) / 255.0)
    levels = [lin]
    while levels[-1].shape[0] > 1 or levels[-1].shape[1] > 1:
        p = levels[-1]
        h, w = p.shape[0], p.shape[1]
        # Odd extents cannot occur for the power-of-two sources this manifest
        # carries, but duplicate the edge rather than dropping it if they do.
        if h % 2:
            p = np.concatenate([p, p[-1:]], axis=0)
            h += 1
        if w % 2:
            p = np.concatenate([p, p[:, -1:]], axis=1)
            w += 1
        nh, nw = max(1, h // 2), max(1, w // 2)
        levels.append(p.reshape(nh, 2, nw, 2, 3).mean(axis=(1, 3)))
    return [np.rint(linear_to_srgb(l) * 255.0).astype(np.uint8) for l in levels]


# ---------------------------------------------------------------- tool probing

CANDIDATE_COMPRESSORS = ("compressonatorcli", "compressonatorcli.exe",
                         "CompressonatorCLI", "CompressonatorCLI.exe")
CANDIDATE_KTX = ("ktx", "ktx.exe")

KTX_HELP = """\
  * KTX-Software 4.4.2+ -- the `ktx` CLI. Encoder for --format uastc and etc1s,
    and the Khronos reference *validator* for every format (this script runs
    `ktx validate` on whatever it writes, and that validator inflates the zstd
    payload: a single flipped byte inside a level makes it exit 3).
      https://github.com/KhronosGroup/KTX-Software/releases
      Windows installer or portable zip; put its bin/ on PATH, set KTX_TOOL, or
      pass --ktx <path-to-ktx.exe>.
"""

COMP_HELP = """\
  * AMD Compressonator CLI 4.5.52 -- encoder for --format bc7 ONLY. `ktx create`
    cannot emit raw BC7 blocks (it does ASTC, ETC1S/BasisLZ and UASTC), so the
    un-supercompressed path needs a separate tool. Portable zip, no installer,
    ~66 MB.
      https://github.com/GPUOpen-Tools/compressonator/releases
      download compressonatorcli-<ver>-win64.zip, unzip anywhere, then either put
      the folder on PATH or pass --compressonator <path-to-compressonatorcli.exe>
      (env COMPRESSONATOR also works)
      Linux/macOS: compressonatorcli-<ver>-Linux.tar.gz / build from source.
"""

INSTALL_HELP = """\
fetch_textures: the encoder for the selected --format is missing. This script will
NOT fall back to writing uncompressed pixels and reporting success -- that would
look done and be wrong.

""" + KTX_HELP + COMP_HELP + """
Deliberately NOT usable:
  * basisu -- writes the same UASTC/ETC1S payloads but its own container handling
    is a second thing to keep in step with the KTX2 spec; `ktx create` is the
    reference implementation of the container this pack ships.
  * texconv -- can encode BC7 but writes DDS; no KTX2 container.
"""


def find_tool(names, explicit=None, env=None):
    if explicit:
        if os.path.isfile(explicit):
            return explicit
        sys.stderr.write("fetch_textures: %s is not a file\n" % explicit)
        return None
    if env:
        p = os.environ.get(env)
        if p and os.path.isfile(p):
            return p
    for n in names:
        p = shutil.which(n)
        if p:
            return p
    return None


# ------------------------------------------------------------------ networking

def http_get(url, timeout=120):
    rq = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(rq, timeout=timeout) as r:
        return r.read()


def api_files(mat_id, cache_dir, force=False):
    """Resolve one asset slug through the public API. Cached on disk."""
    p = os.path.join(cache_dir, mat_id + ".api.json")
    if not force and os.path.isfile(p) and os.path.getsize(p) > 0:
        with open(p, "rb") as fh:
            return json.loads(fh.read().decode("utf-8")), True
    blob = http_get(API % mat_id)
    d = json.loads(blob.decode("utf-8"))
    with open(p, "wb") as fh:
        fh.write(blob)
    return d, False


def pick_entry(files, res_key):
    """files -> (url, md5, size, ext). Returns None plus a reason on mismatch."""
    if MAP not in files:
        return None, ("asset has no %r map; available: %s"
                      % (MAP, ",".join(sorted(files.keys()))))
    byres = files[MAP]
    if res_key not in byres:
        return None, ("no %s resolution for %s; available: %s"
                      % (res_key, MAP, ",".join(sorted(byres.keys()))))
    byext = byres[res_key]
    for ext in PREFERRED_EXT:
        e = byext.get(ext)
        if e and e.get("url"):
            return (e["url"], e.get("md5", ""), int(e.get("size", 0)), ext), None
    return None, ("no %s file at %s/%s; available: %s"
                  % ("/".join(PREFERRED_EXT), MAP, res_key, ",".join(sorted(byext.keys()))))


def download(url, dest, want_md5, want_size):
    """Cached, verified download. Returns (bytes_on_disk, from_cache)."""
    if os.path.isfile(dest) and os.path.getsize(dest) > 0:
        with open(dest, "rb") as fh:
            have = fh.read()
        if (not want_md5 or hashlib.md5(have).hexdigest() == want_md5) and \
           (not want_size or len(have) == want_size):
            return len(have), True
    blob = http_get(url, timeout=600)
    if want_size and len(blob) != want_size:
        return -1, "size %d != API-declared %d" % (len(blob), want_size)
    if want_md5:
        got = hashlib.md5(blob).hexdigest()
        if got != want_md5:
            return -1, "md5 %s != API-declared %s" % (got, want_md5)
    tmp = dest + ".part"
    with open(tmp, "wb") as fh:
        fh.write(blob)
    os.replace(tmp, dest)
    return len(blob), False


# -------------------------------------------------------------- DDS -> raw BC7

def dds_payload(path, w, h):
    """Read a single-surface BC7 DDS and return its raw block bytes."""
    with open(path, "rb") as fh:
        b = fh.read()
    if b[:4] != b"DDS ":
        return None, "not a DDS file (magic %r)" % b[:4]
    hdr_size, flags, dh, dw = struct.unpack_from("<4I", b, 4)
    if (dw, dh) != (w, h):
        return None, "DDS is %dx%d, expected %dx%d" % (dw, dh, w, h)
    fourcc = b[84:88]
    off = 128
    if fourcc == b"DX10":
        (dxgi,) = struct.unpack_from("<I", b, 128)
        if dxgi not in (DXGI_BC7_UNORM, DXGI_BC7_UNORM_SRGB):
            return None, "DDS dxgiFormat=%d is not BC7 (want 98 or 99)" % dxgi
        off = 148
    elif fourcc not in (b"BC7L", b"BC7\0"):
        return None, "DDS fourCC %r is not a BC7 marker" % fourcc
    want = blocks_bytes(w, h)
    data = b[off:off + want]
    if len(data) != want:
        return None, ("payload %d bytes, expected %d for %dx%d BC7"
                      % (len(data), want, w, h))
    return data, None


def blocks_bytes(w, h):
    return ((w + BLOCK_DIM - 1) // BLOCK_DIM) * ((h + BLOCK_DIM - 1) // BLOCK_DIM) * BLOCK_BYTES


def encode_level(comp, rgb, w, h, tmpdir, idx, quality, threads, verbose):
    """One mip level -> raw BC7 blocks, via the external encoder."""
    # BC7 works on 4x4 blocks. Levels below 4 px exist in the chain (2x2, 1x1)
    # and occupy one whole block each; edge-replicate up to 4x4 so the encoder
    # spends its bits on real content instead of black padding.
    pw, ph = max(BLOCK_DIM, w), max(BLOCK_DIM, h)
    if (pw, ph) != (w, h):
        pad = np.zeros((ph, pw, 3), dtype=np.uint8)
        pad[:, :] = rgb[min(h, ph) - 1, min(w, pw) - 1]
        pad[:h, :w] = rgb[:h, :w]
        for y in range(h, ph):
            pad[y, :w] = rgb[h - 1, :w]
        for x in range(w, pw):
            pad[:, x] = pad[:, w - 1]
        rgb = pad
    src = os.path.join(tmpdir, "l%02d.png" % idx)
    dst = os.path.join(tmpdir, "l%02d.dds" % idx)
    Image.fromarray(rgb, "RGB").save(src)
    cmd = [comp, "-nomipmap", "-fd", "BC7",
           "-Quality", "%g" % quality, "-NumThreads", str(threads),
           "-noprogress", "-silent", src, dst]
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if r.returncode != 0 or not os.path.isfile(dst):
        tail = r.stdout.decode("utf-8", "replace")[-400:] if r.stdout else ""
        return None, "encoder exit %d for level %d (%dx%d): %s" % (
            r.returncode, idx, w, h, tail.replace("\n", " | "))
    data, err = dds_payload(dst, pw, ph)
    if err:
        return None, "level %d: %s" % (idx, err)
    if verbose:
        sys.stderr.write("      L%-2d %5dx%-5d -> %8d B\n" % (idx, w, h, len(data)))
    return data, None


# ------------------------------------------- supercompressed path (ktx create)

def ktx_create(ktx, chain, out, fmt, args, tmpdir, verbose):
    """UASTC+zstd or ETC1S/BasisLZ, via KTX-Software. Returns (bytes, err).

    `ktx create` takes ONE INPUT FILE PER MIP LEVEL, base level first, and only
    generates mips itself when asked with --generate-mipmap. That is what lets the
    supercompressed path keep this script's linear-light chain instead of the
    encoder's own resampler -- checked, not assumed: with 12 inputs and --levels 12
    its own --compare-psnr reports level 1..11 against *our* level 1..11 (~50 dB),
    so those are the pixels it encoded. Verified afterwards by extracting the
    levels back out; see data/textures/README.md.

    Levels smaller than one 4x4 block (2x2, 1x1) are handed over at their true
    size -- unlike the BC7 path, which pads them by hand, `ktx create` does the
    block padding itself and its own level index agrees with the spec.
    """
    pngs = []
    for i, lvl in enumerate(chain):
        p = os.path.join(tmpdir, "l%02d.png" % i)
        Image.fromarray(lvl, "RGB").save(p)
        pngs.append(p)
    tmp_out = os.path.join(tmpdir, "out.ktx2")

    # R8G8B8, not R8G8B8A8: these albedos have no alpha, and telling the encoder
    # so keeps the DFD sample list at KHR_DF_CHANNEL_UASTC_RGB instead of spending
    # UASTC's alpha modes on a constant 255.
    # --assign-tf/--assign-primaries *label* the data (Pillow's PNGs carry no
    # colour chunks); they convert nothing, so the sRGB bytes go in untouched.
    # --assign-texcoord-origin only writes metadata absent --convert-*, and yields
    # the KTXorientation=rd the BC7 path already commits to.
    cmd = [ktx, "create",
           "--format", "R8G8B8_SRGB",
           "--assign-tf", "srgb",
           "--assign-primaries", "bt709",
           "--assign-texcoord-origin", "top-left",
           "--levels", str(len(chain)),
           "--threads", str(args.threads)]
    if fmt == "uastc":
        cmd += ["--encode", "uastc", "--uastc-quality", str(args.uastc_quality)]
        if args.uastc_rdo_l is not None:
            cmd += ["--uastc-rdo", "--uastc-rdo-l", "%g" % args.uastc_rdo_l]
        cmd += ["--zstd", str(args.zstd)]
    elif fmt == "etc1s":
        # BasisLZ carries its own entropy coder; --zstd is rejected on top of it.
        cmd += ["--encode", "basis-lz",
                "--qlevel", str(args.qlevel), "--clevel", str(args.clevel)]
    else:
        return None, "ktx_create called with --format %r" % fmt
    if verbose:
        cmd.append("--compare-psnr")
    cmd += pngs + [tmp_out]

    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if r.returncode != 0 or not os.path.isfile(tmp_out):
        tail = r.stdout.decode("utf-8", "replace")[-500:] if r.stdout else ""
        return None, "ktx create exit %d: %s" % (r.returncode, tail.replace("\n", " | "))
    if verbose and r.stdout:
        for line in r.stdout.decode("utf-8", "replace").splitlines():
            sys.stderr.write("      %s\n" % line.strip())
    os.makedirs(os.path.dirname(out), exist_ok=True)
    os.replace(tmp_out, out)
    return os.path.getsize(out), None


# ------------------------------------------------------------- KTX2 container

def kvd_block(entries):
    """Key/Value Data. Keys must be sorted; each entry is padded to 4 bytes."""
    out = bytearray()
    for k, v in sorted(entries):
        payload = k.encode("utf-8") + b"\0" + v.encode("utf-8") + b"\0"
        out += struct.pack("<I", len(payload)) + payload
        while len(out) % 4:
            out += b"\0"
    return bytes(out)


def write_ktx2(path, w, h, levels, writer_id):
    """levels[0] is the full-size mip. Raw BC7, no supercompression, sRGB."""
    n = len(levels)
    kvd = kvd_block([
        # Image row 0 is the top row, as decoded: +x right, +y down. A sampler
        # needs no V flip.
        ("KTXorientation", "rd"),
        ("KTXwriter", writer_id),
    ])
    dfd_off = 80 + n * 24
    kvd_off = dfd_off + len(DFD_BC7_SRGB)
    data_start = kvd_off + len(kvd)
    data_start = (data_start + BLOCK_BYTES - 1) & ~(BLOCK_BYTES - 1)

    # Level *images* are laid out smallest-first (streaming-friendly, and what
    # every KTX2 writer in the wild does); the level *index* stays in level
    # order, entry 0 = the full-size mip.
    offs = [0] * n
    cur = data_start
    for i in range(n - 1, -1, -1):
        cur = (cur + BLOCK_BYTES - 1) & ~(BLOCK_BYTES - 1)
        offs[i] = cur
        cur += len(levels[i])
    total = cur

    buf = bytearray(total)
    buf[0:12] = KTX2_ID
    struct.pack_into("<9I", buf, 12,
                     VK_FORMAT_BC7_SRGB_BLOCK,
                     1,        # typeSize: 1 for block-compressed formats
                     w, h,
                     0,        # pixelDepth: 0 for 2D
                     0,        # layerCount: 0 = not an array
                     1,        # faceCount
                     n,        # levelCount
                     0)        # supercompressionScheme = none
    struct.pack_into("<4I", buf, 48, dfd_off, len(DFD_BC7_SRGB), kvd_off, len(kvd))
    struct.pack_into("<2Q", buf, 64, 0, 0)     # no supercompression global data
    for i in range(n):
        struct.pack_into("<3Q", buf, 80 + i * 24, offs[i], len(levels[i]), len(levels[i]))
    buf[dfd_off:dfd_off + len(DFD_BC7_SRGB)] = DFD_BC7_SRGB
    buf[kvd_off:kvd_off + len(kvd)] = kvd
    for i in range(n):
        buf[offs[i]:offs[i] + len(levels[i])] = levels[i]

    tmp = path + ".part"
    with open(tmp, "wb") as fh:
        fh.write(bytes(buf))
    os.replace(tmp, path)
    return total


def check_ktx2(path, fmt, w=None, h=None):
    """Structural self-check against the --format contract. Needs no tool.

    This is the guard against the failure mode the module docstring names: a file
    that looks encoded but is not. It asserts the *declared* encoding matches what
    was asked for, so a BC7 file cannot pass as UASTC (or the reverse) and an
    un-supercompressed payload cannot pass as a supercompressed one. What it
    cannot do is inflate zstd -- Python 3.13 has no zstd in the stdlib -- so for
    the supercompressed formats the payload itself is proved by `ktx validate`,
    which does inflate it.
    """
    want_vk, want_sc, want_model, want_bpb, raw_payload = FORMATS[fmt]
    with open(path, "rb") as fh:
        b = fh.read()
    if len(b) < 80 or b[:12] != KTX2_ID:
        return None, "bad KTX2 identifier"
    (vk, ts, pw, ph, pd, lay, fac, n, sc) = struct.unpack_from("<9I", b, 12)
    (dfd_off, dfd_len, kvd_off, kvd_len) = struct.unpack_from("<4I", b, 48)
    (sgd_off, sgd_len) = struct.unpack_from("<2Q", b, 64)
    if fmt == "bc7":
        if vk not in (VK_FORMAT_BC7_SRGB_BLOCK, VK_FORMAT_BC7_UNORM_BLOCK):
            return None, "vkFormat %d is not BC7" % vk
    elif vk != want_vk:
        return None, ("vkFormat %d, but %s stores no GPU format and must declare "
                      "VK_FORMAT_UNDEFINED" % (vk, fmt))
    if sc != want_sc:
        return None, "supercompressionScheme %d, %s requires %d" % (sc, fmt, want_sc)
    if w and (pw, ph) != (w, h):
        return None, "container is %dx%d, manifest says %dx%d" % (pw, ph, w, h)
    if pd or lay or fac != 1 or ts != 1:
        return None, ("unexpected header: depth=%d layers=%d faces=%d typeSize=%d"
                      % (pd, lay, fac, ts))
    want_levels = max(pw, ph).bit_length()
    if n != want_levels:
        return None, "levelCount %d, full chain for %dx%d is %d" % (n, pw, ph, want_levels)
    if dfd_len < 24 or b[dfd_off + 12] != want_model:
        return None, ("DFD colorModel %d, %s requires %d"
                      % (b[dfd_off + 12] if dfd_len >= 24 else -1, fmt, want_model))
    if b[dfd_off + 14] != 2:
        return None, ("DFD transferFunction=%d, want 2 (sRGB) -- these are "
                      "display-referred photographs" % b[dfd_off + 14])
    if tuple(b[dfd_off + 16:dfd_off + 20]) != (3, 3, 0, 0):
        return None, "DFD texelBlockDimension is not 4x4"
    if b[dfd_off + 20] != want_bpb:
        return None, "DFD bytesPlane0=%d, %s requires %d" % (b[dfd_off + 20], fmt, want_bpb)
    if want_sc == SC_BASISLZ and sgd_len == 0:
        return None, "BasisLZ needs supercompressionGlobalData; byteLength is 0"
    if want_sc != SC_BASISLZ and sgd_len:
        return None, "supercompressionGlobalData byteLength %d, want 0" % sgd_len
    payload = 0
    for i in range(n):
        off, ln, uln = struct.unpack_from("<3Q", b, 80 + i * 24)
        lw, lh = max(1, pw >> i), max(1, ph >> i)
        blocks = ((lw + BLOCK_DIM - 1) // BLOCK_DIM) * ((lh + BLOCK_DIM - 1) // BLOCK_DIM)
        if ln == 0 or off + ln > len(b):
            return None, "level %d (%d bytes at %d) runs past end of file" % (i, ln, off)
        payload += ln
        if raw_payload:
            if ln != blocks * want_bpb:
                return None, "level %d is %d bytes, %s %dx%d needs %d" % (
                    i, ln, fmt, lw, lh, blocks * want_bpb)
            if off % BLOCK_BYTES:
                return None, "level %d offset %d is not %d-aligned" % (i, off, BLOCK_BYTES)
            if uln != ln:
                return None, "level %d uncompressedByteLength %d != %d" % (i, uln, ln)
        elif want_sc == SC_ZSTD:
            # Levels are tightly packed when supercompressed (no mipPadding), so
            # there is no alignment to check -- but the inflated size is fully
            # determined by the block count, and that is worth pinning down.
            if uln != blocks * want_bpb:
                return None, ("level %d uncompressedByteLength %d, UASTC %dx%d "
                              "inflates to %d" % (i, uln, lw, lh, blocks * want_bpb))
        elif uln != 0:
            return None, "level %d uncompressedByteLength %d, BasisLZ requires 0" % (i, uln)
    return {"vkFormat": vk, "sc": sc, "w": pw, "h": ph, "levels": n,
            "size": len(b), "payload": payload}, None


def ktx_validate(ktx, path):
    r = subprocess.run([ktx, "validate", path],
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    return r.returncode == 0, (r.stdout or b"").decode("utf-8", "replace").strip()


# ------------------------------------------------------------------------ main

def process(row, comp, ktx, args, tmproot):
    mat = row["id"]
    out = os.path.join(OUT_DIR, mat + ".ktx2")
    src_w, src_h = int(row["src_w"]), int(row["src_h"])
    rec = {"id": mat, "dl": 0, "out": 0, "mips": 0, "note": "", "ok": False,
           "cached_dl": False, "skipped": False}

    # Idempotence: a good file already on disk costs nothing, not even an API call.
    # A file in the *other* --format fails this check and is rebuilt -- switching
    # format is a rebuild, not a no-op, and silently keeping the old encoding would
    # be the worst possible outcome.
    if not args.force and os.path.isfile(out) and os.path.getsize(out) > 0:
        info, err = check_ktx2(out, args.format, src_w, src_h)
        if info:
            rec.update(out=info["size"], mips=info["levels"], ok=True,
                       skipped=True, note="up to date")
            return rec
        rec["note"] = "existing file rejected (%s), rebuilding" % err
        sys.stderr.write("  %s: %s\n" % (mat, rec["note"]))

    # Everything past this point needs the encoder for the selected format:
    # `ktx` for uastc/etc1s, Compressonator for bc7. The check belongs HERE and not
    # in main(): the 16 .ktx2 are committed, so on every other clone each row takes
    # the idempotency return above and no encoder is needed at all. Refusing to
    # start without one would mean nobody can VERIFY the shipped files without
    # first installing a compressor they will not run.
    encoder = comp if args.format == "bc7" else ktx
    if encoder is None:
        rec["note"] = ("must be rebuilt but the --format %s encoder (%s) is not "
                       "installed (see --list-tools)"
                       % (args.format,
                          "Compressonator" if args.format == "bc7" else "KTX-Software ktx"))
        return rec

    # The CSV's source URL is provenance; make sure it still agrees with the id
    # the rest of the row is about, so a mangled manifest cannot silently make us
    # fetch the wrong photograph.
    slug = row.get("source", "").rstrip("/").rsplit("/", 1)[-1]
    if slug != mat:
        rec["note"] = "manifest mismatch: source URL slug %r != id %r" % (slug, mat)
        return rec

    res = RES_KEY.get(src_w)
    if not res or src_w != src_h:
        rec["note"] = "manifest src %dx%d has no Poly Haven resolution key" % (src_w, src_h)
        return rec

    try:
        files, from_cache = api_files(mat, CACHE_DIR, force=args.force)
    except (urllib.error.URLError, urllib.error.HTTPError, OSError) as e:
        rec["note"] = "API lookup failed: %s" % e
        return rec
    entry, why = pick_entry(files, res)
    if not entry:
        rec["note"] = "API shape unexpected: %s" % why
        return rec
    url, md5, size, ext = entry

    src = os.path.join(CACHE_DIR, "%s_%s.%s" % (mat, res, ext))
    try:
        got, cached = download(url, src, md5, size)
    except (urllib.error.URLError, urllib.error.HTTPError, OSError) as e:
        rec["note"] = "download failed: %s" % e
        return rec
    if got < 0:
        rec["note"] = "download rejected: %s" % cached
        return rec
    rec["dl"], rec["cached_dl"] = got, bool(cached)

    # Decode. A 404 or a rate-limit page is HTML: it either fails to decode at
    # all or is not src_w x src_h. Both are caught here, before any encoding.
    try:
        im = Image.open(src)
        im.load()
        im = im.convert("RGB")
    except Exception as e:                                  # noqa: BLE001
        rec["note"] = "downloaded bytes are not a decodable image: %s" % e
        return rec
    if im.size != (src_w, src_h):
        rec["note"] = "decoded %dx%d, manifest says %dx%d" % (
            im.size[0], im.size[1], src_w, src_h)
        return rec

    # Provenance: re-derive the committed statistics from the bytes we fetched.
    mean, lum_std = measure_like_measure_materials(im)
    want = np.array([float(row["lin_r"]), float(row["lin_g"]), float(row["lin_b"])],
                    dtype=np.float32)
    dev = float(np.abs(mean - want).max())
    if dev > STAT_TOL and not args.no_stat_check:
        rec["note"] = ("albedo mean %.4f/%.4f/%.4f does not reproduce manifest "
                       "%.4f/%.4f/%.4f (max dev %.4f) -- not the measured image"
                       % (mean[0], mean[1], mean[2], want[0], want[1], want[2], dev))
        return rec
    rec["dev"] = dev
    rec["lum_std"] = lum_std

    # ONE mip chain, both formats. This is the whole point of building it here:
    # neither encoder's own resampler is allowed near it (see linear_mip_chain).
    chain = linear_mip_chain(im)
    rec["mips"] = len(chain)
    tmpdir = os.path.join(tmproot, mat)
    os.makedirs(tmpdir, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)

    if args.format == "bc7":
        blocks = []
        for i, lvl in enumerate(chain):
            data, err = encode_level(comp, lvl, lvl.shape[1], lvl.shape[0],
                                     tmpdir, i, args.quality, args.threads, args.verbose)
            if err:
                rec["note"] = err
                return rec
            blocks.append(data)
        rec["out"] = write_ktx2(out, src_w, src_h, blocks,
                                "gigahrush2 tools/fetch_textures.py + Compressonator BC7")
    else:
        size, err = ktx_create(ktx, chain, out, args.format, args, tmpdir, args.verbose)
        if err:
            rec["note"] = err
            return rec
        rec["out"] = size
    shutil.rmtree(tmpdir, ignore_errors=True)

    info, err = check_ktx2(out, args.format, src_w, src_h)
    if err:
        rec["note"] = "self-check failed: %s" % err
        return rec
    if ktx:
        ok, msg = ktx_validate(ktx, out)
        if not ok:
            rec["note"] = "ktx validate rejected the file: %s" % msg.replace("\n", " | ")
            return rec
        rec["note"] = "ktx validate OK"
    else:
        rec["note"] = "self-check OK (ktx validate not installed)"
    rec["ok"] = True
    return rec


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--only", default="", help="comma-separated subset of ids")
    ap.add_argument("--force", action="store_true",
                    help="rebuild even if the .ktx2 is already good: re-query the "
                         "API and re-encode. A cached source image is still reused "
                         "when it matches the freshly-fetched md5 -- re-downloading "
                         "bytes that are provably identical buys nothing. Delete "
                         "data/textures/.cache to force the transfer too.")
    ap.add_argument("--format", choices=sorted(FORMATS), default="uastc",
                    help="output encoding. uastc (default, what is committed) = "
                         "UASTC LDR 4x4 + zstd, needs a runtime transcode; bc7 = "
                         "raw BC7 blocks, uploadable verbatim but 1 byte/texel on "
                         "disk; etc1s = ETC1S/BasisLZ, smallest and visibly lossy. "
                         "Switching format rebuilds every file. See "
                         "data/textures/README.md for the measured tradeoff.")
    ap.add_argument("--quality", type=float, default=0.05,
                    help="--format bc7 only: Compressonator BC7 -Quality. Measured "
                         "on a 2K albedo (2026-07-29): 0.05 = 7.7 s / PSNR 55.6 dB "
                         "/ SSIM 0.9977; 0.25 = 292 s / 58.1 dB / 0.9987. Default "
                         "0.05 is the knee.")
    ap.add_argument("--uastc-quality", type=int, default=2, choices=range(0, 5),
                    metavar="0-4",
                    help="--format uastc only: `ktx create --uastc-quality`. "
                         "Measured on blue_metal_plate (2026-07-29, zstd 18): "
                         "0 = 2 s / 3,713,766 B / 53.13 dB; 1 = 3 s / 3,887,697 B / "
                         "53.37; 2 = 4 s / 3,950,927 B / 53.89; 3 = 6 s / 53.86; "
                         "4 = 137 s / 4,195,358 B / 53.69 -- 3 and 4 are slower, "
                         "bigger AND no better, so 2 is the top of the curve.")
    ap.add_argument("--uastc-rdo-l", type=float, default=None, metavar="LAMBDA",
                    help="--format uastc only: enable UASTC RDO at this lambda, "
                         "trading fidelity for zstd-compressibility. OFF by "
                         "default because it is not free. Measured on "
                         "blue_metal_plate (2026-07-29): off = 3,950,927 B / "
                         "53.89 dB; 0.5 = 2,488,545 / 48.05; 1.0 = 2,218,589 / "
                         "46.53; 2.0 = 2,076,878 / 45.14; 8.0 = 1,972,762 / 42.10. "
                         "On the busiest map (metal_grate_rusty) the same lambdas "
                         "buy almost nothing: off = 4,986,272 B / 47.45 dB, "
                         "1.0 = 4,839,924 / 45.97 -- 3%% smaller for 1.5 dB.")
    ap.add_argument("--zstd", type=int, default=18, metavar="1-22",
                    help="--format uastc only: Zstandard level. Measured on one "
                         "2K UASTC payload (2026-07-29): 1 = 4,848,351 B; 3 = "
                         "4,475,140; 9 = 4,174,059; 18 = 3,950,927; 20 and 22 = "
                         "3,950,173. 18 is the knee -- 22 costs more memory for "
                         "754 bytes.")
    ap.add_argument("--qlevel", type=int, default=255, metavar="1-255",
                    help="--format etc1s only: BasisLZ quality level.")
    ap.add_argument("--clevel", type=int, default=2, metavar="0-6",
                    help="--format etc1s only: BasisLZ compression effort.")
    ap.add_argument("--threads", type=int, default=max(2, (os.cpu_count() or 8)),
                    help="encoder threads (Compressonator caps at 128)")
    ap.add_argument("--compressonator", default=None, help="path to compressonatorcli")
    ap.add_argument("--ktx", default=None,
                    help="path to KTX-Software 'ktx': the encoder for --format "
                         "uastc/etc1s, and the validator for all three")
    ap.add_argument("--no-stat-check", action="store_true",
                    help="do not require the download to reproduce the CSV's albedo means")
    ap.add_argument("--list-tools", action="store_true", help="report tools and exit")
    ap.add_argument("-v", "--verbose", action="store_true", help="per-mip-level detail")
    args = ap.parse_args()

    comp = find_tool(CANDIDATE_COMPRESSORS, args.compressonator, "COMPRESSONATOR")
    ktx = find_tool(CANDIDATE_KTX, args.ktx, "KTX_TOOL")
    encoder = comp if args.format == "bc7" else ktx

    if args.list_tools:
        print("KTX-Software ktx     : %s" % (ktx or "NOT FOUND"))
        print("  encodes uastc/etc1s, validates every format")
        print("Compressonator CLI   : %s" % (comp or "NOT FOUND"))
        print("  encodes bc7 only")
        print("--format %-12s: encoder %s" % (args.format, encoder or "MISSING"))
        if not encoder:
            sys.stderr.write("\n" + INSTALL_HELP)
        return 0 if encoder else 3
    # No hard abort without an encoder: verifying the committed files is a valid
    # and common use (see process()). Only a row that actually needs building
    # fails, and then INSTALL_HELP is printed once at the end.
    if not encoder:
        sys.stderr.write("fetch_textures: no --format %s encoder found -- can verify "
                         "files already on disk, but cannot build any that are "
                         "missing or in another format.\n" % args.format)

    with open(MANIFEST, encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))
    if not rows:
        sys.stderr.write("fetch_textures: %s is empty\n" % MANIFEST)
        return 2
    wanted = [s for s in args.only.split(",") if s]
    if wanted:
        known = {r["id"] for r in rows}
        bad = [s for s in wanted if s not in known]
        if bad:
            sys.stderr.write("fetch_textures: not in manifest: %s\n" % ",".join(bad))
            return 2
        rows = [r for r in rows if r["id"] in wanted]

    os.makedirs(CACHE_DIR, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)
    sys.stderr.write("fetch_textures: %d material(s) from %s\n"
                     % (len(rows), os.path.relpath(MANIFEST, REPO)))
    if args.format == "bc7":
        settings = "BC7, -Quality %g" % args.quality
    elif args.format == "uastc":
        settings = "UASTC 4x4 + zstd %d, --uastc-quality %d, RDO %s" % (
            args.zstd, args.uastc_quality,
            "off" if args.uastc_rdo_l is None else "lambda %g" % args.uastc_rdo_l)
    else:
        settings = "ETC1S/BasisLZ, qlevel %d clevel %d" % (args.qlevel, args.clevel)
    sys.stderr.write("  format    %s -- %s, %d threads\n"
                     % (args.format, settings, args.threads))
    sys.stderr.write("  encoder   %s\n" % (encoder or "(none -- verify only)"))
    sys.stderr.write("  validator %s\n" % (ktx or "(none -- structural self-check only)"))

    tmproot = tempfile.mkdtemp(prefix="gh2tex_")
    recs = []
    t0 = time.time()
    for i, row in enumerate(rows):
        ts = time.time()
        sys.stderr.write("[%2d/%2d] %s\n" % (i + 1, len(rows), row["id"]))
        rec = process(row, comp, ktx, args, tmproot)
        rec["secs"] = time.time() - ts
        recs.append(rec)
        sys.stderr.write("        %s  %s\n" % ("ok " if rec["ok"] else "FAIL", rec["note"]))
    shutil.rmtree(tmproot, ignore_errors=True)

    hdr = ("%-24s %11s %11s %5s %6s  %s"
           % ("id", "downloaded", "ktx2 bytes", "mips", "secs", "status"))
    print("")
    print(hdr)
    print("-" * len(hdr))
    dl = out = 0
    for r in recs:
        dl += r["dl"]
        out += r["out"]
        print("%-24s %11d %11d %5d %6.1f  %s"
              % (r["id"], r["dl"], r["out"], r["mips"], r["secs"],
                 ("SKIP " if r["skipped"] else "ok   ") if r["ok"] else "FAIL "))
        if not r["ok"] or r["note"] not in ("ktx validate OK", "up to date"):
            print("%-24s %s" % ("", r["note"]))
    print("-" * len(hdr))
    print("%-24s %11d %11d" % ("TOTAL", dl, out))
    print("%-24s %10.1fM %10.1fM  %d/%d ok, %.1fs wall"
          % ("", dl / 1048576.0, out / 1048576.0,
             sum(1 for r in recs if r["ok"]), len(recs), time.time() - t0))
    if all(r["ok"] for r in recs):
        return 0
    # Distinguish "you are missing a tool" (fixable, exit 3, same code as
    # --list-tools) from "a material genuinely failed" (exit 1).
    if encoder is None and any(not r["ok"] for r in recs):
        sys.stderr.write("\n" + INSTALL_HELP)
        return 3
    return 1


if __name__ == "__main__":
    sys.exit(main())
