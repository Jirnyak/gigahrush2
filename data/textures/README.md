# data/textures — UASTC+zstd / KTX2 albedo maps

**Provider: [Poly Haven](https://polyhaven.com). Licence: CC0 1.0 (public domain
dedication). No attribution is legally required; this file exists anyway, because a
binary blob in a repository with no provenance note is how a licence question becomes
unanswerable two years later.**

16 files, one per row of [`../materials.csv`](../materials.csv). Each is the
material's **albedo / diffuse** map only, with a full 12-level mip chain, in a KTX2
container holding **UASTC LDR 4x4 blocks supercompressed with Zstandard**.

> **This pack changed format on 2026-07-29 and the change is not payload-compatible.**
> It used to be raw BC7 that a loader could upload verbatim. It is now a
> *supercompressed* container: `vkFormat = VK_FORMAT_UNDEFINED`,
> `supercompressionScheme = 2`. Nothing in `src/` reads these files yet — checked,
> the only reference to `.ktx2` anywhere in the tree is the tool that writes them —
> so no code broke, but anything written against the old contract must be rewritten.
> See [What a Vulkan loader must do](#what-a-vulkan-loader-must-do-differently).

Regenerate — or fetch on a fresh clone — with:

```sh
python tools/fetch_textures.py                 # from the repo root; UASTC is the default
python tools/fetch_textures.py --force         # re-encode files that already exist
python tools/fetch_textures.py --format bc7    # the old un-supercompressed pack
python tools/fetch_textures.py --list-tools    # if it complains about the encoder
```

The script is idempotent: a `.ktx2` that already exists and passes a structural
check is skipped without so much as an API call. Because all 16 files ship in the
repo, **every row takes that skip path on a fresh clone, so verifying the shipped
pack needs no encoder at all** — measured 2026-07-29: 16/16 SKIP, exit 0, 0.1 s, no
network, with neither KTX-Software nor Compressonator installed. The encoder is
required only to *build* a file that is missing, rejected, **or in the other
format**: `--format` is part of the structural check, so switching format rebuilds
all 16 rather than silently keeping the old encoding.

Output is byte-reproducible. Two `--force` runs of `rubber_tiles` produced the same
md5; a run with `--threads 4` produced an identical *payload* (sha256 of the level
data, 3,092,957 bytes, matches) differing only by the 12 bytes `--threads 4` adds to
the `KTXwriterScParams` metadata — which is why the script does not pass `--threads`
to `ktx create` unless asked, so a rebuild on another machine does not rewrite
64 MiB of binary for a core-count difference.

## Format contract

Anything loading these files codes against exactly this. All 16 files share one
byte-identical header, DFD and key/value block — verified by hashing those three
regions across the pack: **1 distinct signature, 16 files**.

| property | value |
|---|---|
| container | KTX2 (identifier `\xABKTX 20\xBB\r\n\x1A\n`) |
| `vkFormat` | **`VK_FORMAT_UNDEFINED` (0)** — there is no GPU format in the file |
| `supercompressionScheme` | **2 = `KTX_SS_ZSTD`** (Zstandard) |
| DFD | `colorModel` **166 (`KHR_DF_MODEL_UASTC`)**, primaries 1 (BT.709/sRGB), **transferFunction 2 (sRGB)**, `flags = 0`, `texelBlockDimension` 4x4x1x1, `bytesPlane0 = 16` |
| DFD sample | one, `channelType 0 = KHR_DF_CHANNEL_UASTC_RGB`, 128 bits — **no alpha channel** |
| dimensions | 2048 x 2048, `pixelDepth = 0`, `layerCount = 0`, `faceCount = 1`, `typeSize = 1` |
| `levelCount` | 12 (2048 down to 1x1) |
| block layout (after transcode) | 4x4 texels, 16 bytes/block, tightly packed, row-major, no per-row padding |
| level 0 inflated size | 512 x 512 blocks = **4,194,304 bytes** |
| whole chain inflated size | **5,592,432 bytes**, every file, always |
| level order in file | smallest mip first; the **level index** (at byte 80) is in level order, entry 0 = the 2048 mip |
| level offsets | **NOT aligned.** `mipPadding` does not apply to a supercompressed file, so levels are packed tight — measured offsets mod 16 across one file: 0, 11, 5, 3, 6, 4, 6, 12, 3, 10, 1, 8 |
| `supercompressionGlobalData` | empty (`byteOffset 0, byteLength 0`) — that is BasisLZ-only |
| orientation | `KTXorientation = rd` — row 0 is the top row, so a sampler needs no V flip |
| bytes per file | 3,093,493 to 4,986,272; header+index+DFD+KVD is 536 of them |

## What a Vulkan loader must do differently

The old BC7 pack was `read file -> memcpy level data into a staging buffer -> upload`.
That is now wrong in three separate ways, and each one fails silently rather than
loudly:

1. **There is no `vkFormat` to pass to `VkImageCreateInfo`.** The header says
   `VK_FORMAT_UNDEFINED`. The GPU format is a *decision the loader makes*, not a
   field it reads.
2. **The level bytes are a zstd stream, not blocks.** Level *i* must be inflated
   from `byteLength` to `uncompressedByteLength`, then the UASTC blocks inside must
   be **transcoded** to a real block format. Uploading the compressed bytes produces
   noise, not a texture.
3. **Level offsets are no longer 16-byte aligned.** The BC7 pack aligned every one of
   them (this script's BC7 writer still does), so a loader could assume it. Here they
   are packed tight: take each offset from the level index verbatim, never round it,
   and do not expect a level to be mappable straight into a block-aligned upload.

The sane implementation is libktx, which the engine **does not link today** (there is
no `ktx`/`libktx` reference in `CMakeLists.txt` or `src/`; adding one is part of the
loader lane's work). It handles the inflate and the transcode in one call:

```c
ktxTexture2* tex;
ktxTexture2_CreateFromNamedFile(path, KTX_TEXTURE_CREATE_LOAD_IMAGE_DATA_BIT, &tex);
if (ktxTexture2_NeedsTranscoding(tex))                       // true for this pack
    ktxTexture2_TranscodeBasis(tex, KTX_TTF_BC7_RGBA, 0);
// now tex->vkFormat is a real format and tex->pData is uploadable block data
```

What that yields, measured with the CLI that calls the same library
(`ktx transcode --target bc7`, 2026-07-29, all 16 files):

- `vkFormat` becomes **`VK_FORMAT_BC7_SRGB_BLOCK` (146)** — libktx picks the `_SRGB`
  variant from the DFD's `transferFunction = 2`, so the sampler still linearises in
  hardware and the shader rule below is unchanged.
- `supercompressionScheme` becomes 0, `levelCount` stays 12, payload is 5,592,432
  bytes. **The transcode is size-preserving**: UASTC LDR 4x4 and BC7 are both 16
  bytes per 4x4 block, so a loader can size its staging buffer from the header
  arithmetic alone (4,194,304 for level 0, 5,592,432 for the chain) without
  inflating anything first.
- Cost, as an **upper bound only**: 247-476 ms per map, 4.80 s for all 16
  (best-of-3, includes process spawn, a 3-5 MB read and a 5.6 MB write per map). The
  in-engine cost is **not measured** — there is no loader to measure. Treat the CLI
  figure as a ceiling, not as the number.

Transcode targets, in order of preference:

| target | quality | note |
|---|---|---|
| `KTX_TTF_BC7_RGBA` | best on desktop | measured below; what this pack is intended for |
| `KTX_TTF_ASTC_4x4_RGBA` | **lossless** | UASTC is a subset of ASTC 4x4, so this is a re-wrap, not a re-encode. Mobile/Apple GPUs |
| `KTX_TTF_BC1_RGB` | much worse | 4 bits/texel; only if BC7 is unavailable |
| `KTX_TTF_RGBA32` | lossless of the UASTC result | 16 MiB per level 0; a debug path, not a shipping one |

Do **not** hand-roll this. A UASTC transcoder is a mode-by-mode ASTC-subset decoder
plus a BC7 mode packer; the payload also needs a zstd decompressor. Both already
exist inside libktx, and both are exactly the kind of code that fails as a plausible
image rather than as an error.

### The sRGB rule is unchanged, and it still changes the shader

These are display-referred photographs: the stored bytes are sRGB-encoded, and the
DFD says so (`transferFunction 2`). Transcode to an `_SRGB` target and the sampler
hardware linearises each texel *before* filtering, for free and correctly. So a
shader sampling these must **not** gamma-correct again — in particular, do not apply
`shaders/cube.frag`'s existing `pow(vColor, vec3(kGamma))` to a sampled albedo. That
`pow` exists because the per-material constant colour in `render/cube_pass.cpp` is
authored in sRGB; a texture fetch has already been linearised by then. Applying it
twice darkens mid-grey by roughly 2x.

Transcoding to a `_UNORM` target instead changes no bits — only the sampler's
conversion — but then the `pow` becomes mandatory and filtering happens in the wrong
space.

## Size

| pack | 16 files | vs BC7 | 6 bound materials only | source of the number |
|---|---|---|---|---|
| raw BC7 (what this pack was) | 89,487,104 B = **85.34 MiB** | 1.000x | 33,557,664 B = 32.00 MiB | previous pack, re-measured |
| **UASTC 4x4 + zstd 18 (SHIPPED)** | **67,329,856 B = 64.21 MiB** | **0.752x** | 26,277,453 B = **25.06 MiB** | this pack |
| UASTC + RDO lambda 1.0 + zstd 18 | 46,556,681 B = 44.40 MiB | 0.520x | 19,627,465 B = 18.72 MiB | full 16-file run, all validated |
| ETC1S / BasisLZ (qlevel 255, clevel 2) | 11,034,999 B = 10.52 MiB | 0.123x | 4,660,481 B = 4.44 MiB | full 16-file run, all validated |

**The supercompressed pack is 64.21 MiB, not 15-25 MiB, and that gap is not a
mistake in the settings.** UASTC LDR is *also* 8 bits per texel before zstd — same as
BC7 — so zstd is only removing what entropy coding can find in a photograph's noise
floor. On the smoothest map here that is 45% (`rubber_tiles` 0.553x); on the busiest
it is 11% (`metal_grate_rusty` 0.892x). Nothing in the UASTC family reaches 25 MiB on
16 2K maps: RDO at lambda 1.0 gets the pack to 44.40 MiB and costs **0.5 to 8.7 dB**
doing it (per map, against the shipped `->BC7` column below), and on
`blue_metal_plate` pushing lambda from 1.0 to 8.0 buys a further 11% of that one file
for another 4.4 dB by the encoder's own PSNR — the full per-map lambda sweep is in
`--help`. The only encoding in this script that reaches the target is ETC1S, at
10.52 MiB and **10 to 19 dB** below BC7 (-10.3 on the busiest map, -19.0 on the
smoothest) — see the quality table.

Per file (payload ratio is against the 5,592,432-byte uncompressed block chain):

| file | bytes | ratio |
|---|---|---|
| `blue_metal_plate.ktx2` | 3,950,927 | 0.706 |
| `box_profile_metal_sheet.ktx2` | 3,689,607 | 0.660 |
| `container_side.ktx2` | 3,612,757 | 0.646 |
| `corrugated_iron.ktx2` | 4,465,511 | 0.798 |
| `corrugated_iron_02.ktx2` | 4,284,491 | 0.766 |
| `corrugated_iron_03.ktx2` | 4,184,060 | 0.748 |
| `factory_wall.ktx2` | 4,559,562 | 0.815 |
| `green_metal_rust.ktx2` | 3,533,627 | 0.632 |
| `metal_grate_rusty.ktx2` | 4,986,272 | 0.892 |
| `metal_plate.ktx2` | 4,723,036 | 0.845 |
| `metal_plate_02.ktx2` | 4,414,972 | 0.789 |
| `painted_metal_shutter.ktx2` | 4,175,988 | 0.747 |
| `rubber_tiles.ktx2` | 3,093,493 | 0.553 |
| `rusty_corrugated_iron.ktx2` | 4,595,391 | 0.822 |
| `rusty_metal_03.ktx2` | 4,866,747 | 0.870 |
| `worn_shutter.ktx2` | 4,193,415 | 0.750 |
| **total** | **67,329,856** | 0.752 |

The intermediate download cache lives in `.cache/` here (~33 MiB of source JPEGs
plus the API responses). It is already git-ignored by the repo-wide `.cache/` rule
and is safe to delete — deleting it costs one re-download.

## Measured quality cost of the format change

Method: decode mip 0 back out of the shipped container and compare it against the
cached source JPEG in 8-bit sRGB. PSNR over all three channels; SSIM with a Gaussian
window (sigma 1.5), averaged over channels. The BC7 column is the previous pack
measured the same way — it reproduces the four figures that pack documented
(`rubber_tiles` 59.72, `blue_metal_plate` 53.56, `rusty_metal_03` 46.88,
`metal_grate_rusty` 43.55) to the decimal, which is what makes the comparison
apples-to-apples rather than two different measurements.

Two UASTC columns, because they answer different questions. **`UASTC`** is the
payload decoded straight to RGBA — the fidelity the encoder achieved, and what an
ASTC-capable GPU will see. **`->BC7`** is the payload transcoded to BC7 and then
decoded — a *second* lossy step, and the one a desktop Vulkan loader actually
uploads. Quote the `->BC7` column when talking about what ships.

| material | BC7 dB | UASTC dB | delta | ->BC7 dB | **delta** | BC7 SSIM | ->BC7 SSIM |
|---|---|---|---|---|---|---|---|
| `rubber_tiles` | 59.72 | 57.12 | -2.60 | 52.70 | **-7.02** | 0.99909 | 0.99746 |
| `green_metal_rust` | 56.23 | 54.56 | -1.67 | 52.51 | **-3.72** | 0.99819 | 0.99610 |
| `blue_metal_plate` | 53.56 | 52.75 | -0.81 | 51.53 | **-2.03** | 0.99663 | 0.99493 |
| `container_side` | 53.36 | 53.21 | -0.15 | 51.92 | -1.44 | 0.99568 | 0.99438 |
| `box_profile_metal_sheet` | 53.27 | 52.78 | -0.49 | 51.94 | -1.33 | 0.99578 | 0.99461 |
| `corrugated_iron_02` | 51.38 | 51.27 | -0.11 | 49.68 | -1.70 | 0.99512 | 0.99339 |
| `corrugated_iron_03` | 51.16 | 51.28 | +0.12 | 50.23 | -0.93 | 0.99366 | 0.99245 |
| `worn_shutter` | 50.80 | 50.60 | -0.20 | 49.12 | -1.68 | 0.99498 | 0.99315 |
| `painted_metal_shutter` | 50.58 | 50.40 | -0.18 | 49.02 | -1.56 | 0.99681 | 0.99569 |
| `factory_wall` | 50.57 | 50.66 | +0.09 | 49.60 | -0.97 | 0.99390 | 0.99278 |
| `metal_plate_02` | 50.52 | 50.33 | -0.19 | 48.93 | -1.59 | 0.99525 | 0.99371 |
| `corrugated_iron` | 49.96 | 49.89 | -0.07 | 48.75 | -1.21 | 0.99534 | 0.99416 |
| `metal_plate` | 48.89 | 48.73 | -0.16 | 47.49 | -1.40 | 0.99204 | 0.98990 |
| `rusty_corrugated_iron` | 47.92 | 48.05 | +0.13 | 47.06 | -0.86 | 0.99009 | 0.98878 |
| `rusty_metal_03` | 46.88 | 46.85 | -0.03 | 46.08 | -0.80 | 0.98768 | 0.98631 |
| `metal_grate_rusty` | 43.55 | 42.68 | -0.87 | 42.28 | -1.27 | 0.98403 | 0.97947 |

Read across the columns, not down them:

- **The UASTC encode itself is nearly free.** Mean -0.45 dB against BC7, range -2.60
  to **+0.13** — four maps come out *better* than BC7 did. (Unsurprising rather than
  proven: `--uastc-quality 2` was picked at the top of its own quality curve while
  the BC7 pack uses Compressonator's `-Quality 0.05`, which its own table shows is
  2.4 dB below that encoder's ceiling. The two encoders were not equalised for time.)
- **The BC7 transcode is where the money goes.** Mean **-1.84 dB**, range -0.80 to
  -7.02, mean SSIM -0.00169. That is the real cost of the format change on a desktop
  Vulkan loader, and it is unavoidable: transcoding one lossy 4x4 block format to a
  different lossy 4x4 block format cannot be free.
- **Smooth maps lose most; busy maps lose least.** `rubber_tiles` (a flat dark rubber
  floor, the highest-PSNR map in the pack) drops 7.02 dB, while `metal_grate_rusty`
  (the busiest) drops 1.27. In absolute terms the pack's floor barely moves: the worst
  map was 43.55 dB and is now 42.28 dB. The maps that lose the most dB are the ones
  that had dB to spare.
- **Transcoding to ASTC 4x4 instead costs nothing** — UASTC is an ASTC subset, so the
  `UASTC` column *is* the ASTC number. The -1.84 dB is a BC7-specific tax.

For the two formats not shipped, the same measurement on five maps:

| material | BC7 | UASTC->BC7 | RDO 1.0 ->BC7 | ETC1S ->BC7 |
|---|---|---|---|---|
| `rubber_tiles` | 59.72 | 52.70 | 44.03 | 40.74 |
| `blue_metal_plate` | 53.56 | 51.53 | 45.73 | 40.83 |
| `factory_wall` | 50.57 | 49.60 | 44.73 | 39.47 |
| `rusty_metal_03` | 46.88 | 46.08 | 43.18 | 36.87 |
| `metal_grate_rusty` | 43.55 | 42.28 | 41.77 | 33.28 |

ETC1S also collapses SSIM on the busiest map (0.98403 -> 0.85330 on
`metal_grate_rusty`), which is the number that would show up as visible blocking
rather than as a slightly softer texture.

## Compression settings

| setting | value |
|---|---|
| encoder | **KTX-Software `ktx create` v4.4.2 / libktx v4.4.2** |
| codec | `--encode uastc` (UASTC LDR 4x4) |
| quality | `--uastc-quality 2` |
| RDO | **off** — no `--uastc-rdo` |
| supercompression | `--zstd 18` |
| input format | `--format R8G8B8_SRGB` (3-channel: no alpha modes wasted on a constant 255) |
| colour labelling | `--assign-tf srgb --assign-primaries bt709` (label, not convert — Pillow's PNGs carry no colour chunks) |
| orientation | `--assign-texcoord-origin top-left` -> `KTXorientation = rd` |
| mip generation | **not** the encoder's — see below |
| `--threads` | not passed; see the reproducibility note at the top |
| source map | Poly Haven `Diffuse`, `2k`, `jpg` |

Recorded in the container itself as
`KTXwriterScParams = "--uastc-quality 2 --zstd 18"`, and
`KTXwriter = "ktx create v4.4.2 / libktx v4.4.2"`. Note that the writer id is
KTX-Software's, not this project's: `ktx create` writes that key itself and the
script does not fight it.

Both settings were chosen by measurement. `--uastc-quality`, on `blue_metal_plate`
at zstd 18:

| `--uastc-quality` | wall | bytes | PSNR |
|---|---|---|---|
| 0 | 2 s | 3,713,766 | 53.13 |
| 1 (encoder default) | 3 s | 3,887,697 | 53.37 |
| **2 (used)** | **4 s** | **3,950,927** | **53.89** |
| 3 | 6 s | 3,951,109 | 53.86 |
| 4 | 137 s | 4,195,358 | 53.69 |

2 is the top of the curve, not a compromise: 3 and 4 are slower, larger **and** no
better. `--zstd`, on one 2K UASTC payload: level 1 = 4,848,351 B, 3 = 4,475,140,
9 = 4,174,059, 12 = 4,149,153, **18 = 3,950,927**, 20 = 3,950,173, 22 = 3,950,173.
18 is the knee — 22 wants more memory for 754 bytes. Uncompressed, the same
container is 5,592,960 bytes.

RDO is off because its price is visible in the table above — against the shipped
`->BC7` column, lambda 1.0 costs a further **-8.67 dB** on `rubber_tiles` and
-4.87 on `factory_wall` — and its benefit is very uneven: on
`blue_metal_plate` lambda 1.0 saves 44% of the file, on `metal_grate_rusty` it saves
3%. Turn it on with `--uastc-rdo-l <lambda>` if the pack must shrink further and the
dB are acceptable.

### Mips are box-filtered in linear light by the script, not by either encoder

Both encoders can generate mips and both get this wrong for this data, in opposite
directions. Measured on `blue_metal_plate` (2026-07-29), mean linear luminance
relative to level 0:

| chain | at mip 8 | at mip 11 | shape |
|---|---|---|---|
| Compressonator's own generator | **-9.2%** | — | monotonic darkening |
| `ktx create --generate-mipmap --mipmap-filter box` | **+2.45%** | **+3.99%** | monotonic brightening |
| `ktx create --generate-mipmap --mipmap-filter lanczos4` (its default) | -0.03% | +0.75% | no trend, but a sharpening filter with ringing, not mean-preserving |
| **this script's chain, decoded back out of the shipped file** | +0.73% | +0.75% | no trend |

So `fetch_textures.py` decodes to float, converts sRGB->linear, box-filters 2x2 in
linear light (a box filter over a power-of-two square is exact and mean-preserving),
re-encodes each level to sRGB bytes, and hands the encoder the finished chain.
`ktx create` accepts that directly — **it takes one input file per mip level**, base
level first, and only resamples when explicitly asked with `--generate-mipmap`. That
was verified rather than assumed: with 12 inputs and `--levels 12` its own
`--compare-psnr` reports levels 1-11 against *our* levels 1-11 at ~50 dB, i.e. those
are the pixels it encoded. `tools/measure_materials.py` refuses the same mistake for
the same reason.

Flatness of the shipped chains, decoded level by level out of the container:

| pack | `rubber_tiles` | `blue_metal_plate` |
|---|---|---|
| source chain, before any encoder | 0.458% | 0.540% |
| previous raw-BC7 pack | 0.488% | — |
| **this UASTC pack** | **0.539%** | **0.767%** |

(max deviation of mean linear luminance from level 0, across all 12 levels). The
UASTC encode adds 0.05-0.23 percentage points of block-quantisation noise on top of
the source chain and introduces **no trend with depth**, which is the property that
matters — an earlier "0.08%" figure for the BC7 pack is not comparable, since the
same measurement applied to that same BC7 pack gives 0.488%, dominated by a +0.49%
bump at level 1 that is present in the source chain itself.

## What is IN these files, and what is not

Albedo only. Poly Haven also publishes `Rough`, `AO`, `Displacement`, `nor_gl` and
`nor_dx` for every one of these assets, and `tools/fetch_textures.py` could fetch
them by changing one constant — but there is no PBR pass to consume them yet, and
three more maps per material would put ~200 MB of unread binary in the repository
(at the new ratio). When a roughness/normal consumer exists, extend the script; do
not commit maps ahead of the code that reads them. Note that a normal map wants
`--normal-mode` and `--assign-tf linear`, not the settings above.

## Which cell materials these actually cover

`data/materials.csv` has 16 rows and `src/world/materials.h` has 16 `CellType`
ids — **the two 16s are unrelated and do not line up.** The authoritative binding
lives in the `MATERIALS` table in `tools/gen_material_surface.py`, re-verified
2026-07-29 by reading that table: exactly six of its entries carry a non-`None` CSV
id, and they are

| `CellType` | material | this pack's file |
|---|---|---|
| 10 `kMatShopShutter` | shop shutter | `painted_metal_shutter.ktx2` |
| 11 `kMatLino` | lino | `rubber_tiles.ktx2` |
| 12 `kMatFactoryWall` | factory wall | `factory_wall.ktx2` |
| 13 `kMatTread` | tread plate | `metal_grate_rusty.ktx2` |
| 14 `kMatRust` | rust | `rusty_metal_03.ktx2` |
| 15 `kMatRubble` | rubble | `rusty_corrugated_iron.ktx2` |

Ids 1–9 are the maze-demo vocabulary plus the authored residential pair (plaster,
parquet) and the signage pads; the pack contains no plaster, wood, lino or concrete
photograph, so those stay authored — that split is deliberate and documented in
`materials.h`. The remaining ten files here (`blue_metal_plate`,
`box_profile_metal_sheet`, `container_side`, `corrugated_iron`,
`corrugated_iron_02`, `corrugated_iron_03`, `green_metal_rust`, `metal_plate`,
`metal_plate_02`, `worn_shutter`) are not bound to any cell material: read their
`role` column in the CSV — they were harvested for equipment casings, tool
housings and prop panels, not for walls.

A texture array indexed by `CellType` therefore needs 16 slots of which 6 are
filled from this directory. Do not silently point the other 10 at an arbitrary
file from this pack because the count happens to match.

Note also what `gen_material_surface.py` actually consumes: the CSV's `lin_r/lin_g/
lin_b/lum_std` **statistics**, never the `.ktx2` files. Dropping files from this
directory would not change a single generated surface parameter today.

## Provenance, per file

Every source URL below is the `source` column of the matching `data/materials.csv`
row; `fetch_textures.py` refuses to run if a row's URL slug stops matching its id.
The md5 is the value Poly Haven's own API declares for that file, and the script
verifies the downloaded bytes against it before compressing anything.

Beyond the hash, each download is checked against the CSV *content*: the script
re-derives the linear albedo mean the way `tools/measure_materials.py` did (256x256
bilinear resample, sRGB→linear, per-channel mean) and rejects the material if it
does not reproduce the committed `lin_r`/`lin_g`/`lin_b`. Measured 2026-07-29, the
fetched files reproduce all three channels **to the full four decimal places the CSV
carries** — which is what proves these are the same photographs the committed
statistics were measured from, and not merely files with the same names.

| file | source asset (CC0, Poly Haven) | map / src | src jpg md5 | src bytes | .ktx2 bytes | mips |
|---|---|---|---|---|---|---|
| `blue_metal_plate.ktx2` | [blue_metal_plate](https://polyhaven.com/a/blue_metal_plate) | Diffuse 2k jpg / 2048x2048 | `6189f7c443f0b7767d3e046f021b5495` | 1,518,621 | 3,950,927 | 12 |
| `box_profile_metal_sheet.ktx2` | [box_profile_metal_sheet](https://polyhaven.com/a/box_profile_metal_sheet) | Diffuse 2k jpg / 2048x2048 | `965ed6379d3468a1fe1beb7297a3487d` | 1,473,974 | 3,689,607 | 12 |
| `container_side.ktx2` | [container_side](https://polyhaven.com/a/container_side) | Diffuse 2k jpg / 2048x2048 | `6c9e41a68d17430477cf740aed4315c1` | 1,833,036 | 3,612,757 | 12 |
| `corrugated_iron.ktx2` | [corrugated_iron](https://polyhaven.com/a/corrugated_iron) | Diffuse 2k jpg / 2048x2048 | `fb7cfe9f978589b8e3d1155a859fed46` | 2,605,861 | 4,465,511 | 12 |
| `corrugated_iron_02.ktx2` | [corrugated_iron_02](https://polyhaven.com/a/corrugated_iron_02) | Diffuse 2k jpg / 2048x2048 | `88f0ec0310e41f408dd0092c8c53db58` | 2,325,335 | 4,284,491 | 12 |
| `corrugated_iron_03.ktx2` | [corrugated_iron_03](https://polyhaven.com/a/corrugated_iron_03) | Diffuse 2k jpg / 2048x2048 | `5eb86304eada29624fc1e3c3a1fa2ff7` | 1,908,641 | 4,184,060 | 12 |
| `factory_wall.ktx2` | [factory_wall](https://polyhaven.com/a/factory_wall) | Diffuse 2k jpg / 2048x2048 | `ea55cbd02a08fb09ffaf623bc2da12d0` | 1,140,576 | 4,559,562 | 12 |
| `green_metal_rust.ktx2` | [green_metal_rust](https://polyhaven.com/a/green_metal_rust) | Diffuse 2k jpg / 2048x2048 | `fed1afb0e3b6f5a5710cee229fd54897` | 787,402 | 3,533,627 | 12 |
| `metal_grate_rusty.ktx2` | [metal_grate_rusty](https://polyhaven.com/a/metal_grate_rusty) | Diffuse 2k jpg / 2048x2048 | `268e76299445b618ed6b46576d40fcdc` | 3,835,427 | 4,986,272 | 12 |
| `metal_plate.ktx2` | [metal_plate](https://polyhaven.com/a/metal_plate) | Diffuse 2k jpg / 2048x2048 | `91b841e7e619e55588f0183a703fb644` | 2,670,774 | 4,723,036 | 12 |
| `metal_plate_02.ktx2` | [metal_plate_02](https://polyhaven.com/a/metal_plate_02) | Diffuse 2k jpg / 2048x2048 | `519b43cf88b4b6ea74bd259e976f2170` | 2,604,239 | 4,414,972 | 12 |
| `painted_metal_shutter.ktx2` | [painted_metal_shutter](https://polyhaven.com/a/painted_metal_shutter) | Diffuse 2k jpg / 2048x2048 | `71f3093741ac82b1e4ab10fd25bc367d` | 2,474,114 | 4,175,988 | 12 |
| `rubber_tiles.ktx2` | [rubber_tiles](https://polyhaven.com/a/rubber_tiles) | Diffuse 2k jpg / 2048x2048 | `5bfab6657e8b95310d22cb40b81fe42e` | 1,685,204 | 3,093,493 | 12 |
| `rusty_corrugated_iron.ktx2` | [rusty_corrugated_iron](https://polyhaven.com/a/rusty_corrugated_iron) | Diffuse 2k jpg / 2048x2048 | `73a2ec580289d7bf27eb0e1c55fda0bc` | 2,552,964 | 4,595,391 | 12 |
| `rusty_metal_03.ktx2` | [rusty_metal_03](https://polyhaven.com/a/rusty_metal_03) | Diffuse 2k jpg / 2048x2048 | `e5ec75885884f9440a14eae579035c9f` | 2,860,689 | 4,866,747 | 12 |
| `worn_shutter.ktx2` | [worn_shutter](https://polyhaven.com/a/worn_shutter) | Diffuse 2k jpg / 2048x2048 | `d40fa6646c1661d2b03cefca21a4ad1c` | 2,111,247 | 4,193,415 | 12 |
| **total** | 16 assets | | | **34,388,104** | **67,329,856** | |

## Verification performed (2026-07-29)

- All 16 files pass **`ktx validate`** from KTX-Software **4.4.2**, exit code 0 —
  inside the script as each file is written, and again as a separate sweep over the
  finished directory. That validator is not a header check on a supercompressed file:
  it inflates the payload. Confirmed by copying `blue_metal_plate.ktx2` and flipping
  one byte 100,000 into level 0's zstd stream — `ktx validate` then reports
  `fatal-5005: Failed to load texture using libktx` and exits **3**.
- The script also applies an independent structural self-check that needs no tools:
  `vkFormat`/`supercompressionScheme`/DFD `colorModel` must match the `--format`
  asked for, DFD `transferFunction` must be 2, `texelBlockDimension` 4x4,
  `bytesPlane0` 16, `levelCount` the full chain, every level's
  `uncompressedByteLength` equal to its exact block count x 16, every level in
  bounds and non-empty, and `supercompressionGlobalData` empty. It cannot inflate
  zstd (Python 3.13 has no zstd in the stdlib), which is precisely why
  `ktx validate` is run as well and not treated as optional on this path.
- Header, DFD and key/value block hashed across all 16 files: **1 distinct
  signature**, so there is one contract and not sixteen.
- Mip chain colour space verified by decoding every level back out of the shipped
  containers (`ktx extract --level N --transcode rgba8`); figures above.
- Fidelity measured by round-trip PSNR/SSIM against the cached source JPEGs, for all
  16 maps, in both the direct-decode and the transcode-to-BC7 configuration; figures
  above.
- Runtime transcode exercised for all 16 (`ktx transcode --target bc7`): every one
  yields `VK_FORMAT_BC7_SRGB_BLOCK`, `supercompressionScheme 0`, `levelCount 12`.
- The `--format bc7` path was re-run after the refactor and produces **byte-identical
  output to the previous BC7 pack** — md5 match on `rubber_tiles` and `factory_wall`,
  the two maps tested — so the fallback is verified, not merely present.
- **Not verified: anything on a GPU.** No loader exists, nothing has been uploaded to
  Vulkan, no frame has been rendered from these files, and the in-engine transcode
  cost is unmeasured. The CLI timings above are a ceiling measured on the CLI.

## Tools

`tools/fetch_textures.py` needs an external encoder **to build a file** (not to
verify one, see above) and will **fail loudly** rather than write uncompressed pixels
and claim success. Which encoder depends on `--format`:

| `--format` | encoder | why not the other one |
|---|---|---|
| `uastc` (default), `etc1s` | KTX-Software `ktx` 4.4.2+ | Compressonator cannot write a supercompressed KTX2 |
| `bc7` | AMD Compressonator CLI 4.5.52 | `ktx create` cannot emit raw BC7 blocks — it does ASTC, ETC1S/BasisLZ and UASTC only |

`ktx` is also the validator for all three, so it is worth installing either way.
Put it on `PATH`, set `KTX_TOOL` / `COMPRESSONATOR`, or pass `--ktx <path>` /
`--compressonator <path>`.

- KTX-Software: <https://github.com/KhronosGroup/KTX-Software/releases>
- Compressonator: <https://github.com/GPUOpen-Tools/compressonator/releases>
