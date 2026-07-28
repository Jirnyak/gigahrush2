#version 450
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

void main() {
    // Instance colours are authored as display-referred values; linearise once
    // so the lighting arithmetic below is physically sane.
    vec3 albedo = pow(vColor, vec3(kGamma));

    vec3 n = normalize(vNormal);

    // Triplanar-by-dominant-axis UV: the cube faces are axis-aligned, so the two
    // world coordinates that are NOT the face normal are already a correct,
    // seamless, non-stretching parameterisation. No UV attribute needed, and it
    // stays continuous across neighbouring cells because it is world-space.
    vec3 aw = abs(n);
    vec2 uv = aw.z > 0.5 ? vWorldPos.xy
            : (aw.x > 0.5 ? vWorldPos.yz : vWorldPos.xz);
    uv /= 2.0;                              // kCellSize: one unit == one cell

    // Grain modulates brightness only, so a surface keeps its cell-type hue and
    // the faction/tier palette contract is untouched.
    float g = grain(uv);
    float s = seam(uv);
    // Floors get finer, busier detail than walls (scuffs, grit); walls read as
    // painted plaster over panel joins.
    float amount = aw.z > 0.5 ? 0.26 : 0.17;
    albedo *= (1.0 - amount * 0.5) + amount * g;
    // Seams are recessed grout, not painted lines: darken and let the lighting
    // below do the rest.
    albedo *= 1.0 - 0.28 * s;

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
