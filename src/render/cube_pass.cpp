#include "render/cube_pass.h"

#include "render/vk_common.h"
#include "render/vk_device.h"

#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <string>

#include "render/material_table.h" // GENERATED: kMaterial + kMaterialMaps
#include "world/materials.h"

namespace giga::gpu {

namespace {

// kMaterial (mean albedo per id) is GENERATED — render/material_table.h,
// from data/materials.csv. Measured rows carry their provenance in
#ifndef GIGA_TEXTURE_DIR
#define GIGA_TEXTURE_DIR "data/textures"
#endif

static std::string resolve_texture_dir() {
    if (const char* env = std::getenv("GIGA_TEXTURE_DIR")) {
        if (*env != '\0' && std::filesystem::is_directory(env)) return env;
    }
    const std::filesystem::path candidates[] = {
        "data/textures",
        "../data/textures",
        "../../data/textures",
        "../../../data/textures"
    };
    for (const auto& p : candidates) {
        if (std::filesystem::is_directory(p)) {
            return p.string();
        }
    }
    return GIGA_TEXTURE_DIR;
}

} // namespace

const vec3* material_albedo_table(std::uint32_t* count) {
    *count = kMatCount;
    return kMaterial;
}

namespace {

// kMaterialMaps (id -> KTX2 set) is GENERATED — render/material_table.h,
// from data/materials.csv texture_id bindings against data/textures.csv.

// The pack's shape; load_layer() rejects a file whose dimensions or level count
// differ, naming it. Measured across all six committed files: 2048x2048,
// levelCount 12, 4x4 blocks, 16 bytes/block.
inline constexpr std::uint32_t kAlbedoDim = 2048;
inline constexpr std::uint32_t kAlbedoMips = 12;

std::string join(const std::string& a, const char* b) {
    if (a.empty()) return b;
    return a + "/" + b;
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
    const std::string dirStr = resolve_texture_dir();
    const char* dir = dirStr.c_str();

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
        // Every file name comes from the generated table (data/textures.csv);
        // an empty field means the asset set carries no such map.
        if (albedo_.load_layer(m.id, join(dir, m.albedo).c_str()))
            texMask_ |= 1u << m.id;
        if (m.normal[0] != '\0' &&
            normal_.load_layer(m.id, join(dir, m.normal).c_str()))
            normalMask_ |= 1u << m.id;
        if (m.roughness[0] != '\0' &&
            roughness_.load_layer(m.id, join(dir, m.roughness).c_str()))
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
