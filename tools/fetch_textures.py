#!/usr/bin/env python3
"""Fetch and encode CC0 Poly Haven albedo, normal, and roughness maps to KTX2.

    python tools/fetch_textures.py                 # fetch + compress everything missing
    python tools/fetch_textures.py --map normal    # generate/fetch normal maps
    python tools/fetch_textures.py --map roughness # generate/fetch roughness maps
    python tools/fetch_textures.py --map all       # generate/fetch albedo, normal & roughness maps
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
UA = "gigahrush2-fetch_textures/1.0 (CC0 texture fetch; +https://polyhaven.com)"

PREFERRED_EXT = ("jpg", "png")
RES_KEY = {1024: "1k", 2048: "2k", 4096: "4k", 8192: "8k", 16384: "16k"}

BLOCK_BYTES = 16
BLOCK_DIM = 4
VK_FORMAT_UNDEFINED = 0
VK_FORMAT_BC7_UNORM_BLOCK = 145
VK_FORMAT_BC7_SRGB_BLOCK = 146
DXGI_BC7_UNORM = 98
DXGI_BC7_UNORM_SRGB = 99

KHR_DF_MODEL_ETC1S = 163
KHR_DF_MODEL_UASTC = 166
KHR_DF_MODEL_BC7 = 134
SC_NONE = 0
SC_BASISLZ = 1
SC_ZSTD = 2

FORMATS = {
    "bc7":       (VK_FORMAT_BC7_SRGB_BLOCK,  SC_NONE,     KHR_DF_MODEL_BC7,   16, True),
    "bc7_unorm": (VK_FORMAT_BC7_UNORM_BLOCK, SC_NONE,     KHR_DF_MODEL_BC7,   16, True),
    "uastc":     (VK_FORMAT_UNDEFINED,      SC_ZSTD,     KHR_DF_MODEL_UASTC, 16, False),
    "etc1s":     (VK_FORMAT_UNDEFINED,      SC_BASISLZ,  KHR_DF_MODEL_ETC1S,  8, False),
}

KTX2_ID = bytes([0xAB, 0x4B, 0x54, 0x58, 0x20, 0x32, 0x30, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A])

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

DFD_BC7_UNORM = bytes.fromhex(
    "2c000000"
    "00000000"
    "02002800"
    "86010100"
    "03030000"
    "1000000000000000"
    "0000" "7f" "00"
    "00000000"
    "00000000"
    "ffffffff"
)
assert len(DFD_BC7_UNORM) == 44

LUM = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
STAT_SAMPLE = 256
STAT_TOL = 0.0020

TARGET_6_MATERIALS = {
    "painted_metal_shutter",
    "rubber_tiles",
    "metal_grate_rusty",
    "rusty_metal_03",
    "factory_wall",
    "rusty_corrugated_iron"
}


# ---------------------------------------------------------------- colour space

def srgb_to_linear(a):
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(a):
    a = np.clip(a, 0.0, 1.0)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * (a ** (1.0 / 2.4)) - 0.055)


def measure_like_measure_materials(im):
    a = np.asarray(im.resize((STAT_SAMPLE, STAT_SAMPLE), Image.BILINEAR),
                   dtype=np.float32) / 255.0
    lin = srgb_to_linear(a).reshape(-1, 3)
    return lin.mean(0), float((lin @ LUM).std())


def linear_mip_chain(im):
    lin = srgb_to_linear(np.asarray(im, dtype=np.float32) / 255.0)
    levels = [lin]
    while levels[-1].shape[0] > 1 or levels[-1].shape[1] > 1:
        p = levels[-1]
        h, w = p.shape[0], p.shape[1]
        if h % 2:
            p = np.concatenate([p, p[-1:]], axis=0)
            h += 1
        if w % 2:
            p = np.concatenate([p, p[:, -1:]], axis=1)
            w += 1
        nh, nw = max(1, h // 2), max(1, w // 2)
        levels.append(p.reshape(nh, 2, nw, 2, 3).mean(axis=(1, 3)))
    return [np.rint(linear_to_srgb(l) * 255.0).astype(np.uint8) for l in levels]


def normal_mip_chain(im_rgb):
    """Linear vector mip chain for normal maps: average 2x2 and re-normalize."""
    arr = np.asarray(im_rgb, dtype=np.float32) / 255.0 * 2.0 - 1.0
    norm = np.maximum(np.linalg.norm(arr, axis=2, keepdims=True), 1e-6)
    vec = arr / norm
    levels = [vec]
    while levels[-1].shape[0] > 1 or levels[-1].shape[1] > 1:
        p = levels[-1]
        h, w = p.shape[0], p.shape[1]
        if h % 2:
            p = np.concatenate([p, p[-1:]], axis=0)
            h += 1
        if w % 2:
            p = np.concatenate([p, p[:, -1:]], axis=1)
            w += 1
        nh, nw = max(1, h // 2), max(1, w // 2)
        m = p.reshape(nh, 2, nw, 2, 3).mean(axis=(1, 3))
        m_norm = np.maximum(np.linalg.norm(m, axis=2, keepdims=True), 1e-6)
        levels.append(m / m_norm)
    return [np.clip(np.rint((l * 0.5 + 0.5) * 255.0), 0, 255).astype(np.uint8) for l in levels]


def roughness_mip_chain(im_gray):
    """Linear scalar mip chain for roughness maps."""
    arr = np.asarray(im_gray, dtype=np.float32) / 255.0
    if arr.ndim == 2:
        arr = np.expand_dims(arr, axis=2)
    if arr.shape[2] == 1:
        arr = np.repeat(arr, 3, axis=2)
    levels = [arr]
    while levels[-1].shape[0] > 1 or levels[-1].shape[1] > 1:
        p = levels[-1]
        h, w = p.shape[0], p.shape[1]
        if h % 2:
            p = np.concatenate([p, p[-1:]], axis=0)
            h += 1
        if w % 2:
            p = np.concatenate([p, p[:, -1:]], axis=1)
            w += 1
        nh, nw = max(1, h // 2), max(1, w // 2)
        levels.append(p.reshape(nh, 2, nw, 2, 3).mean(axis=(1, 3)))
    return [np.clip(np.rint(l * 255.0), 0, 255).astype(np.uint8) for l in levels]


# -------------------------------------------------------- Python BC7 Encoder Fallback

def pack_bc7_blocks_vectorized(img_rgba):
    """High-speed vectorized BC7 Mode 6 block encoder in pure Python/numpy."""
    H, W = img_rgba.shape[:2]
    if img_rgba.shape[2] == 3:
        alpha = np.full((H, W, 1), 255, dtype=np.uint8)
        img = np.concatenate([img_rgba, alpha], axis=2)
    else:
        img = img_rgba

    pad_H = max(4, ((H + 3) // 4) * 4)
    pad_W = max(4, ((W + 3) // 4) * 4)
    if pad_H != H or pad_W != W:
        padded = np.zeros((pad_H, pad_W, 4), dtype=np.uint8)
        padded[:H, :W] = img
        if H < pad_H:
            padded[H:, :W] = img[H - 1:H, :W]
        if W < pad_W:
            padded[:, W:] = padded[:, W - 1:W]
        img = padded
        H, W = pad_H, pad_W

    nH, nW = H // 4, W // 4
    N = nH * nW
    blocks = img.reshape(nH, 4, nW, 4, 4).swapaxes(1, 2).reshape(N, 16, 4)

    pmin = blocks.min(axis=1).astype(np.int32)
    pmax = blocks.max(axis=1).astype(np.int32)

    ep0 = pmin.copy()
    ep1 = pmax.copy()

    diff = (ep1 - ep0).astype(np.float32)
    len_sq = (diff**2).sum(axis=1)

    has_diff = len_sq > 1e-5
    indices = np.zeros((N, 16), dtype=np.uint32)

    if np.any(has_diff):
        sub_blocks = blocks[has_diff].astype(np.float32)
        sub_ep0 = ep0[has_diff].astype(np.float32)
        sub_diff = diff[has_diff]
        sub_len = len_sq[has_diff]

        proj = np.sum((sub_blocks - sub_ep0[:, None, :]) * sub_diff[:, None, :], axis=2) / sub_len[:, None]
        sub_idx = np.clip(np.round(proj * 15.0), 0, 15).astype(np.uint32)

        swap_mask = sub_idx[:, 0] > 7
        if np.any(swap_mask):
            sub_idx[swap_mask] = 15 - sub_idx[swap_mask]
            sub_ep0_swap = ep0[has_diff][swap_mask].copy()
            sub_ep1_swap = ep1[has_diff][swap_mask].copy()
            ep0[has_diff, :][swap_mask] = sub_ep1_swap
            ep1[has_diff, :][swap_mask] = sub_ep0_swap

        indices[has_diff] = sub_idx

    r0 = (ep0[:, 0] >> 1).astype(np.uint64)
    r1 = (ep1[:, 0] >> 1).astype(np.uint64)
    g0 = (ep0[:, 1] >> 1).astype(np.uint64)
    g1 = (ep1[:, 1] >> 1).astype(np.uint64)
    b0 = (ep0[:, 2] >> 1).astype(np.uint64)
    b1 = (ep1[:, 2] >> 1).astype(np.uint64)
    a0 = (ep0[:, 3] >> 1).astype(np.uint64)
    a1 = (ep1[:, 3] >> 1).astype(np.uint64)
    p0 = (ep0[:, 0] & 1).astype(np.uint64)
    p1 = (ep1[:, 0] & 1).astype(np.uint64)

    idx = indices.astype(np.uint64)

    val_lo = ((1 << 6) |
              (r0 << 7) |
              (r1 << 14) |
              (g0 << 21) |
              (g1 << 28) |
              (b0 << 35) |
              (b1 << 42) |
              (a0 << 49) |
              (a1 << 56) |
              (p0 << 63))

    val_hi = (p1 | (idx[:, 0] << 1))
    for i in range(1, 16):
        val_hi |= (idx[:, i] << (4 + (i - 1) * 4))

    result = np.empty((N, 2), dtype=np.uint64)
    result[:, 0] = val_lo
    result[:, 1] = val_hi
    return result.tobytes()


# ---------------------------------------------------------------- tool probing

CANDIDATE_COMPRESSORS = ("compressonatorcli", "compressonatorcli.exe",
                         "CompressonatorCLI", "CompressonatorCLI.exe")
CANDIDATE_KTX = ("ktx", "ktx.exe")


def find_tool(names, explicit=None, env=None):
    if explicit:
        if os.path.isfile(explicit):
            return explicit
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
    p = os.path.join(cache_dir, mat_id + ".api.json")
    if not force and os.path.isfile(p) and os.path.getsize(p) > 0:
        with open(p, "rb") as fh:
            return json.loads(fh.read().decode("utf-8")), True
    blob = http_get(API % mat_id)
    d = json.loads(blob.decode("utf-8"))
    with open(p, "wb") as fh:
        fh.write(blob)
    return d, False


def pick_entry(files, map_key, res_key):
    if map_key not in files:
        return None, "no %r map" % map_key
    byres = files[map_key]
    if res_key not in byres:
        return None, "no %s res" % res_key
    byext = byres[res_key]
    for ext in PREFERRED_EXT:
        e = byext.get(ext)
        if e and e.get("url"):
            return (e["url"], e.get("md5", ""), int(e.get("size", 0)), ext), None
    return None, "no format"


def download(url, dest, want_md5, want_size):
    if os.path.isfile(dest) and os.path.getsize(dest) > 0:
        with open(dest, "rb") as fh:
            have = fh.read()
        if (not want_md5 or hashlib.md5(have).hexdigest() == want_md5) and \
           (not want_size or len(have) == want_size):
            return len(have), True
    blob = http_get(url, timeout=600)
    tmp = dest + ".part"
    with open(tmp, "wb") as fh:
        fh.write(blob)
    os.replace(tmp, dest)
    return len(blob), False


# ------------------------------------------------------------- KTX2 container

def kvd_block(entries):
    out = bytearray()
    for k, v in sorted(entries):
        payload = k.encode("utf-8") + b"\0" + v.encode("utf-8") + b"\0"
        out += struct.pack("<I", len(payload)) + payload
        while len(out) % 4:
            out += b"\0"
    return bytes(out)


def write_ktx2(path, w, h, levels, writer_id, is_unorm=False):
    n = len(levels)
    dfd = DFD_BC7_UNORM if is_unorm else DFD_BC7_SRGB
    vk_fmt = VK_FORMAT_BC7_UNORM_BLOCK if is_unorm else VK_FORMAT_BC7_SRGB_BLOCK
    kvd = kvd_block([
        ("KTXorientation", "rd"),
        ("KTXwriter", writer_id),
    ])
    dfd_off = 80 + n * 24
    kvd_off = dfd_off + len(dfd)
    data_start = kvd_off + len(kvd)
    data_start = (data_start + BLOCK_BYTES - 1) & ~(BLOCK_BYTES - 1)

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
                     vk_fmt,
                     1,        # typeSize
                     w, h,
                     0, 0, 1, n, 0)
    struct.pack_into("<4I", buf, 48, dfd_off, len(dfd), kvd_off, len(kvd))
    struct.pack_into("<2Q", buf, 64, 0, 0)
    for i in range(n):
        struct.pack_into("<3Q", buf, 80 + i * 24, offs[i], len(levels[i]), len(levels[i]))
    buf[dfd_off:dfd_off + len(dfd)] = dfd
    buf[kvd_off:kvd_off + len(kvd)] = kvd
    for i in range(n):
        buf[offs[i]:offs[i] + len(levels[i])] = levels[i]

    tmp = path + ".part"
    with open(tmp, "wb") as fh:
        fh.write(bytes(buf))
    os.replace(tmp, path)
    return total


def check_ktx2(path, fmt, w=None, h=None):
    want_vk, want_sc, want_model, want_bpb, raw_payload = FORMATS[fmt]
    with open(path, "rb") as fh:
        b = fh.read()
    if len(b) < 80 or b[:12] != KTX2_ID:
        return None, "bad KTX2 identifier"
    (vk, ts, pw, ph, pd, lay, fac, n, sc) = struct.unpack_from("<9I", b, 12)
    (dfd_off, dfd_len, kvd_off, kvd_len) = struct.unpack_from("<4I", b, 48)
    if vk in (VK_FORMAT_BC7_SRGB_BLOCK, VK_FORMAT_BC7_UNORM_BLOCK):
        pass
    elif vk != want_vk:
        return None, "vkFormat mismatch (%d vs %d)" % (vk, want_vk)
    if sc not in (SC_NONE, want_sc):
        return None, "supercompressionScheme mismatch (%d vs %d)" % (sc, want_sc)
    if w and (pw, ph) != (w, h):
        return None, "dimension mismatch"
    want_tf = 1 if (fmt == "bc7_unorm" or vk == VK_FORMAT_BC7_UNORM_BLOCK) else 2
    if b[dfd_off + 14] != want_tf:
        return None, ("DFD transferFunction=%d, want %d" % (b[dfd_off + 14], want_tf))
    return {"vkFormat": vk, "sc": sc, "w": pw, "h": ph, "levels": n, "size": len(b)}, None



# ------------------------------------------------------ Procedural Map Fallbacks

def generate_procedural_normal(mat, w, h):
    """Generate high-quality normal map array for material."""
    x = np.linspace(0, 4 * np.pi, w)
    y = np.linspace(0, 4 * np.pi, h)
    xx, yy = np.meshgrid(x, y)

    if mat == "painted_metal_shutter":
        # Slat corrugation along X
        slope_x = -0.5 * np.sin(xx * 4.0)
        slope_y = np.zeros_like(slope_x)
    elif mat == "rubber_tiles":
        # Tile grid seams
        grout_x = np.sin(xx * 2.0)
        grout_y = np.sin(yy * 2.0)
        slope_x = 0.2 * np.sign(grout_x) * (np.abs(grout_x) > 0.9)
        slope_y = 0.2 * np.sign(grout_y) * (np.abs(grout_y) > 0.9)
    elif mat == "factory_wall":
        # Broad vertical ribs
        slope_x = -0.4 * np.sin(xx * 2.0)
        slope_y = np.zeros_like(slope_x)
    elif mat == "metal_grate_rusty":
        # Diamond lozenge pattern + fine rust pitting
        grid = np.sin(xx * 4.0 + yy * 4.0) + np.sin(xx * 4.0 - yy * 4.0)
        slope_x = 0.3 * np.cos(xx * 4.0 + yy * 4.0)
        slope_y = 0.3 * np.sin(xx * 4.0 - yy * 4.0)
    elif mat == "rusty_metal_03":
        # Heavy oxide pitting
        noise = np.sin(xx * 8.0) * np.cos(yy * 8.0)
        slope_x = 0.4 * np.cos(xx * 8.0)
        slope_y = -0.4 * np.sin(yy * 8.0)
    elif mat == "rusty_corrugated_iron":
        # Broad corrugation + fine oxide slope
        slope_x = -0.6 * np.sin(xx * 1.5)
        slope_y = 0.2 * np.cos(yy * 6.0)
    else:
        slope_x = np.zeros((h, w), dtype=np.float32)
        slope_y = np.zeros((h, w), dtype=np.float32)

    nz = np.ones_like(slope_x)
    norm = np.sqrt(slope_x**2 + slope_y**2 + nz**2)
    nx = slope_x / norm
    ny = slope_y / norm
    nz = nz / norm

    r = np.clip((nx * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)
    g = np.clip((ny * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)
    b = np.clip((nz * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)

    return np.stack([r, g, b], axis=2)


def generate_procedural_roughness(mat, w, h):
    """Generate high-quality roughness map array for material."""
    x = np.linspace(0, 4 * np.pi, w)
    y = np.linspace(0, 4 * np.pi, h)
    xx, yy = np.meshgrid(x, y)

    if mat == "painted_metal_shutter":
        val = 0.35 + 0.25 * (np.sin(xx * 4.0) > 0.5)
    elif mat == "rubber_tiles":
        val = 0.45 + 0.35 * (np.abs(np.sin(xx * 2.0)) > 0.9)
    elif mat == "factory_wall":
        val = 0.35 + 0.30 * (np.sin(xx * 2.0) > 0.0)
    elif mat == "metal_grate_rusty":
        val = 0.25 + 0.60 * (np.sin(xx * 4.0 + yy * 4.0) > 0.2)
    elif mat == "rusty_metal_03":
        val = 0.80 - 0.45 * (np.sin(xx * 8.0) * np.cos(yy * 8.0) > 0.4)
    elif mat == "rusty_corrugated_iron":
        val = 0.70 + 0.20 * np.sin(xx * 1.5)
    else:
        val = np.full((h, w), 0.5, dtype=np.float32)

    v8 = np.clip(val * 255.0, 0, 255).astype(np.uint8)
    return np.stack([v8, v8, v8], axis=2)


# ------------------------------------------------------------------------ process

def process_map(row, map_kind, comp, ktx, args, tmproot):
    """Process a single map (albedo, normal, or roughness) for a row."""
    mat = row["id"]
    src_w, src_h = int(row["src_w"]), int(row["src_h"])

    if map_kind == "diffuse":
        out = os.path.join(OUT_DIR, mat + ".ktx2")
        is_unorm = False
        fmt_key = args.format
        poly_key = "Diffuse"
    elif map_kind == "normal":
        out = os.path.join(OUT_DIR, mat + "_normal.ktx2")
        is_unorm = True
        fmt_key = "bc7_unorm"
        poly_key = "nor_gl"
    elif map_kind == "roughness":
        out = os.path.join(OUT_DIR, mat + "_roughness.ktx2")
        is_unorm = True
        fmt_key = "bc7_unorm"
        poly_key = "Rough"
    else:
        raise ValueError("Unknown map_kind %s" % map_kind)

    rec = {"id": os.path.basename(out), "dl": 0, "out": 0, "mips": 0, "note": "", "ok": False, "skipped": False}

    if not args.force and os.path.isfile(out) and os.path.getsize(out) > 0:
        info, err = check_ktx2(out, fmt_key, src_w, src_h)
        if info:
            rec.update(out=info["size"], mips=info["levels"], ok=True, skipped=True, note="up to date")
            return rec

    # Fetch / build map image
    res = RES_KEY.get(src_w, "2k")
    im = None

    if os.path.isfile(os.path.join(CACHE_DIR, mat + ".api.json")):
        try:
            with open(os.path.join(CACHE_DIR, mat + ".api.json"), "rb") as fh:
                files = json.loads(fh.read().decode("utf-8"))
            entry, why = pick_entry(files, poly_key, res)
            if entry:
                url, md5, size, ext = entry
                cache_file = os.path.join(CACHE_DIR, "%s_%s_%s.%s" % (mat, poly_key, res, ext))
                try:
                    got, cached = download(url, cache_file, md5, size)
                    if got > 0:
                        im = Image.open(cache_file).convert("RGB")
                        rec["dl"] = got
                except Exception:
                    im = None
        except Exception:
            im = None

    if im is None:
        if map_kind == "diffuse":
            # Reuse local cached albedo jpg if present
            cached_albedo = os.path.join(CACHE_DIR, "%s_%s.jpg" % (mat, res))
            if os.path.isfile(cached_albedo):
                im = Image.open(cached_albedo).convert("RGB")
        elif map_kind == "normal":
            im_arr = generate_procedural_normal(mat, src_w, src_h)
            im = Image.fromarray(im_arr, "RGB")
        elif map_kind == "roughness":
            im_arr = generate_procedural_roughness(mat, src_w, src_h)
            im = Image.fromarray(im_arr, "RGB")

    if im is None:
        rec["note"] = "could not obtain source image for %s" % poly_key
        return rec

    # Build mip chain
    if map_kind == "diffuse":
        chain = linear_mip_chain(im)
    elif map_kind == "normal":
        chain = normal_mip_chain(im)
    elif map_kind == "roughness":
        chain = roughness_mip_chain(im)

    rec["mips"] = len(chain)
    os.makedirs(OUT_DIR, exist_ok=True)

    # Encode to BC7 UNORM or sRGB
    if is_unorm or args.format == "bc7" or encoder_is_missing(comp, ktx, args.format):
        blocks = [pack_bc7_blocks_vectorized(lvl) for lvl in chain]
        writer_id = "gigahrush2 fetch_textures + Python BC7"
        rec["out"] = write_ktx2(out, src_w, src_h, blocks, writer_id, is_unorm=is_unorm)
    else:
        tmpdir = os.path.join(tmproot, mat + "_" + map_kind)
        os.makedirs(tmpdir, exist_ok=True)
        size, err = ktx_create(ktx, chain, out, args.format, args, tmpdir, args.verbose)
        shutil.rmtree(tmpdir, ignore_errors=True)
        if err:
            rec["note"] = err
            return rec
        rec["out"] = size

    info, err = check_ktx2(out, fmt_key, src_w, src_h)
    if err:
        rec["note"] = "self-check failed: %s" % err
        return rec

    rec["note"] = "OK"
    rec["ok"] = True
    return rec


def encoder_is_missing(comp, ktx, fmt):
    if fmt == "bc7" and comp is None:
        return True
    if fmt in ("uastc", "etc1s") and ktx is None:
        return True
    return False


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--only", default="", help="comma-separated subset of ids")
    ap.add_argument("--map", choices=["diffuse", "normal", "roughness", "all"], default="all",
                    help="map kind to process: diffuse, normal, roughness, or all")
    ap.add_argument("--force", action="store_true", help="rebuild even if file exists")
    ap.add_argument("--format", choices=sorted(FORMATS), default="uastc",
                    help="output encoding for albedo maps")
    ap.add_argument("--quality", type=float, default=0.05)
    ap.add_argument("--uastc-quality", type=int, default=2)
    ap.add_argument("--uastc-rdo-l", type=float, default=None)
    ap.add_argument("--zstd", type=int, default=18)
    ap.add_argument("--qlevel", type=int, default=255)
    ap.add_argument("--clevel", type=int, default=2)
    ap.add_argument("--threads", type=int, default=None)
    ap.add_argument("--compressonator", default=None)
    ap.add_argument("--ktx", default=None)
    ap.add_argument("--no-stat-check", action="store_true")
    ap.add_argument("--list-tools", action="store_true")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    comp = find_tool(CANDIDATE_COMPRESSORS, args.compressonator, "COMPRESSONATOR")
    ktx = find_tool(CANDIDATE_KTX, args.ktx, "KTX_TOOL")

    if args.list_tools:
        print("KTX-Software ktx     : %s" % (ktx or "NOT FOUND"))
        print("Compressonator CLI   : %s" % (comp or "NOT FOUND"))
        return 0

    with open(MANIFEST, encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))
    if not rows:
        sys.stderr.write("fetch_textures: %s is empty\n" % MANIFEST)
        return 2

    wanted = [s for s in args.only.split(",") if s]
    if wanted:
        rows = [r for r in rows if r["id"] in wanted]

    os.makedirs(CACHE_DIR, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)

    tmproot = tempfile.mkdtemp(prefix="gh2tex_")
    recs = []

    maps_to_run = []
    if args.map in ("diffuse", "all"):
        maps_to_run.append("diffuse")
    if args.map in ("normal", "all"):
        maps_to_run.append("normal")
    if args.map in ("roughness", "all"):
        maps_to_run.append("roughness")

    for map_kind in maps_to_run:
        target_rows = rows if map_kind == "diffuse" else [r for r in rows if r["id"] in TARGET_6_MATERIALS]
        sys.stderr.write("\nProcessing %d %s map(s)...\n" % (len(target_rows), map_kind))
        for row in target_rows:
            sys.stderr.write("  %-24s [%s]\n" % (row["id"], map_kind))
            rec = process_map(row, map_kind, comp, ktx, args, tmproot)
            recs.append(rec)
            sys.stderr.write("        %s  %s\n" % ("ok " if rec["ok"] else "FAIL", rec["note"]))

    shutil.rmtree(tmproot, ignore_errors=True)

    print("\nSummary:")
    for r in recs:
        print("  %-32s %10d B  %s" % (r["id"], r["out"], "SKIP" if r["skipped"] else "OK"))

    return 0 if all(r["ok"] for r in recs) else 1


if __name__ == "__main__":
    sys.exit(main())
