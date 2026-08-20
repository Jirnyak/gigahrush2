// Material state shared by every world-space pass — what remains of the cube
// mesher after the raymarch migration deleted it.
//
// The instanced-cube world draw, its greedy meshers (sub_mesh.h, cube_merge.h)
// and its 2×64 MiB instance buffers are GONE: the world is drawn by
// render/raymarch_pass.h over the GPU voxel mirror, and destruction costs the
// renderer 64 B per dirty cell instead of a 2.1 M-cell rebuild. This class now
// owns exactly two things the surviving passes share:
//
//   * the photographic material arrays (albedo/normal/roughness KTX2 packs)
//     and their descriptor set — sampled by the raymarcher (set 2) and, via
//     the borrowed pipeline layout, by the prop pass;
//   * the shared graphics pipeline layout built around CubePush — body, prop
//     and raymarch pipelines keep pushing the identical 128-byte block, which
//     is what keeps their shading contract (cube.frag for bodies) one thing.
#pragma once

#include <vulkan/vulkan.h>

#include <cstdint>

#include "core/math.h"
#include "render/vk_texture.h"

namespace giga::gpu {

struct VulkanDevice;

// Push-constant block shared by raymarch.frag / cube.frag / body.vert /
// prop.vert. All declare it identically; body_pass reuses cube.frag, so the
// block and the varying set are a contract across stages.
//
// 128 bytes — EXACTLY the maxPushConstantsSize the Vulkan spec guarantees, which
// is what real Windows drivers report. There is no headroom left: the next thing
// that needs to reach the shaders must go in a uniform buffer, not here. The
// lighting knobs deliberately ride in otherwise-dead w lanes for the same reason.
struct CubePush {
    mat4 viewProj;
    vec4 sunDir;    // xyz = direction toward the fill light, w = fill strength
    vec4 camPos;    // xyz = camera world position (toroidal placement, fog),
                    // w = МЁРТВАЯ ЛЕЙНА, пушится нулём
    vec4 fog;       // x = fog start dist, y = fog end dist (fades to black),
                    // z = МЁРТВАЯ ЛЕЙНА, пушится нулём, w = ambient scale
                    //
                    // Обе мёртвые лейны — бывшие интенсивность и радиус
                    // налобника, убитого 2026-08-20 ([CANON.md] S5). Они не
                    // удалены, потому что vec4 неделим, и не заняты, потому что
                    // занимать нечем; следующий, кому понадобится протолкнуть
                    // сюда параметр, вправе взять их — но обязан обновить ЭТОТ
                    // комментарий и все шейдеры, объявляющие блок.
    vec4 torus;     // x = wrap period (kWorldExtent), y = AO strength 0..1,
                    // z = OUTPUT ONLY: bitmask of material ids with a live
                    //     photographic albedo layer, as a float (16 bits, every
                    //     value exact in float32) — the recording pass
                    //     overwrites whatever the caller put there,
                    // w = uTime (seconds) / packed normal|roughness masks in
                    //     the textured modules (floatBitsToUint)
};
static_assert(sizeof(CubePush) == 128,
              "CubePush must not exceed the 128-byte guaranteed push-constant "
              "size; move new parameters to a uniform buffer instead");

class CubePass {
public:
    // Loads the material texture pack and builds the shared pipeline layout.
    // Never fails on missing/corrupt textures — the procedural surface is the
    // shipped fallback; fails only on real Vulkan errors.
    bool init(VulkanDevice& dev, VkDescriptorSetLayout lightGridSetLayout,
              VkDescriptorSetLayout shadowSetLayout = VK_NULL_HANDLE);
    void destroy();

    // The photographic albedo/normal/roughness arrays, for passes that shade
    // with the same model (raymarch set 2, prop pass via the layout). Layout is
    // 3 combined image samplers, bindings 0..2, fragment stage.
    VkDescriptorSetLayout texture_set_layout() const { return descriptorSetLayout_; }
    VkDescriptorSet texture_descriptor_set() const { return descriptorSet_; }
    bool textured() const { return textured_; }

    // Bit i set == material id i draws from a real photograph rather than the
    // procedural surface. 0 means the whole pack fell back.
    std::uint32_t textured_materials() const { return texMask_; }
    std::uint32_t normal_materials() const { return normalMask_; }
    std::uint32_t roughness_materials() const { return roughnessMask_; }

    // Borrowed by passes that share the same push-constant block (PropPass).
    VkPipelineLayout pipeline_layout() const { return layout_; }

private:
    bool create_layout();
    void load_material_textures();

    VulkanDevice* dev_ = nullptr;
    VkPipelineLayout layout_ = VK_NULL_HANDLE;

    VkDescriptorSetLayout descriptorSetLayout_ = VK_NULL_HANDLE;
    VkDescriptorSetLayout lightGridSetLayout_ = VK_NULL_HANDLE;
    VkDescriptorSetLayout shadowSetLayout_ = VK_NULL_HANDLE;
    VkDescriptorPool descriptorPool_ = VK_NULL_HANDLE;
    VkDescriptorSet descriptorSet_ = VK_NULL_HANDLE;

    VulkanTextureArray albedo_;
    VulkanTextureArray normal_;
    VulkanTextureArray roughness_;

    std::uint32_t texMask_ = 0;
    std::uint32_t normalMask_ = 0;
    std::uint32_t roughnessMask_ = 0;
    bool textured_ = false;
};

// The per-material display-referred albedo table (what the old instance colour
// carried for an untinted cell) — the raymarch pass feeds it into its material
// UBO. `*count` receives kMatCount.
const vec3* material_albedo_table(std::uint32_t* count);

} // namespace giga::gpu
