#version 450

layout(location = 0) out vec4 outColor;
layout(binding = 0) uniform sampler2D texColor;

layout(push_constant) uniform PostState {
    float darkAdapt;
    float stun;
    float hallucination;
    float crt;
} post;

const float kGamma = 2.2;
const float kScanDepth = 0.1;
const float kVigDepth = 0.25;
const float kVigPow = 2.0;
const vec3 kPhosphor = vec3(0.35, 0.95, 0.40); // #59F266
const float kPhosphorAlpha = 0.05;

void main() {
    vec2 uv = vec2((gl_FragCoord.x) / 1280.0, (gl_FragCoord.y) / 720.0); // Will adjust UV properly based on resolution later if needed, but gl_FragCoord is raw pixels
    
    // We can get uv safely from gl_FragCoord / textureSize(texColor, 0)
    ivec2 texSz = textureSize(texColor, 0);
    vec2 realUv = gl_FragCoord.xy / vec2(texSz);
    
    // Hallucination distortion
    vec2 sampleUv = realUv;
    if (post.hallucination > 0.0) {
        sampleUv.x += sin(realUv.y * 10.0) * 0.02 * post.hallucination;
        sampleUv.y += cos(realUv.x * 10.0) * 0.02 * post.hallucination;
    }

    // Stun blur (cheap 4-tap or simple color shift)
    vec3 colNoCrt;
    if (post.stun > 0.0) {
        float shift = 0.01 * post.stun;
        float r = texture(texColor, sampleUv + vec2(shift, 0.0)).r;
        float g = texture(texColor, sampleUv).g;
        float b = texture(texColor, sampleUv - vec2(shift, 0.0)).b;
        colNoCrt = vec3(r, g, b);
    } else {
        colNoCrt = texture(texColor, sampleUv).rgb;
    }

    // Exposure (Dark Adapt)
    colNoCrt *= post.darkAdapt;

    // Tonemap (ACES approximated)
    vec3 x = max(colNoCrt, vec3(0.0));
    vec3 mapped = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
    
    // sRGB encoding
    vec3 srgb = pow(mapped, vec3(1.0 / kGamma));
    colNoCrt = srgb;

    // CRT effect
    vec3 col = colNoCrt;
    float scan = 1.0 - kScanDepth * step(1.5, mod(gl_FragCoord.y, 3.0));
    float vig  = 1.0 - kVigDepth * pow(length(realUv - 0.5) * 2.0, kVigPow);
    col = col * scan * vig + kPhosphor * kPhosphorAlpha;
    
    col = mix(colNoCrt, col, post.crt);
    
    outColor = vec4(col, 1.0);
}
