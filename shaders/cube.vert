#version 450
// Instanced box vertex stage.
//
// Binding 0 (per-vertex): the 8 corners of a unit cube via 36 indices baked as
// raw positions + face normals. Binding 1 (per-instance): the world-space
// origin, cell extent, and RGB colour of one voxel cluster. One draw call renders
// the whole visible world as N instances of the same cube, each STRETCHED to cover
// a merged run of cells (render/cube_merge.h).
layout(location = 0) in vec3 inPos;      // per-vertex, cube-local [0,1]
layout(location = 1) in vec3 inNormal;   // per-vertex face normal

layout(location = 2) in vec3 inOrigin;   // per-instance ABSOLUTE grid origin (min corner)
// Per-instance extent in CELLS along x/y/z; (1,1,1) is a single cell. .w unused.
// This is the four bytes that used to be a float `scale` written as the constant
// kCellSize by every instance the pass ever emitted.
layout(location = 3) in uvec4 inSpan;
layout(location = 4) in vec3 inColor;    // per-instance base colour
// Bits 0..26 = 3x3x3 occupancy mask (AO), bits 27..31 = material id. Two fields in
// one attribute because a uint32 has five bits more than the AO mask needs; see
// CubeInstance in render/cube_pass.h.
layout(location = 5) in uint inOcc;

layout(push_constant) uniform Push {
    mat4 viewProj;
    vec4 sunDir;   // xyz = direction toward the fill light, w = fill strength
    vec4 camPos;   // xyz = camera world position, w = headlamp intensity
    vec4 fog;      // x = fog start, y = fog end, z = lamp radius, w = ambient
    vec4 torus;    // x = wrap period (kWorldExtent)
} pc;

layout(location = 0) out vec3 vNormal;
layout(location = 1) out vec3 vColor;
// World position, not a precomputed distance: cube.frag needs the vector to the
// camera for the headlamp, and deriving the fog distance from it per-fragment is
// exact where an interpolated distance is not.
layout(location = 2) out vec3 vWorldPos;
// Baked ambient occlusion, 0 = fully enclosed corner, 1 = fully open. Computed
// per-vertex and interpolated, which is what makes it smooth across a face rather
// than flat per-cell. body.vert MUST declare this too (it writes 1.0) — cube.frag
// is shared and a missing varying is undefined, not an error.
layout(location = 3) out float vAo;
// Material id, selecting the surface family and its measured amplitude in
// cube.frag. `flat`: it is per-instance, so interpolating it would be meaningless
// and would also stop the const-array lookups from resolving cleanly.
//
// Same shared-varying contract as vAo — body.vert declares and writes this too.
layout(location = 4) flat out uint vMat;

// One macro cell in metres (world/types.h kCellSize). Hardcoded here for the same
// reason cube.frag hardcodes it to normalise its uv: every lane of the 128-byte
// push-constant block that could have carried it is either in use or reserved, and
// the two shaders that need it are the two that already agree on it. If this ever
// stops matching kCellSize, merged boxes get the wrong length and the world stops
// being watertight — a very visible failure, not a silent one.
const float kCellSize = 2.0;

// Nearest toroidal image of an absolute world position, relative to the camera.
//
// The world tiles space with period `p` on x/y/z, so a cell must be drawn not at
// its absolute grid origin but at the tile copy closest to the camera — that is
// what wraps the far side of the torus into view in front of the player instead
// of leaving the clear colour showing through a seam. Branchless: shift by
// however many whole periods brings the offset into [-p/2, p/2].
//
// This used to run on the CPU, per cell, per frame, inside the instance build.
// Doing it here is what lets CubePass cache its instance buffer at all — the
// instance data no longer depends on where the camera is.
// floor(x + 0.5) rather than round(x): GLSL leaves round()'s behaviour at an
// exact .5 tie implementation-defined, and this must match core/wrap.h
// wrap_delta_f() bit-for-bit on every driver.
vec3 nearest_image(vec3 absPos, vec3 cam, float p) {
    vec3 d = absPos - cam;
    return cam + d - p * floor(d / p + 0.5);
}

// Is the neighbour at integer offset `o` solid? Bit layout matches
// cube_pass.cpp occupancy_mask() exactly; the two must not drift.
float occluder(ivec3 o) {
    int b = (o.z + 1) * 9 + (o.y + 1) * 3 + (o.x + 1);
    return float((inOcc >> uint(b)) & 1u);
}

// Classic three-sample corner occlusion. For the corner of a face, the three cells
// that can occlude it are the two edge neighbours in the face plane and the one
// diagonally between them — all offset one step ALONG the normal, because a cell in
// this cell's own plane is beside the surface, not in front of it.
//
// Note which bits this can reach: n+u, n+v and n+u+v for orthogonal unit axes, i.e.
// only offsets with TWO or THREE non-zero components. The six single-axis face
// offsets are never sampled by anything, which is why cube_pass.cpp does not write
// them and why the merge is free to ignore them (kAoReadBits, render/cube_merge.h).
// A merged box has vertices only at its ends, so this is evaluated at the two ends
// of a run and interpolated between them; the merge only joins cells whose mask
// mirrors across the run axis, which makes that interpolation constant and therefore
// exactly equal to the per-cell value it replaces.
//
// The `both sides solid` case is special-cased to full darkness rather than falling
// out of the sum: when two walls meet, the diagonal behind them is not visible and
// its occupancy must not lighten the seam. Skipping that check is the classic bug
// that makes inside corners glow.
float corner_ao(ivec3 n, ivec3 u, ivec3 v) {
    float s1 = occluder(n + u);
    float s2 = occluder(n + v);
    if (s1 > 0.5 && s2 > 0.5) return 0.0;
    return (3.0 - (s1 + s2 + occluder(n + u + v))) / 3.0;
}

void main() {
    // Face basis. inNormal is axis-aligned and unit by construction (the mesh is a
    // unit cube), so rounding is exact rather than approximate.
    ivec3 n = ivec3(round(inNormal));
    ivec3 u = (abs(n.x) == 1) ? ivec3(0, 1, 0) : ivec3(1, 0, 0);
    ivec3 v = (abs(n.z) == 1) ? ivec3(0, 1, 0) : ivec3(0, 0, 1);
    // Which way this vertex sits along each tangent: inPos is a {0,1}^3 corner.
    int su = (dot(inPos, vec3(u)) > 0.5) ? 1 : -1;
    int sv = (dot(inPos, vec3(v)) > 0.5) ? 1 : -1;
    vAo = corner_ao(n, u * su, v * sv);

    // Toroidal placement is decided from the box's CENTRE, not its min corner.
    // A box gets ONE tile offset for all its vertices — anything else tears it in
    // half at the wrap — so the choice is which single image is least wrong, and the
    // centre halves the worst-case error a long box can accumulate against the
    // minimal-image radius compared with placing it by its origin. What is left is
    // bounded by kMaxRunCells and buried in full-black fog; cube_merge.h states the
    // bound and suite_greedy.inl measures it.
    // `halfExt`, not `half`: GLSL reserves `half` for a future scalar type and a
    // declaration using it is rejected outright.
    vec3 extent = vec3(inSpan.xyz) * kCellSize;
    vec3 halfExt = 0.5 * extent;
    vec3 centre = nearest_image(inOrigin + halfExt, pc.camPos.xyz, pc.torus.x);
    vec3 world = centre - halfExt + inPos * extent;
    gl_Position = pc.viewProj * vec4(world, 1.0);
    vNormal = inNormal;
    vColor = inColor;
    vWorldPos = world;
    vMat = inOcc >> 27u;   // cube_pass.cpp kMatIdShift
}
