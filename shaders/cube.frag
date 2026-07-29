#version 450
#extension GL_GOOGLE_include_directive : require
// Shading for both the world pass (cube.vert) and the population pass
// (body.vert) — see render.md. The model is built for a *windowless interior*:
// there is no sun down here, so the light the player actually sees is the light
// they carry.
//
//   headlamp  a camera-attached point light with 1/(1+d^2/r^2) falloff. This is
//             what makes depth readable: every metre of distance changes the
//             brightness of a surface, so a corridor gets a real light cone
//             instead of reading as a flat mosaic of rectangles.
//   fill      a weak directional term so geometry outside the lamp cone is a
//             dim shape rather than a black silhouette.
//   ambient   a low hemispheric term, up-facing faces slightly brighter and
//             cooler than down-facing ones.
//
// Lighting is done in LINEAR space and encoded to sRGB at the very end, because
// the swapchain is deliberately VK_FORMAT_B8G8R8A8_UNORM in
// VK_COLOR_SPACE_SRGB_NONLINEAR_KHR (vk_swapchain.cpp choose_format): a UNORM
// format performs no hardware encode, so the presentation engine displays
// whatever we write as if it were already sRGB-encoded. Encoding here is
// therefore exactly correct, and it leaves the ImGui pass — whose vertex colours
// are authored in sRGB — untouched.
layout(location = 0) in vec3 vNormal;
layout(location = 1) in vec3 vColor;
layout(location = 2) in vec3 vWorldPos;
// Baked corner occlusion from cube.vert; body.vert writes a constant 1.0.
layout(location = 3) in float vAo;
// Material id (world/materials.h) from cube.vert; body.vert writes a constant 0,
// whose family is the generic surface. BOTH vertex stages must declare and write
// this — see the note at body.vert's declaration for what happens if one does not.
layout(location = 4) flat in uint vMat;

// Per-material family + measured amplitude, GENERATED from data/materials.csv by
// tools/gen_material_surface.py. Provides kMatFamily[] and kMatSurface[].
#include "material_surface.glsl"

layout(push_constant) uniform Push {
    mat4 viewProj;
    vec4 sunDir;   // xyz = direction toward the fill light, w = fill strength
    vec4 camPos;   // xyz = camera world position, w = headlamp intensity
    vec4 fog;      // x = fog start, y = fog end, z = lamp radius, w = ambient
    vec4 torus;    // x = wrap period (kWorldExtent); unused here, declared so the
                   // block matches cube.vert exactly (shared pipeline layout)
} pc;

layout(location = 0) out vec4 outColor;

const float kGamma = 2.2;

// ---------------------------------------------------------------------------
// Photographic albedo — world pass only
// ---------------------------------------------------------------------------
// THIS FILE IS COMPILED TWICE, and the #ifdef is the reason rather than a second
// .frag. body_pass.cpp reuses cube.frag.spv with its own vertex stage and its own
// pipeline layout, and that layout declares push constants and NO descriptor
// sets. A sampler declared unconditionally here would be *statically used* by the
// body pipeline too, and a pipeline layout that omits a binding its shader uses is
// invalid — so the body pass would fail to create or run undefined. Two outputs
// from one source instead, which keeps the ~300 lines of surface and lighting code
// below single-sourced:
//
//   cube.frag.spv                          -> body_pass  (unchanged, byte-for-byte)
//   cube_tex.frag.spv  -DGIGA_ALBEDO_ARRAY -> cube_pass
//
// The second glslc command lives in CMakeLists.txt. If it is missing there is no
// cube_tex.frag.spv, and CubePass::init refuses to start rather than quietly
// rendering without textures.
#ifdef GIGA_ALBEDO_ARRAY
// 16 layers, layer index == material id (world/materials.h). Six carry a real
// Poly Haven photograph (data/textures); the other ten are allocated, never
// written and never sampled. pc.torus.z is the bitmask of which layers actually
// decoded, written by CubePass::record from what the loader reported — so a
// material whose file was missing or corrupt takes the procedural branch below
// rather than sampling undefined memory.
layout(set = 0, binding = 0) uniform sampler2DArray uAlbedo;

// Texture repeats per 2 m cell. 0.5 == one photograph per 4 m (two cells), and
// both halves of that choice are stated because NOBODY HAS SEEN A FRAME OF IT:
//   * commensurate with the grid — the repeat boundary always lands on a cell
//     boundary, where the geometry already has an AO crease, so the one place the
//     tiling could show is the one place the eye is already given an edge;
//   * 2048 texels over 4 m is 1.95 mm/texel at mip 0, far below anything the
//     headlamp resolves at any range, so the extra 2x costs no visible sharpness
//     and halves the repeat count along a long wall.
// A 40-cell corridor still shows the same 4 m photograph 20 times. That is the
// known weakness of this constant, and it is a judgement call, not a measurement.
const float kTexRepeat = 0.5;
#endif

// ---------------------------------------------------------------------------
// Procedural surface detail
// ---------------------------------------------------------------------------
// Generated, not sampled: there is no image decoder in the tree (deps are only
// EnTT/ImGui/SDL3/Vulkan) and no texture to sample even if there were. More to
// the point, a khrushchevka is up to 255 floors deep — a fixed atlas would give
// every one of them the same six surfaces, while a position-hashed generator
// gives every *apartment* its own. render.md:26 sanctions exactly this.
//
// Costs nothing but ALU on a GPU that performance.md declares unlimited, and
// touches no buffer, no descriptor, and no CPU work.

float hash21(vec2 p) {
    // Integer-lattice value hash. Deliberately not the sin-based one: that has
    // known precision artefacts on some drivers and shows as a diagonal moire.
    vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
}

// Value noise with smooth interpolation.
float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);           // smoothstep weights
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Frequencies are in CELLS (uv is normalised so 1 unit == one 2 m cell), and they
// are high on purpose. The first pass used 8 and 31, which is one cycle per 25 cm
// — at the range the headlamp actually lights, that reads as soft blotches rather
// than a material. 26 and 97 put the base grain at roughly one cycle per 7 cm and
// the detail octave near 2 cm, which is plaster and grit.
//
// Two octaves only: a third would sit below a pixel at any distance the headlamp
// still reaches, so it would buy nothing but fill rate and aliasing.
float grain(vec2 uv) {
    return vnoise(uv * 26.0) * 0.62 + vnoise(uv * 97.0) * 0.38;
}

// Distance to the nearest cell boundary along either axis, in cell units. This
// is what draws the precast panel seams that make the 2 m grid — and therefore
// the scale of the building — legible.
float seam(vec2 uv) {
    vec2 e = abs(fract(uv) - 0.5);
    float m = max(e.x, e.y);
    // 0 in the middle of a panel, 1 hard against a seam.
    return smoothstep(0.44, 0.5, m);
}

// ---------------------------------------------------------------------------
// Per-material surface families
// ---------------------------------------------------------------------------
// Before these existed, ONE generic two-octave noise plus one 2 m seam was applied
// to every surface in the game, brightness-only and identical for all 16 materials.
// So a rusted plate, dirty plaster and varnished parquet differed only in average
// colour and were otherwise the same surface — a mosaic of tinted boxes. Meanwhile
// data/materials.csv had carried a MEASURED per-material luminance dispersion since
// the harvest and nothing in the renderer read it.
//
// Two things are now per-material, and they are different in kind:
//
//   AMOUNT     is measured. kMatSurface[].x is the lognormal sigma that reproduces
//              the material's measured luminance coefficient of variation. Rusty
//              corrugated iron gets 0.42 and rubber tiles get 0.07 because the
//              photographs say so, not because it looked right.
//   STRUCTURE  is authored, because it has to be: the CSV measured the colour
//              statistics of a flat-lit photograph, which contains no information
//              about whether a surface is ribbed, planked or tiled. Family choice
//              and groove depth are declared in tools/gen_material_surface.py and
//              here, and labelled as authored where they are.
//
// Everything is still brightness-only, so every material keeps its cell-type hue and
// the faction/tier palette contract (monsters.md) is untouched — and multiplicative,
// so nothing here can lift a fogged pixel off black and expose the toroidal seam.
//
// Cost: the two-octave `grain` is computed ONCE, before the family branch, because
// most families use it as their fine layer and hoisting it keeps the expensive part
// out of the divergent region. Each family then adds at most two more vnoise calls.
// vMat is `flat`, so the branch is uniform across a primitive and only quads that
// straddle two materials evaluate two arms.

const uint kFamGeneric = 0u;   // the pre-existing surface: grain + 2 m panel seam
const uint kFamPlaster = 1u;   // fine mottle + broad staining + panel seam
const uint kFamPlank   = 2u;   // directional boards, staggered butt joints
const uint kFamTile    = 3u;   // square grid, recessed grout, per-tile shade
const uint kFamRibbed  = 4u;   // corrugation / shutter slats
const uint kFamTread   = 5u;   // raised lozenges on a staggered lattice
const uint kFamRust     = 6u;  // large irregular patches with pitting inside
const uint kFamRubble  = 7u;   // warped chunk plateaus with dark cracks
const uint kFamSmooth  = 8u;   // near-flat painted plate, no seams

// Reciprocal standard deviation of each primitive, so a weighted sum of them can be
// given unit variance and `sigma` can mean the measured dispersion rather than an
// arbitrary knob. These are MEASURED over 2 M samples of a float32 replica of these
// exact functions, not derived: value noise with smoothstep weights has std 0.2143,
// not the 0.2887 of the uniform lattice values it interpolates, and guessing that
// would have put every amplitude 35% low.
const float kNormGrain = 6.413;   // grain(), the 0.62/0.38 two-octave mix
const float kNormNoise = 4.665;   // one vnoise octave
const float kNormHash  = 3.465;   // hash21(), uniform on [0,1]
const float kNormMask  = 2.293;   // the rust patch mask, after its smoothstep
const float kMeanMask  = 0.4497;  // ...and its mean, which is not 0.5
const float kNormRib   = 1.4145;  // cos()
const float kNormStud  = 2.518;   // tread lozenge coverage
const float kMeanStud  = 0.2331;  // ...and its mean
const float kNormShade = 2.448;   // the cross-lozenge gradient

// Multiplicative albedo modulation reproducing a measured luminance dispersion.
//
// For zero-mean unit-variance `n`, exp(sigma*n - sigma^2/2) is lognormal with mean
// exactly 1 and coefficient of variation exactly sqrt(exp(sigma^2) - 1) — which is
// the CV the generator solved sigma for. Mean 1 is the load-bearing half: it leaves
// the measured mean albedo in cube_pass.cpp kMaterial untouched, so adding surface
// character does not quietly re-tint the world brighter.
//
// Strictly positive by construction, which matters beyond neatness. Nothing this
// returns can lift a fogged pixel off zero, so the wrap seam stays buried in black
// no matter what the noise does — and it needs no clamp, where a naive
// 1 + sigma*n would go NEGATIVE at the rust end.
// How close the result actually lands, MEASURED over 1.5 M samples of a float32
// replica of every family below (target = the CV in material_surface.glsl):
//
//   plaster 0.1300 -> 0.1291    shutter 0.1519 -> 0.1513    rust   0.4411 -> 0.3831
//   parquet 0.1100 -> 0.1100    factory 0.2231 -> 0.2206    rubble 0.4437 -> 0.4264
//   lino    0.0724 -> 0.0723    tread   0.1940 -> 0.2075    pads   0.0300 -> 0.0300
//
// Every family's `n` is normalised to unit variance, verified. The residuals are a
// DISTRIBUTION-SHAPE effect and are recorded rather than corrected: the CV identity
// above holds exactly for Gaussian n, and the tread lattice and the rust patch mask
// are strongly bimodal, so exp() weights their tails differently. Chasing the last
// 10% with a per-family fudge factor would be false precision on a statistic that
// came from a 256x256 resample of one photograph. Mean stays within 0.999..1.001 for
// all nine, which is the part that had to be exact.
float mottle(float sigma, float n) {
    return exp(sigma * n - 0.5 * sigma * sigma);
}

// Fade a periodic pattern out as its period approaches a pixel. Regular structure
// aliases far more visibly than noise does — a 28-cycle corrugation becomes a moire
// fan at 20 m, where the noise octaves merely go grey. `px` is cell units per pixel
// from fwidth(); this costs one multiply-add and a clamp, and no texture LOD machinery.
float resolved(float px, float freq) {
    return clamp(1.0 - px * freq * 2.2, 0.0, 1.0);
}

// The brightness multiplier for one material's surface. `g` is the shared two-octave
// grain, `px` the screen-space rate of change of uv, `aw` the absolute face normal.
float surface(uint mat, vec2 uv, vec3 aw, float px, float g) {
    uint id = min(mat, kMatSurfaceCount - 1u);
    uint fam = kMatFamily[id];
    float sigma = kMatSurface[id].x;
    float pitch = kMatSurface[id].y;   // cycles per 2 m cell

    if (fam == kFamGeneric) {
        // The pre-existing surface, arithmetic unchanged: floors get busier detail
        // than walls (scuffs, grit), walls read as paint over panel joins. Kept
        // literal rather than re-expressed through mottle() so the maze test bed and
        // the crowd — body.vert writes material 0, which lands here — render exactly
        // as they did before the families existed.
        float amount = aw.z > 0.5 ? 0.26 : 0.17;
        return ((1.0 - amount * 0.5) + amount * g) * (1.0 - 0.28 * seam(uv));
    }

    if (fam == kFamSmooth) {
        // A painted marker plate: mottle only, no seam. A gameplay pad has to read as
        // signage rather than as a surface (materials.h: the bank must be
        // unmistakable), so nothing is allowed to break it into panels.
        return mottle(sigma, (g - 0.5) * kNormGrain);
    }

    if (fam == kFamPlaster) {
        // Fine even mottle plus broad damp/dirt staining, over the precast panel
        // join. Weights 0.78/0.62 sum to 1 in quadrature, so splitting the measured
        // amplitude across two scales does not exceed it. The broad layer is what
        // gives one apartment a different wall from the next instead of 255 floors
        // of the same whitewash.
        float stain = vnoise(uv * pitch);
        float n = (g - 0.5) * kNormGrain * 0.78
                + (stain - 0.5) * kNormNoise * 0.62;
        return mottle(sigma, n) * (1.0 - 0.30 * seam(uv));
    }

    if (fam == kFamPlank) {
        // Boards run along uv.x, `pitch` of them across uv.y, with butt joints every
        // 40 cm STAGGERED per row by a hashed offset. The stagger is the whole trick:
        // unstaggered joints line up and the floor reads as a tile grid, not boards.
        float row = floor(uv.y * pitch);
        float along = uv.x * 5.0 + hash21(vec2(row, 7.0)) * 3.0;
        float tone = hash21(vec2(floor(along), row)) - 0.5;
        // Figure stretched 4:1 along the board, which is what says wood rather than
        // painted stripes.
        float streak = vnoise(vec2(uv.x * 40.0, uv.y * pitch * 8.0)) - 0.5;
        float n = tone * kNormHash * 0.85 + streak * kNormNoise * 0.53;
        float jAcross = smoothstep(0.42, 0.5, abs(fract(uv.y * pitch) - 0.5))
                      * resolved(px, pitch);
        float jAlong = smoothstep(0.46, 0.5, abs(fract(along) - 0.5))
                     * resolved(px, 5.0);
        return mottle(sigma, n) * (1.0 - 0.34 * jAcross - 0.20 * jAlong);
    }

    if (fam == kFamTile) {
        // Grid, recessed grout, and a per-tile shade jitter — for rubber floor tiles
        // the measured mottle is almost nil (CV 0.072, the flattest material in the
        // pack), so the grout is what makes it nameable and the tile-to-tile tone is
        // what stops the grid looking printed.
        vec2 q = uv * pitch;
        float tone = hash21(floor(q)) - 0.5;
        vec2 e = abs(fract(q) - 0.5);
        float grout = smoothstep(0.42, 0.5, max(e.x, e.y)) * resolved(px, pitch);
        float n = tone * kNormHash * 0.88 + (g - 0.5) * kNormGrain * 0.47;
        return mottle(sigma, n) * (1.0 - 0.30 * grout);
    }

    if (fam == kFamRibbed) {
        // Corrugation varying along uv.x. The uv basis drops the face-normal axis, so
        // on a ±X or ±Y wall uv.y IS world z — meaning the ribs stand VERTICALLY, the
        // way shutter slats and cladding do, with the shader needing to know nothing
        // about which wall it is on.
        float d = resolved(px, pitch);
        float rib = cos(uv.x * pitch * 6.2831853);
        float n = rib * kNormRib * 0.90 * d + (g - 0.5) * kNormGrain * 0.44;
        // Deepen the valleys past what a symmetric cosine gives: a rolled sheet has a
        // tight trough and a broad crest.
        float trough = smoothstep(-0.2, -0.95, rib) * d;
        return mottle(sigma, n) * (1.0 - 0.16 * trough);
    }

    if (fam == kFamTread) {
        // Raised lozenges on a row-staggered lattice. The gradient across each
        // lozenge fakes the round-over that makes chequer plate read as raised rather
        // than as diamonds painted on a flat sheet.
        float d = resolved(px, pitch);
        vec2 q = uv * pitch;
        q.x += 0.5 * floor(q.y);
        vec2 f = fract(q) - 0.5;
        float stud = 1.0 - smoothstep(0.28, 0.40, abs(f.x) + abs(f.y));
        // Weights are 0.83/0.57/0.55 and NOT a quadrature-1 triple: the coverage and
        // the gradient come off the same lattice, so they are correlated and their
        // variances do not add. The first version used quadrature weights and
        // measured 0.872 std instead of 1.0, which put this material 8% under its
        // measured amplitude. Scaled by 1/0.872 to land on it.
        float n = (stud - kMeanStud) * kNormStud * 0.826 * d
                + (f.x + f.y) * stud * kNormShade * 0.574 * d
                + (g - 0.5) * kNormGrain * 0.550;
        return mottle(sigma, n) * (1.0 - 0.28 * (1.0 - stud) * d);
    }

    if (fam == kFamRust) {
        // Patches, not octaves — and this is the one place the family choice answers
        // a recorded objection rather than just picking a look. render.md rejected
        // harvesting rust textures partly because real corrosion has long-range
        // spatial correlation that FBM reproduces badly. An FBM sum has no edges; a
        // low-frequency blob field pushed through a narrow smoothstep does, and edges
        // are what makes a patch a patch.
        //
        // No seam: a corroded steel plate is not a precast concrete panel, and that
        // absence is half of what distinguishes a Derelict wall from a Residential one.
        float lo = vnoise(uv * pitch);
        float hi = vnoise(uv * pitch * 2.85);
        float mask = smoothstep(0.42, 0.62, lo * 0.65 + hi * 0.35);
        // Corroded patches are darker, and pitted harder inside than outside.
        float n = -(mask - kMeanMask) * kNormMask * 0.92
                + (g - 0.5) * kNormGrain * 0.55 * (0.45 + 0.85 * mask);
        return mottle(sigma, n);
    }

    if (fam == kFamRubble) {
        // Chunk plateaus with dark cracks between them. The lattice is WARPED by a
        // low-frequency noise before being quantised, and that is the whole
        // difference between debris and floor tiles: an unwarped lattice reads as a
        // grid however you shade it.
        //
        // Rubble and rust have all but identical measured amplitude (CV 0.4437 vs
        // 0.4411), so amplitude cannot tell the two Derelict surfaces apart — the
        // structure has to, which is the argument for families over a single dial.
        float warp = vnoise(uv * 2.3);
        vec2 q = uv * pitch + warp * 2.5;
        float chunk = hash21(floor(q)) - 0.5;
        vec2 e = abs(fract(q) - 0.5);
        float crack = smoothstep(0.36, 0.5, max(e.x, e.y)) * resolved(px, pitch);
        float n = chunk * kNormHash * 0.90 + (g - 0.5) * kNormGrain * 0.44;
        return mottle(sigma, n) * (1.0 - 0.32 * crack);
    }

    // Unreachable: cube_pass.cpp maps every unknown id to 0 and the generator emits a
    // family for every id. Here so the function has a defined value on every path.
    return 1.0;
}

void main() {
    vec3 n = normalize(vNormal);

    // Triplanar-by-dominant-axis UV: the cube faces are axis-aligned, so the two
    // world coordinates that are NOT the face normal are already a correct,
    // seamless, non-stretching parameterisation. No UV attribute needed, and it
    // stays continuous across neighbouring cells because it is world-space.
    //
    // WORLD-space is load-bearing, not incidental, and this is the line that makes
    // run merging possible at all. The world pass emits one stretched box per merged
    // run of cells (render/cube_merge.h), so a single primitive can be twenty cells
    // long. Because uv is derived from vWorldPos it sweeps twenty cells' worth of
    // pattern and the parquet planks and tread-plate lozenges keep their real pitch;
    // re-express this in the cube-local [0,1] corner — the obvious "optimisation",
    // since inPos is right there in the vertex stage — and every merged box smears
    // its texture along the run. There is no per-instance scale left to correct for
    // it with: those four bytes are now the span.
    vec3 aw = abs(n);
    vec2 uv = aw.z > 0.5 ? vWorldPos.xy
            : (aw.x > 0.5 ? vWorldPos.yz : vWorldPos.xz);
    uv /= 2.0;                              // kCellSize: one unit == one cell

    // Per-material surface. Brightness-only, so a surface keeps its cell-type hue and
    // the faction/tier palette contract is untouched; multiplicative and strictly
    // positive, so it cannot lift a fogged pixel off black.
    //
    // The shared two-octave grain is computed here rather than inside surface() so
    // the expensive part stays out of the divergent branch — most families use it as
    // their fine layer. `px` is how much uv moves per pixel, which is what lets the
    // periodic families fade themselves out before they alias.
    //
    // BOTH are computed before the textured/procedural branch below, deliberately:
    // fwidth() in divergent control flow has undefined results, and hoisting it is
    // free where reasoning about quad uniformity is not. `g` is wasted on a textured
    // pixel; deleting the whole procedural layer was MEASURED at +0.05 ms on this
    // pass (see cube_pass.h), i.e. inside the noise, so that waste is not worth a
    // second branch.
    float g = grain(uv);
    float px = max(fwidth(uv.x), fwidth(uv.y));

#ifdef GIGA_ALBEDO_ARRAY
    // THE SAMPLED ALBEDO REPLACES BOTH the per-material constant colour and the
    // procedural surface, for the six materials that have a photograph. It does not
    // modulate them, and that is arithmetic rather than taste:
    //
    //   * the constant in cube_pass.cpp kMaterial[10..15] IS the measured mean
    //     albedo of this very photograph, so texture * constant would darken every
    //     bound material by its own mean — the shutter's 0.50 grey would land at
    //     0.25;
    //   * kMatSurface[id].x is the lognormal sigma solved from the measured
    //     luminance CV of that same photograph (data/materials.csv lum_std, via
    //     tools/gen_material_surface.py). Multiplying two unit-mean factors that
    //     each reproduce CV c gives CV sqrt((1+c*c)^2 - 1): rust 0.4411 -> 0.657,
    //     tread 0.1940 -> 0.277, lino 0.0724 -> 0.1025. Keeping both would
    //     over-contrast every bound material by exactly the amount the generator
    //     was calibrated to produce ONCE.
    //   * the families exist because there was no image (see the header comment
    //     above `hash21`). Where the image exists it also carries the STRUCTURE the
    //     generator had to author blind — real corrugation, real grate, real
    //     corrosion edges — which was the weakest part of the procedural pass.
    //
    // NO pow() ON THE SAMPLE. The array is a *_SRGB format, so the sampler has
    // already linearised each texel in hardware, before filtering. Applying
    // kGamma here as well would darken mid-grey by roughly 2x — the classic failure
    // this whole path is documented against in data/textures/README.md.
    //
    // vColor MEANS SOMETHING DIFFERENT ON THIS BRANCH, and cube_pass.cpp writes it
    // to match: a LINEAR multiplier, exactly (1,1,1) unless the cell is fluid-
    // tinted, in which case it is the linear ratio tinted/base. That is what keeps
    // a flooded floor blue without the shader needing a per-material mean albedo it
    // has no way to know.
    uint mid = min(vMat, kMatSurfaceCount - 1u);
    vec3 albedo;
    if ((uint(pc.torus.z) & (1u << mid)) != 0u) {
        albedo = texture(uAlbedo, vec3(uv * kTexRepeat, float(mid))).rgb * vColor;
    } else {
        albedo = pow(vColor, vec3(kGamma));
        albedo *= surface(vMat, uv, aw, px, g);
    }
#else
    // Instance colours are authored as display-referred values; linearise once
    // so the lighting arithmetic below is physically sane.
    vec3 albedo = pow(vColor, vec3(kGamma));
    albedo *= surface(vMat, uv, aw, px, g);
#endif

    // Distance is computed per-fragment, not interpolated from the vertex stage.
    // Interpolating a nonlinear function across a 2 m face that fills the screen
    // up close visibly skews the fog gradient; and the headlamp needs the vector
    // anyway, so this is free.
    vec3 toCam = pc.camPos.xyz - vWorldPos;
    float d = length(toCam);
    vec3 L = toCam / max(d, 1e-4);

    float r = pc.fog.z;
    float att = 1.0 / (1.0 + (d * d) / (r * r));
    float lamp = pc.camPos.w * att * max(dot(n, L), 0.0);

    float fill = pc.sunDir.w * max(dot(n, normalize(pc.sunDir.xyz)), 0.0);

    // World +Z as "up" is a render-local aesthetic choice, not a claim about
    // gravity — gravity is a vector and lives in the sim (world.gravity()).
    // Deleting this term changes pixels, never outcomes.
    float hemi = 0.5 + 0.5 * n.z;
    vec3 amb = pc.fog.w * mix(vec3(0.10, 0.11, 0.14), vec3(0.24, 0.23, 0.21), hemi);

    // Ambient occlusion.
    //
    // **It must attenuate the headlamp, not only the ambient, and that is measured
    // rather than stylistic.** Ambient here is pc.fog.w (0.35) times the hemi mix,
    // so 0.035..0.084 of albedo, while the headlamp lands at 0.44..2.2 — occluding
    // only the ambient term would modulate about 8% of the image and be invisible
    // in a scene this lamp-dominated. Occluding a *direct* light by AO is not
    // physical, which is why the direct share rides on a dial (pc.torus.y) instead
    // of being hardcoded to 1.
    //
    // The floor stops an enclosed corner from reaching pure black: vAo is one of
    // {0, 1/3, 2/3, 1}, and a raw 0 would punch holes that read as missing
    // geometry rather than as shadow.
    const float kAoFloor = 0.32;
    float ao = kAoFloor + (1.0 - kAoFloor) * vAo;
    float aoDirect = mix(1.0, ao, pc.torus.y);
    vec3 lit = albedo * (amb * ao + vec3(lamp + fill) * aoDirect);

    // Distance fog to black, in LINEAR space and BEFORE the encode. Everything
    // past fog.y is fully black, which is exactly the toroidal minimal-image
    // radius (kWorldExtent/2), so the seam where the far side of the world wraps
    // into view is never visible: it is already swallowed by fog.
    //
    // Do not reorder this after the encode, and do not add a lift/offset to the
    // tonemap: the encode must satisfy f(0) == 0 or black stops being black and
    // the wrap seam appears. That is the worst failure mode in this renderer.
    float fog = clamp((d - pc.fog.x) / max(pc.fog.y - pc.fog.x, 1e-3), 0.0, 1.0);
    lit = mix(lit, vec3(0.0), fog);

    vec3 srgb = pow(max(lit, vec3(0.0)), vec3(1.0 / kGamma));

    // A long mid-grey-to-black ramp over ~51 m into an 8-bit target bands badly,
    // and the fade to black *is* the aesthetic here. One LSB of interleaved
    // gradient noise removes it. Scaled by (1 - fog) so a fully-fogged pixel
    // stays bit-exact 0 and matches the cleared background precisely.
    float ign = fract(52.9829189
                      * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    srgb += (ign - 0.5) / 255.0 * (1.0 - fog);

    outColor = vec4(srgb, 1.0);
}
