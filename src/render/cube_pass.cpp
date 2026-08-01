#include "render/cube_pass.h"

#include "render/vk_common.h"
#include "render/vk_device.h"

#include <cstdio>
#include <cstdlib>
#include <string>

#include "world/materials.h"

namespace giga::gpu {

namespace {

// Albedo per material id ([world/materials.h]), in **display-referred** values —
// the shading (raymarch.frag / cube.frag) linearises once with pow(2.2) before
// lighting, so these are what you would pick in a colour picker, not linear.
//
// The industrial half is MEASURED, not chosen: each value is the mean albedo of a
// real 2 K photograph (Poly Haven, CC0), measured after linearising and converted
// back for this table. data/materials.csv carries the source URL, the linear mean
// and the luminance variance for every one, produced by tools/measure_materials.py.
// The residential half is authored, because the pack has no wallpaper, parquet,
// plaster or linoleum.
//
// Why bother measuring: hand-picked albedos drift bright and desaturated, which is
// exactly how "flat painted cubes" looks. Real rust is darker and far more
// saturated than anyone guesses.
constexpr vec3 kMaterial[kMatCount] = {
    /*  0 air, never drawn      */ {0.00f, 0.00f, 0.00f},
    /*  1 concrete (maze)       */ {0.30f, 0.30f, 0.28f}, // aged Soviet panel concrete
    /*  2 soil (maze)           */ {0.24f, 0.36f, 0.18f}, // dark earth / soil
    /*  3 water marker (maze)   */ {0.18f, 0.28f, 0.55f},
    /*  4 tan slab (maze)       */ {0.36f, 0.30f, 0.22f}, // muted Soviet floor slab
    /*  5 extraction pad        */ {0.10f, 0.85f, 0.42f}, // emerald bank
    /*  6 door leaf + frame     */ {0.16f, 0.24f, 0.42f}, // Soviet stairwell blue entrance door
    /*  7 nav / hub pad         */ {0.00f, 0.80f, 0.95f},
    // --- authentic Soviet Khrushchevka palette ---
    /*  8 plaster    authored   */ {0.48f, 0.44f, 0.38f}, // aged Soviet plaster / wallpaper
    /*  9 parquet    authored   */ {0.32f, 0.20f, 0.10f}, // rich Soviet varnished oak parquet
    /* 10 shop shutter  measured*/ {0.38f, 0.40f, 0.42f}, // painted metal shutter
    /* 11 lino          measured*/ {0.26f, 0.16f, 0.12f}, // Soviet maroon/brown linoleum
    /* 12 factory wall  measured*/ {0.22f, 0.30f, 0.22f}, // Soviet panel green
    /* 13 tread plate   measured*/ {0.38f, 0.24f, 0.15f}, // rusty metal tread
    /* 14 rust          measured*/ {0.40f, 0.20f, 0.08f}, // dark oxidized rust
    /* 15 rubble        measured*/ {0.22f, 0.18f, 0.14f}, // dark concrete rubble / soil
    /* 16 electric grate        */ {0.85f, 0.70f, 0.15f},
    /* 17 acid pool             */ {0.15f, 0.75f, 0.12f},
    /* 18 fire cell             */ {0.85f, 0.25f, 0.04f},
};
static_assert(sizeof(kMaterial) / sizeof(kMaterial[0]) == kMatCount,
              "one albedo row per material id in world/materials.h");

} // namespace

const vec3* material_albedo_table(std::uint32_t* count) {
    *count = kMatCount;
    return kMaterial;
}

namespace {

// Which photograph in data/textures is a material's real albedo. Six rows,
// because six is how many of the sixteen ids the pack covers. AUTHORITY for
// this binding is the MATERIALS table in tools/gen_material_surface.py, and
// data/textures/README.md restates it; ids 1..9 stay authored because the pack
// has no plaster, wood, lino or concrete photograph.
struct MaterialMap {
    CellType id;
    const char* file;
};
constexpr MaterialMap kMaterialMaps[] = {
    {kMatShopShutter, "painted_metal_shutter.ktx2"},
    {kMatLino, "rubber_tiles.ktx2"},
    {kMatFactoryWall, "factory_wall.ktx2"},
    {kMatTread, "metal_grate_rusty.ktx2"},
    {kMatRust, "rusty_metal_03.ktx2"},
    {kMatRubble, "rusty_corrugated_iron.ktx2"},
};
inline constexpr int kMaterialMapCount =
    static_cast<int>(sizeof(kMaterialMaps) / sizeof(kMaterialMaps[0]));
constexpr bool material_maps_in_range() {
    for (const MaterialMap& m : kMaterialMaps)
        if (m.id >= kMatCount) return false;
    return true;
}
static_assert(material_maps_in_range(),
              "every textured material id must be < kMatCount — the albedo array "
              "is indexed by the id directly, with no mapping table");

#ifndef GIGA_TEXTURE_DIR
#define GIGA_TEXTURE_DIR "data/textures"
#endif

// The pack's shape; load_layer() rejects a file whose dimensions or level count
// differ, naming it. Measured across all six committed files: 2048x2048,
// levelCount 12, 4x4 blocks, 16 bytes/block.
inline constexpr std::uint32_t kAlbedoDim = 2048;
constexpr std::uint32_t mip_count(std::uint32_t dim) {
    std::uint32_t n = 1;
    while (dim > 1) {
        dim >>= 1;
        ++n;
    }
    return n;
}
inline constexpr std::uint32_t kAlbedoMips = mip_count(kAlbedoDim);
static_assert(kAlbedoMips == 12,
              "the committed pack carries a full 12-level chain from 2048 to 1x1; "
              "a different count means the pack changed and every level offset in "
              "data/textures/README.md with it");

std::string join(const char* dir, const char* file) {
    std::string s = dir;
    if (!s.empty() && s.back() != '/') s += '/';
    s += file;
    return s;
}

} // namespace

bool CubePass::init(VulkanDevice& dev, VkDescriptorSetLayout lightGridSetLayout) {
    dev_ = &dev;
    lightGridSetLayout_ = lightGridSetLayout;
    load_material_textures();
    return create_layout();
}

// Load the pack, and say out loud what happened either way. This function
// CANNOT fail the pass: every failure leaves the procedural surface — the
// renderer this project shipped for its whole life — and one loud line.
void CubePass::load_material_textures() {
    const char* dir = std::getenv("GIGA_TEXTURE_DIR");
    if (dir == nullptr || *dir == '\0') dir = GIGA_TEXTURE_DIR;

    if (!albedo_.init(*dev_, kMatCount, kAlbedoDim, kAlbedoDim, kAlbedoMips, false)) {
        std::fprintf(stderr,
                     "[cube] albedo array could not be created — every material "
                     "renders with the procedural surface\n");
        albedo_.destroy();
        return;
    }
    if (!normal_.init(*dev_, kMatCount, kAlbedoDim, kAlbedoDim, kAlbedoMips, true)) {
        std::fprintf(stderr, "[cube] normal map array could not be created\n");
    }
    if (!roughness_.init(*dev_, kMatCount, kAlbedoDim, kAlbedoDim, kAlbedoMips, true)) {
        std::fprintf(stderr, "[cube] roughness map array could not be created\n");
    }

    for (const MaterialMap& m : kMaterialMaps) {
        const std::string path_albedo = join(dir, m.file);
        if (albedo_.load_layer(m.id, path_albedo.c_str()))
            texMask_ |= 1u << m.id;

        std::string stem = m.file;
        if (stem.size() >= 5 && stem.compare(stem.size() - 5, 5, ".ktx2") == 0)
            stem.erase(stem.size() - 5);

        const std::string path_normal = join(dir, (stem + "_normal.ktx2").c_str());
        if (normal_.load_layer(m.id, path_normal.c_str()))
            normalMask_ |= 1u << m.id;

        const std::string path_rough = join(dir, (stem + "_roughness.ktx2").c_str());
        if (roughness_.load_layer(m.id, path_rough.c_str()))
            roughnessMask_ |= 1u << m.id;
    }

    if (texMask_ == 0) {
        std::fprintf(stderr,
                     "[cube] ERROR: 0 of %d albedo maps loaded from '%s'. The "
                     "world renders with the procedural surface only.\n",
                     kMaterialMapCount, dir);
        albedo_.destroy();
        normal_.destroy();
        roughness_.destroy();
        return;
    }

    if (!albedo_.finish()) {
        std::fprintf(stderr, "[cube] ERROR: albedo array finish failed\n");
        albedo_.destroy();
        normal_.destroy();
        roughness_.destroy();
        texMask_ = 0;
        return;
    }
    normal_.finish();
    roughness_.finish();

    VkDescriptorSetLayoutBinding bindings[3]{};
    for (std::uint32_t i = 0; i < 3; ++i) {
        bindings[i].binding = i;
        bindings[i].descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
        bindings[i].descriptorCount = 1;
        bindings[i].stageFlags = VK_SHADER_STAGE_FRAGMENT_BIT;
    }

    VkDescriptorSetLayoutCreateInfo li{};
    li.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
    li.bindingCount = 3;
    li.pBindings = bindings;
    if (vkCreateDescriptorSetLayout(dev_->device, &li, nullptr, &descriptorSetLayout_) != VK_SUCCESS)
        return;

    VkDescriptorPoolSize ps{};
    ps.type = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
    ps.descriptorCount = 3;
    VkDescriptorPoolCreateInfo pi{};
    pi.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    pi.maxSets = 1;
    pi.poolSizeCount = 1;
    pi.pPoolSizes = &ps;
    if (vkCreateDescriptorPool(dev_->device, &pi, nullptr, &descriptorPool_) != VK_SUCCESS)
        return;

    VkDescriptorSetAllocateInfo ai{};
    ai.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
    ai.descriptorPool = descriptorPool_;
    ai.descriptorSetCount = 1;
    ai.pSetLayouts = &descriptorSetLayout_;
    if (vkAllocateDescriptorSets(dev_->device, &ai, &descriptorSet_) != VK_SUCCESS)
        return;

    VkDescriptorImageInfo imageInfos[3]{};
    imageInfos[0].sampler = albedo_.sampler();
    imageInfos[0].imageView = albedo_.view();
    imageInfos[0].imageLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
    imageInfos[1].sampler = normal_.sampler();
    imageInfos[1].imageView = normal_.view();
    imageInfos[1].imageLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
    imageInfos[2].sampler = roughness_.sampler();
    imageInfos[2].imageView = roughness_.view();
    imageInfos[2].imageLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

    VkWriteDescriptorSet writes[3]{};
    for (std::uint32_t b = 0; b < 3; ++b) {
        writes[b].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
        writes[b].dstSet = descriptorSet_;
        writes[b].dstBinding = b;
        writes[b].descriptorCount = 1;
        writes[b].descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
        writes[b].pImageInfo = &imageInfos[b];
    }
    vkUpdateDescriptorSets(dev_->device, 3, writes, 0, nullptr);

    textured_ = albedo_.ready();
    std::fprintf(stderr,
                 "[cube] albedo: %u/%d materials (mask 0x%04x), normal: %u/%d "
                 "(mask 0x%04x), roughness: %u/%d (mask 0x%04x)\n",
                 albedo_.layers_loaded(), kMaterialMapCount, texMask_,
                 normal_.layers_loaded(), kMaterialMapCount, normalMask_,
                 roughness_.layers_loaded(), kMaterialMapCount, roughnessMask_);
}

// The shared layout the prop pass borrows: (set0 textures-or-dummy,
// set1 light grid) + the 128-byte CubePush range — byte-identical to what the
// mesher-era pipeline used, so prop pipelines keep working unchanged.
bool CubePass::create_layout() {
    VkPushConstantRange pcr{};
    pcr.stageFlags = VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT;
    pcr.offset = 0;
    pcr.size = sizeof(CubePush);

    VkPipelineLayoutCreateInfo lci{};
    lci.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
    lci.pushConstantRangeCount = 1;
    lci.pPushConstantRanges = &pcr;

    VkDescriptorSetLayout dummySet0 = VK_NULL_HANDLE;
    if (!textured_ && lightGridSetLayout_ != VK_NULL_HANDLE) {
        VkDescriptorSetLayoutCreateInfo li{};
        li.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        vkCreateDescriptorSetLayout(dev_->device, &li, nullptr, &dummySet0);
    }

    VkDescriptorSetLayout setLayouts[2]{};
    std::uint32_t setCount = 0;
    if (textured_) {
        setLayouts[0] = descriptorSetLayout_;
        setCount = 1;
    } else if (dummySet0 != VK_NULL_HANDLE) {
        setLayouts[0] = dummySet0;
        setCount = 1;
    }
    if (lightGridSetLayout_ != VK_NULL_HANDLE) {
        setLayouts[1] = lightGridSetLayout_;
        setCount = 2;
    }
    lci.setLayoutCount = setCount;
    lci.pSetLayouts = (setCount > 0) ? setLayouts : nullptr;

    const bool ok =
        vkCreatePipelineLayout(dev_->device, &lci, nullptr, &layout_) == VK_SUCCESS;
    if (dummySet0 != VK_NULL_HANDLE)
        vkDestroyDescriptorSetLayout(dev_->device, dummySet0, nullptr);
    if (!ok) std::fprintf(stderr, "[vk] cube shared layout creation failed\n");
    return ok;
}

void CubePass::destroy() {
    if (!dev_) return;
    if (layout_) { vkDestroyPipelineLayout(dev_->device, layout_, nullptr); layout_ = VK_NULL_HANDLE; }
    if (descriptorPool_) { vkDestroyDescriptorPool(dev_->device, descriptorPool_, nullptr); descriptorPool_ = VK_NULL_HANDLE; }
    if (descriptorSetLayout_) { vkDestroyDescriptorSetLayout(dev_->device, descriptorSetLayout_, nullptr); descriptorSetLayout_ = VK_NULL_HANDLE; }
    descriptorSet_ = VK_NULL_HANDLE;
    albedo_.destroy();
    normal_.destroy();
    roughness_.destroy();
    texMask_ = normalMask_ = roughnessMask_ = 0;
    textured_ = false;
    dev_ = nullptr;
}

} // namespace giga::gpu
