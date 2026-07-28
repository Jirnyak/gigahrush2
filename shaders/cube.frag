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

layout(push_constant) uniform Push {
    mat4 viewProj;
    vec4 sunDir;   // xyz = direction toward the fill light, w = fill strength
    vec4 camPos;   // xyz = camera world position, w = headlamp intensity
    vec4 fog;      // x = fog start, y = fog end, z = lamp radius, w = ambient
} pc;

layout(location = 0) out vec4 outColor;

const float kGamma = 2.2;

void main() {
    // Instance colours are authored as display-referred values; linearise once
    // so the lighting arithmetic below is physically sane.
    vec3 albedo = pow(vColor, vec3(kGamma));

    vec3 n = normalize(vNormal);

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

    vec3 lit = albedo * (amb + vec3(lamp + fill));

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
