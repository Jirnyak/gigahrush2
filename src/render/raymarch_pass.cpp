#include "render/raymarch_pass.h"

#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "render/cube_pass.h" // CubePush, material_albedo_table, texture getters
#include "render/vk_common.h"
#include "render/vk_device.h"
#include "render/voxel_mirror.h"

namespace giga::gpu {

namespace {

// Matches MarchUbo in shaders/raymarch.frag (std140: mat4 + vec4[32] + vec4 = 592 B).
struct MarchUbo {
    mat4 invViewProj;
    vec4 albedo[64]; // 38 материалов с рыхлыми двойниками; 32 обрезало их цвет
    vec4 timeParams; // x = timeSec, y = samosborPulse
    // Маски карт материалов ПАРАМИ u32 (lo,hi) = честные 64 бита (К1-2,
    // аудит 2026-08-25): прежний путь «float(torus.z)» с id двойников за
    // 24 бита мантиссы корёжил округлением ВСЮ маску альбедо, а упаковка
    // 16+16 в torus.w молча отрезала карты материалов с id >= 16.
    std::uint32_t texMaskAN[4]; // albedo lo,hi; normal lo,hi
    std::uint32_t texMaskR[4];  // roughness lo,hi; z,w резерв
};
// mat4 64 Б + 64 vec4 альбедо 1024 Б + timeParams 16 Б + 2 uvec4 масок
// 32 Б = 1136 Б (std140: uvec4 выравнены по 16).
static_assert(sizeof(MarchUbo) == 1136, "MarchUbo must match the shader block");

namespace {
void write_tex_masks(MarchUbo* u, std::uint64_t a, std::uint64_t n,
                     std::uint64_t r) {
    u->texMaskAN[0] = static_cast<std::uint32_t>(a);
    u->texMaskAN[1] = static_cast<std::uint32_t>(a >> 32);
    u->texMaskAN[2] = static_cast<std::uint32_t>(n);
    u->texMaskAN[3] = static_cast<std::uint32_t>(n >> 32);
    u->texMaskR[0] = static_cast<std::uint32_t>(r);
    u->texMaskR[1] = static_cast<std::uint32_t>(r >> 32);
    u->texMaskR[2] = 0u;
    u->texMaskR[3] = 0u;
}
} // namespace

// General 4x4 inverse (cofactor expansion). Runs once per frame on the CPU so
// ray generation matches the raster projection bit-for-bit; render-local, so
// core/math.h stays minimal.
mat4 mat4_inverse(const mat4& m) {
    const float* a = m.m;
    float inv[16];

    inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] -
             a[9] * a[6] * a[15] + a[9] * a[7] * a[14] +
             a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
    inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] +
             a[8] * a[6] * a[15] - a[8] * a[7] * a[14] -
             a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
    inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] -
             a[8] * a[5] * a[15] + a[8] * a[7] * a[13] +
             a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
    inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] +
              a[8] * a[5] * a[14] - a[8] * a[6] * a[13] -
              a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
    inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] +
             a[9] * a[2] * a[15] - a[9] * a[3] * a[14] -
             a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
    inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] -
             a[8] * a[2] * a[15] + a[8] * a[3] * a[14] +
             a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
    inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] +
             a[8] * a[1] * a[15] - a[8] * a[3] * a[13] -
             a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
    inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] -
              a[8] * a[1] * a[14] + a[8] * a[2] * a[13] +
              a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
    inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] -
             a[5] * a[2] * a[15] + a[5] * a[3] * a[14] +
             a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
    inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] +
             a[4] * a[2] * a[15] - a[4] * a[3] * a[14] -
             a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
    inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] -
              a[4] * a[1] * a[15] + a[4] * a[3] * a[13] +
              a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
    inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] +
              a[4] * a[1] * a[14] - a[4] * a[2] * a[13] -
              a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
    inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] +
             a[5] * a[2] * a[11] - a[5] * a[3] * a[10] -
             a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
    inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] -
             a[4] * a[2] * a[11] + a[4] * a[3] * a[10] +
             a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
    inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] +
              a[4] * a[1] * a[11] - a[4] * a[3] * a[9] -
              a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
    inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] -
              a[4] * a[1] * a[10] + a[4] * a[2] * a[9] +
              a[8] * a[1] * a[6] - a[8] * a[2] * a[5];

    float det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
    mat4 r{};
    if (det == 0.0f) return mat4_identity(); // degenerate: never with a live camera
    det = 1.0f / det;
    for (int i = 0; i < 16; ++i) r.m[i] = inv[i] * det;
    return r;
}

std::string join(const char* dir, const char* file) {
    std::string s = dir;
    if (!s.empty() && s.back() != '/') s += '/';
    s += file;
    return s;
}

bool read_spv(const std::string& path, std::vector<char>& out) {
    std::FILE* f = std::fopen(path.c_str(), "rb");
    if (!f) {
        std::fprintf(stderr, "[raymarch] cannot open %s\n", path.c_str());
        return false;
    }
    std::fseek(f, 0, SEEK_END);
    long n = std::ftell(f);
    std::fseek(f, 0, SEEK_SET);
    out.resize(static_cast<std::size_t>(n));
    const bool ok = std::fread(out.data(), 1, out.size(), f) == out.size();
    std::fclose(f);
    return ok;
}

bool make_module(VkDevice dev, const std::vector<char>& code, VkShaderModule* out) {
    VkShaderModuleCreateInfo ci{};
    ci.sType = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO;
    ci.codeSize = code.size();
    ci.pCode = reinterpret_cast<const std::uint32_t*>(code.data());
    return vkCreateShaderModule(dev, &ci, nullptr, out) == VK_SUCCESS;
}

} // namespace

bool RaymarchPass::init(VulkanDevice& dev, VkRenderPass renderPass,
                        const char* shaderDir, const VoxelMirror& mirror,
                        const CubePass& cubePass,
                        VkDescriptorSetLayout lightGridSetLayout) {
    dev_ = &dev;
    lightGridSetLayout_ = lightGridSetLayout;
    texSetLayout_ = cubePass.texture_set_layout();
    texSet_ = cubePass.texture_descriptor_set();
    textured_ = cubePass.textured() && texSetLayout_ != VK_NULL_HANDLE &&
                texSet_ != VK_NULL_HANDLE;
    texMask_ = cubePass.textured_materials();
    normalMask_ = cubePass.normal_materials();
    roughnessMask_ = cubePass.roughness_materials();

    if (!create_descriptors(mirror)) return false;
    if (!create_half_pass()) return false;
    if (!create_pipeline(renderPass, shaderDir)) return false;
    std::fprintf(stderr, "[raymarch] world pass up (%s)\n",
                 textured_ ? "textured" : "procedural-only");
    return true;
}

bool RaymarchPass::create_descriptors(const VoxelMirror& mirror) {
    // Биндинг 6 (fluid) УМЕР с fluid-полем (чистка 2026-08-24): воду рисуют
    // её собственные атомы; пропуск номера в лейауте легален.
    constexpr std::uint32_t kBindIds[8] = {0, 1, 2, 3, 4, 5, 7, 8};
    VkDescriptorSetLayoutBinding b[8]{};
    for (std::uint32_t i = 0; i < 8; ++i) {
        b[i].binding = kBindIds[i];
        b[i].descriptorType = kBindIds[i] == 5
                                  ? VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER
                                  : VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
        b[i].descriptorCount = 1;
        b[i].stageFlags = VK_SHADER_STAGE_FRAGMENT_BIT;
    }

    VkDescriptorSetLayoutCreateInfo li{};
    li.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
    li.bindingCount = 8;
    li.pBindings = b;
    VK_TRY(vkCreateDescriptorSetLayout(dev_->device, &li, nullptr, &setLayout_));

    // Сет полурезного света: 2 сэмплера (диффуз+t, спекуляр). Лейаут нужен
    // ДО пайплайн-лейаута; сами картинки создаются лениво по размеру кадра.
    {
        VkSamplerCreateInfo si{};
        si.sType = VK_STRUCTURE_TYPE_SAMPLER_CREATE_INFO;
        si.magFilter = VK_FILTER_NEAREST; // билатераль сама берёт 4 текселя
        si.minFilter = VK_FILTER_NEAREST;
        si.addressModeU = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
        si.addressModeV = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
        si.addressModeW = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
        VK_TRY(vkCreateSampler(dev_->device, &si, nullptr, &halfSampler_));
        VkDescriptorSetLayoutBinding hb[2]{};
        for (std::uint32_t i = 0; i < 2; ++i) {
            hb[i].binding = i;
            hb[i].descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
            hb[i].descriptorCount = 1;
            hb[i].stageFlags = VK_SHADER_STAGE_FRAGMENT_BIT;
        }
        VkDescriptorSetLayoutCreateInfo hli{};
        hli.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        hli.bindingCount = 2;
        hli.pBindings = hb;
        VK_TRY(vkCreateDescriptorSetLayout(dev_->device, &hli, nullptr,
                                           &halfSetLayout_));
    }

    VkDescriptorPoolSize sizes[3]{};
    sizes[0].type = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    sizes[0].descriptorCount = 8 * kMaxFramesInFlight;
    sizes[1].type = VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER;
    sizes[1].descriptorCount = kMaxFramesInFlight;
    sizes[2].type = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
    sizes[2].descriptorCount = 2 * kMaxFramesInFlight;
    VkDescriptorPoolCreateInfo pi{};
    pi.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    pi.maxSets = 2 * kMaxFramesInFlight;
    pi.poolSizeCount = 3;
    pi.pPoolSizes = sizes;
    VK_TRY(vkCreateDescriptorPool(dev_->device, &pi, nullptr, &descPool_));
    for (int f = 0; f < kMaxFramesInFlight; ++f) {
        VkDescriptorSetAllocateInfo hai{};
        hai.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
        hai.descriptorPool = descPool_;
        hai.descriptorSetCount = 1;
        hai.pSetLayouts = &halfSetLayout_;
        VK_TRY(vkAllocateDescriptorSets(dev_->device, &hai, &halfSets_[f]));
    }

    // The albedo table is boot-time constant; write it into both UBO slots now
    // so record() only ever rewrites the matrix.
    std::uint32_t matCount = 0;
    const vec3* albedo = material_albedo_table(&matCount);

    for (int f = 0; f < kMaxFramesInFlight; ++f) {
        if (!ubo_[f].create_host_visible(*dev_, sizeof(MarchUbo),
                                         VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT,
                                         "raymarch ubo"))
            return false;
        MarchUbo* u = static_cast<MarchUbo*>(ubo_[f].mapped);
        u->invViewProj = mat4_identity();
        // Маски карт статичны после загрузки — пишутся один раз здесь.
        write_tex_masks(u, texMask_, normalMask_, roughnessMask_);
        for (std::uint32_t i = 0; i < 64; ++i) {
            // Out-of-range material ids must SCREAM, not blend in: a near-white
            // fallback rendered as believable "dead pixels" in a dark world.
            const vec3 c = i < matCount ? albedo[i] : vec3{1.0f, 0.0f, 1.0f};
            u->albedo[i] = vec4{c.x, c.y, c.z, 0.0f};
        }

        VkDescriptorSetAllocateInfo ai{};
        ai.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
        ai.descriptorPool = descPool_;
        ai.descriptorSetCount = 1;
        ai.pSetLayouts = &setLayout_;
        VK_TRY(vkAllocateDescriptorSets(dev_->device, &ai, &sets_[f]));

        const VkBuffer bufs[5] = {mirror.masks_buffer(), mirror.types_buffer(),
                                  mirror.page_index_buffer(),
                                  mirror.page_pool_buffer(),
                                  mirror.class_buffer()};
        const VkDeviceSize sizesB[5] = {
            VoxelMirror::kMasksBytes, VoxelMirror::kTypesBytes,
            VoxelMirror::kPageIdxBytes, VoxelMirror::kPoolBytes,
            VoxelMirror::kClassBytes};
        VkDescriptorBufferInfo bi[9]{};
        VkWriteDescriptorSet w[9]{};
        for (std::uint32_t i = 0; i < 5; ++i) {
            bi[i].buffer = bufs[i];
            bi[i].range = sizesB[i];
            w[i].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
            w[i].dstSet = sets_[f];
            w[i].dstBinding = i;
            w[i].descriptorCount = 1;
            w[i].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
            w[i].pBufferInfo = &bi[i];
        }
        bi[5].buffer = ubo_[f].buffer;
        bi[5].range = sizeof(MarchUbo);
        w[5].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
        w[5].dstSet = sets_[f];
        w[5].dstBinding = 5;
        w[5].descriptorCount = 1;
        w[5].descriptorType = VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER;
        w[5].pBufferInfo = &bi[5];
        bi[7].buffer = mirror.stain_index_buffer();
        bi[7].range = VoxelMirror::kStainIdxBytes;
        bi[8].buffer = mirror.stain_pool_buffer();
        bi[8].range = VoxelMirror::kStainPoolBytes;
        // Слот 6 (fluid) мёртв — записи стейнов уплотняются в w[6..7],
        // биндинги остаются 7 и 8.
        for (std::uint32_t k = 7; k <= 8; ++k) {
            w[k - 1].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
            w[k - 1].dstSet = sets_[f];
            w[k - 1].dstBinding = k;
            w[k - 1].descriptorCount = 1;
            w[k - 1].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
            w[k - 1].pBufferInfo = &bi[k];
        }
        vkUpdateDescriptorSets(dev_->device, 8, w, 0, nullptr);
    }
    return true;
}

bool RaymarchPass::create_pipeline(VkRenderPass renderPass,
                                   const char* shaderDir) {
    std::vector<char> vsrc, fsrc;
    if (!read_spv(join(shaderDir, "raymarch.vert.spv"), vsrc)) return false;
    // Same two-modules-from-one-source scheme as cube.frag: the textured module
    // statically uses set 2's samplers, so the procedural fallback needs a
    // module that never declares them.
    const char* fragSpv = textured_ ? "raymarch_tex.frag.spv" : "raymarch.frag.spv";
    if (!read_spv(join(shaderDir, fragSpv), fsrc)) return false;

    VkShaderModule vs = VK_NULL_HANDLE, fs = VK_NULL_HANDLE;
    if (!make_module(dev_->device, vsrc, &vs)) return false;
    if (!make_module(dev_->device, fsrc, &fs)) {
        vkDestroyShaderModule(dev_->device, vs, nullptr);
        return false;
    }

    VkPipelineShaderStageCreateInfo stages[2]{};
    stages[0].sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    stages[0].stage = VK_SHADER_STAGE_VERTEX_BIT;
    stages[0].module = vs;
    stages[0].pName = "main";
    stages[1].sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    stages[1].stage = VK_SHADER_STAGE_FRAGMENT_BIT;
    stages[1].module = fs;
    stages[1].pName = "main";

    VkPipelineVertexInputStateCreateInfo vi{};
    vi.sType = VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO;

    VkPipelineInputAssemblyStateCreateInfo ia{};
    ia.sType = VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO;
    ia.topology = VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST;

    VkPipelineViewportStateCreateInfo vp{};
    vp.sType = VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO;
    vp.viewportCount = 1;
    vp.scissorCount = 1;

    VkPipelineRasterizationStateCreateInfo rs{};
    rs.sType = VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO;
    rs.polygonMode = VK_POLYGON_MODE_FILL;
    rs.cullMode = VK_CULL_MODE_NONE;
    rs.frontFace = VK_FRONT_FACE_COUNTER_CLOCKWISE;
    rs.lineWidth = 1.0f;

    VkPipelineMultisampleStateCreateInfo ms{};
    ms.sType = VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO;
    ms.rasterizationSamples = VK_SAMPLE_COUNT_1_BIT;

    VkPipelineColorBlendAttachmentState cba{};
    cba.colorWriteMask = VK_COLOR_COMPONENT_R_BIT | VK_COLOR_COMPONENT_G_BIT |
                         VK_COLOR_COMPONENT_B_BIT | VK_COLOR_COMPONENT_A_BIT;
    VkPipelineColorBlendStateCreateInfo cb{};
    cb.sType = VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO;
    cb.attachmentCount = 1;
    cb.pAttachments = &cba;

    // The marcher IS the depth source: ALWAYS + write, gl_FragDepth per pixel.
    // Raster passes after it keep their LESS test and occlude correctly.
    VkPipelineDepthStencilStateCreateInfo ds{};
    ds.sType = VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO;
    ds.depthTestEnable = VK_TRUE;
    ds.depthWriteEnable = VK_TRUE;
    ds.depthCompareOp = VK_COMPARE_OP_ALWAYS;

    VkDynamicState dyn[] = {VK_DYNAMIC_STATE_VIEWPORT, VK_DYNAMIC_STATE_SCISSOR};
    VkPipelineDynamicStateCreateInfo dsi{};
    dsi.sType = VK_STRUCTURE_TYPE_PIPELINE_DYNAMIC_STATE_CREATE_INFO;
    dsi.dynamicStateCount = 2;
    dsi.pDynamicStates = dyn;

    VkPushConstantRange pcr{};
    pcr.stageFlags = VK_SHADER_STAGE_FRAGMENT_BIT;
    pcr.offset = 0;
    pcr.size = sizeof(CubePush);

    // Сет полурезного света — ПОСЛЕДНИЙ (шейдер: set 3 у текстурного, set 2
    // у процедурного). Полупасс-пайплайн делит этот же лейаут: лишние сеты
    // его шейдер просто не объявляет — это легально.
    VkDescriptorSetLayout setLayouts[4] = {setLayout_, lightGridSetLayout_,
                                           textured_ ? texSetLayout_
                                                     : halfSetLayout_,
                                           halfSetLayout_};
    std::uint32_t setCount = textured_ ? 4 : 3;

    VkPipelineLayoutCreateInfo lci{};
    lci.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
    lci.pushConstantRangeCount = 1;
    lci.pPushConstantRanges = &pcr;
    lci.setLayoutCount = setCount;
    lci.pSetLayouts = setLayouts;
    bool ok = vkCreatePipelineLayout(dev_->device, &lci, nullptr, &layout_) ==
              VK_SUCCESS;

    if (ok) {
        VkGraphicsPipelineCreateInfo gp{};
        gp.sType = VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO;
        gp.stageCount = 2;
        gp.pStages = stages;
        gp.pVertexInputState = &vi;
        gp.pInputAssemblyState = &ia;
        gp.pViewportState = &vp;
        gp.pRasterizationState = &rs;
        gp.pMultisampleState = &ms;
        gp.pColorBlendState = &cb;
        gp.pDepthStencilState = &ds;
        gp.pDynamicState = &dsi;
        gp.layout = layout_;
        gp.renderPass = renderPass;
        gp.subpass = 0;
        ok = vkCreateGraphicsPipelines(dev_->device, VK_NULL_HANDLE, 1, &gp,
                                       nullptr, &pipeline_) == VK_SUCCESS;
    }

    vkDestroyShaderModule(dev_->device, fs, nullptr);
    if (!ok) {
        vkDestroyShaderModule(dev_->device, vs, nullptr);
        std::fprintf(stderr, "[vk] raymarch pipeline creation failed\n");
        return false;
    }

    // Полупасс-пайплайн: тот же вершинный треугольник, фрагмент —
    // raymarch_light (производитель света), 2 цветовые цели, глубины нет.
    {
        std::vector<char> lsrc;
        if (!read_spv(join(shaderDir, "raymarch_light.frag.spv"), lsrc)) {
            vkDestroyShaderModule(dev_->device, vs, nullptr);
            return false;
        }
        VkShaderModule lfs = VK_NULL_HANDLE;
        if (!make_module(dev_->device, lsrc, &lfs)) {
            vkDestroyShaderModule(dev_->device, vs, nullptr);
            return false;
        }
        VkPipelineShaderStageCreateInfo lstages[2] = {stages[0], stages[1]};
        lstages[1].module = lfs;

        VkPipelineColorBlendAttachmentState lcba[2] = {cba, cba};
        VkPipelineColorBlendStateCreateInfo lcb = cb;
        lcb.attachmentCount = 2;
        lcb.pAttachments = lcba;
        VkPipelineDepthStencilStateCreateInfo lds{};
        lds.sType = VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO;

        VkGraphicsPipelineCreateInfo gp{};
        gp.sType = VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO;
        gp.stageCount = 2;
        gp.pStages = lstages;
        gp.pVertexInputState = &vi;
        gp.pInputAssemblyState = &ia;
        gp.pViewportState = &vp;
        gp.pRasterizationState = &rs;
        gp.pMultisampleState = &ms;
        gp.pColorBlendState = &lcb;
        gp.pDepthStencilState = &lds;
        gp.pDynamicState = &dsi;
        gp.layout = layout_;
        gp.renderPass = halfPass_;
        gp.subpass = 0;
        ok = vkCreateGraphicsPipelines(dev_->device, VK_NULL_HANDLE, 1, &gp,
                                       nullptr, &halfPipeline_) == VK_SUCCESS;
        vkDestroyShaderModule(dev_->device, lfs, nullptr);
    }

    vkDestroyShaderModule(dev_->device, vs, nullptr);
    if (!ok) std::fprintf(stderr, "[vk] raymarch half-light pipeline failed\n");
    return ok;
}

// Оффскрин-рендерпасс полурезного света: 2×RGBA16F, из UNDEFINED в
// SHADER_READ_ONLY; зависимость 0→EXTERNAL отдаёт запись фрагментному чтению
// главного пасса, EXTERNAL→0 ждёт чтение прошлого кадра этих целей.
bool RaymarchPass::create_half_pass() {
    VkAttachmentDescription at[2]{};
    for (int i = 0; i < 2; ++i) {
        at[i].format = VK_FORMAT_R16G16B16A16_SFLOAT;
        at[i].samples = VK_SAMPLE_COUNT_1_BIT;
        at[i].loadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE; // перекрывается целиком
        at[i].storeOp = VK_ATTACHMENT_STORE_OP_STORE;
        at[i].stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
        at[i].stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
        at[i].initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        at[i].finalLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
    }
    VkAttachmentReference refs[2] = {
        {0, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL},
        {1, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL}};
    VkSubpassDescription sp{};
    sp.pipelineBindPoint = VK_PIPELINE_BIND_POINT_GRAPHICS;
    sp.colorAttachmentCount = 2;
    sp.pColorAttachments = refs;
    VkSubpassDependency deps[2]{};
    deps[0].srcSubpass = VK_SUBPASS_EXTERNAL;
    deps[0].dstSubpass = 0;
    deps[0].srcStageMask = VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT;
    deps[0].srcAccessMask = VK_ACCESS_SHADER_READ_BIT;
    deps[0].dstStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    deps[0].dstAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
    deps[1].srcSubpass = 0;
    deps[1].dstSubpass = VK_SUBPASS_EXTERNAL;
    deps[1].srcStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    deps[1].srcAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
    deps[1].dstStageMask = VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT;
    deps[1].dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
    VkRenderPassCreateInfo rp{};
    rp.sType = VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO;
    rp.attachmentCount = 2;
    rp.pAttachments = at;
    rp.subpassCount = 1;
    rp.pSubpasses = &sp;
    rp.dependencyCount = 2;
    rp.pDependencies = deps;
    VK_TRY(vkCreateRenderPass(dev_->device, &rp, nullptr, &halfPass_));
    return true;
}

void RaymarchPass::destroy_half_targets() {
    for (int f = 0; f < kMaxFramesInFlight; ++f) {
        if (halfFb_[f]) vkDestroyFramebuffer(dev_->device, halfFb_[f], nullptr);
        halfFb_[f] = VK_NULL_HANDLE;
        for (int i = 0; i < 2; ++i) {
            if (halfView_[f][i])
                vkDestroyImageView(dev_->device, halfView_[f][i], nullptr);
            if (halfImg_[f][i])
                vkDestroyImage(dev_->device, halfImg_[f][i], nullptr);
            if (halfMem_[f][i])
                vkFreeMemory(dev_->device, halfMem_[f][i], nullptr);
            halfView_[f][i] = VK_NULL_HANDLE;
            halfImg_[f][i] = VK_NULL_HANDLE;
            halfMem_[f][i] = VK_NULL_HANDLE;
        }
    }
    halfExtent_ = {0, 0};
}

bool RaymarchPass::create_half_targets(VkExtent2D he) {
    VkPhysicalDeviceMemoryProperties mp{};
    vkGetPhysicalDeviceMemoryProperties(dev_->physical, &mp);
    for (int f = 0; f < kMaxFramesInFlight; ++f) {
        for (int i = 0; i < 2; ++i) {
            VkImageCreateInfo ii{};
            ii.sType = VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO;
            ii.imageType = VK_IMAGE_TYPE_2D;
            ii.format = VK_FORMAT_R16G16B16A16_SFLOAT;
            ii.extent = {he.width, he.height, 1};
            ii.mipLevels = 1;
            ii.arrayLayers = 1;
            ii.samples = VK_SAMPLE_COUNT_1_BIT;
            ii.tiling = VK_IMAGE_TILING_OPTIMAL;
            ii.usage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT |
                       VK_IMAGE_USAGE_SAMPLED_BIT;
            ii.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
            VK_TRY(vkCreateImage(dev_->device, &ii, nullptr, &halfImg_[f][i]));
            VkMemoryRequirements req{};
            vkGetImageMemoryRequirements(dev_->device, halfImg_[f][i], &req);
            std::uint32_t type = UINT32_MAX;
            for (std::uint32_t t = 0; t < mp.memoryTypeCount; ++t)
                if ((req.memoryTypeBits & (1u << t)) &&
                    (mp.memoryTypes[t].propertyFlags &
                     VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT)) {
                    type = t;
                    break;
                }
            if (type == UINT32_MAX) return false;
            VkMemoryAllocateInfo ai{};
            ai.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
            ai.allocationSize = req.size;
            ai.memoryTypeIndex = type;
            VK_TRY(vkAllocateMemory(dev_->device, &ai, nullptr, &halfMem_[f][i]));
            VK_TRY(vkBindImageMemory(dev_->device, halfImg_[f][i],
                                     halfMem_[f][i], 0));
            VkImageViewCreateInfo vi{};
            vi.sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO;
            vi.image = halfImg_[f][i];
            vi.viewType = VK_IMAGE_VIEW_TYPE_2D;
            vi.format = VK_FORMAT_R16G16B16A16_SFLOAT;
            vi.subresourceRange.aspectMask = VK_IMAGE_ASPECT_COLOR_BIT;
            vi.subresourceRange.levelCount = 1;
            vi.subresourceRange.layerCount = 1;
            VK_TRY(vkCreateImageView(dev_->device, &vi, nullptr,
                                     &halfView_[f][i]));
        }
        VkImageView att[2] = {halfView_[f][0], halfView_[f][1]};
        VkFramebufferCreateInfo fi{};
        fi.sType = VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO;
        fi.renderPass = halfPass_;
        fi.attachmentCount = 2;
        fi.pAttachments = att;
        fi.width = he.width;
        fi.height = he.height;
        fi.layers = 1;
        VK_TRY(vkCreateFramebuffer(dev_->device, &fi, nullptr, &halfFb_[f]));
        VkDescriptorImageInfo di[2]{};
        VkWriteDescriptorSet w[2]{};
        for (int i = 0; i < 2; ++i) {
            di[i].sampler = halfSampler_;
            di[i].imageView = halfView_[f][i];
            di[i].imageLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
            w[i].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
            w[i].dstSet = halfSets_[f];
            w[i].dstBinding = static_cast<std::uint32_t>(i);
            w[i].descriptorCount = 1;
            w[i].descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
            w[i].pImageInfo = &di[i];
        }
        vkUpdateDescriptorSets(dev_->device, 2, w, 0, nullptr);
    }
    halfExtent_ = he;
    std::fprintf(stderr, "[raymarch] half-light targets %ux%u\n", he.width,
                 he.height);
    return true;
}

void RaymarchPass::record_light(VkCommandBuffer cmd, std::uint32_t frameIndex,
                                const CubePush& push,
                                VkDescriptorSet lightGridSet,
                                VkExtent2D fullExtent) {
    if (!ready() || halfPipeline_ == VK_NULL_HANDLE) return;
    // Полразрешения ВЫВОДИТСЯ из кадра (настройки графики меняют разрешение —
    // цели следуют за ним; смена редка, waitIdle честнее пула в полёте).
    const VkExtent2D he{(fullExtent.width + 1) / 2, (fullExtent.height + 1) / 2};
    if (he.width != halfExtent_.width || he.height != halfExtent_.height) {
        vkDeviceWaitIdle(dev_->device);
        destroy_half_targets();
        if (!create_half_targets(he)) {
            std::fprintf(stderr, "[raymarch] half-light targets FAILED\n");
            return;
        }
    }
    const std::uint32_t f = frameIndex % kMaxFramesInFlight;
    MarchUbo* u = static_cast<MarchUbo*>(ubo_[f].mapped);
    u->invViewProj = mat4_inverse(push.viewProj);
    u->timeParams = vec4{push.torus.w, push.torus.z, 0.0f, 0.0f};

    VkRenderPassBeginInfo rp{};
    rp.sType = VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO;
    rp.renderPass = halfPass_;
    rp.framebuffer = halfFb_[f];
    rp.renderArea.extent = he;
    vkCmdBeginRenderPass(cmd, &rp, VK_SUBPASS_CONTENTS_INLINE);
    VkViewport vp{};
    vp.width = static_cast<float>(he.width);
    vp.height = static_cast<float>(he.height);
    vp.maxDepth = 1.0f;
    vkCmdSetViewport(cmd, 0, 1, &vp);
    VkRect2D sc{};
    sc.extent = he;
    vkCmdSetScissor(cmd, 0, 1, &sc);

    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, halfPipeline_);
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, layout_, 0, 1,
                            &sets_[f], 0, nullptr);
    if (lightGridSet != VK_NULL_HANDLE)
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, layout_,
                                1, 1, &lightGridSet, 0, nullptr);
    vkCmdPushConstants(cmd, layout_, VK_SHADER_STAGE_FRAGMENT_BIT, 0,
                       sizeof(CubePush), &push);
    vkCmdDraw(cmd, 3, 1, 0, 0);
    vkCmdEndRenderPass(cmd);
}

void RaymarchPass::record(VkCommandBuffer cmd, std::uint32_t frameIndex,
                          const CubePush& push, VkDescriptorSet lightGridSet) {
    if (!ready()) return;
    const std::uint32_t f = frameIndex % kMaxFramesInFlight;

    MarchUbo* u = static_cast<MarchUbo*>(ubo_[f].mapped);
    u->invViewProj = mat4_inverse(push.viewProj);
    u->timeParams = vec4{push.torus.w, push.torus.z, 0.0f, 0.0f};

    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, pipeline_);
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, layout_, 0, 1,
                            &sets_[f], 0, nullptr);
    if (lightGridSetLayout_ != VK_NULL_HANDLE && lightGridSet != VK_NULL_HANDLE)
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, layout_, 1,
                                1, &lightGridSet, 0, nullptr);
    if (textured_)
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, layout_, 2,
                                1, &texSet_, 0, nullptr);
    // Полурезный свет — последний сет (3 у текстурного, 2 у процедурного);
    // шейдер полного кадра сэмплит его вместо собственного surface_light.
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, layout_,
                            textured_ ? 3u : 2u, 1,
                            &halfSets_[frameIndex % kMaxFramesInFlight], 0,
                            nullptr);

    // Маски карт едут в MarchUbo (64 бита честно, К1-2) — torus.z/w
    // остаются тем, чем их положил кадр (samosborPulse/время): двойное
    // назначение лейны и float-округление маски умерли.
    vkCmdPushConstants(cmd, layout_, VK_SHADER_STAGE_FRAGMENT_BIT, 0,
                       sizeof(CubePush), &push);
    vkCmdDraw(cmd, 3, 1, 0, 0);
}

void RaymarchPass::destroy() {
    if (!dev_) return;
    destroy_half_targets();
    if (halfPipeline_) vkDestroyPipeline(dev_->device, halfPipeline_, nullptr);
    if (halfPass_) vkDestroyRenderPass(dev_->device, halfPass_, nullptr);
    if (halfSampler_) vkDestroySampler(dev_->device, halfSampler_, nullptr);
    if (halfSetLayout_)
        vkDestroyDescriptorSetLayout(dev_->device, halfSetLayout_, nullptr);
    halfPipeline_ = VK_NULL_HANDLE;
    halfPass_ = VK_NULL_HANDLE;
    halfSampler_ = VK_NULL_HANDLE;
    halfSetLayout_ = VK_NULL_HANDLE;
    if (pipeline_) vkDestroyPipeline(dev_->device, pipeline_, nullptr);
    if (layout_) vkDestroyPipelineLayout(dev_->device, layout_, nullptr);
    if (descPool_) vkDestroyDescriptorPool(dev_->device, descPool_, nullptr);
    if (setLayout_) vkDestroyDescriptorSetLayout(dev_->device, setLayout_, nullptr);
    for (int i = 0; i < kMaxFramesInFlight; ++i) ubo_[i].destroy(*dev_);
    pipeline_ = VK_NULL_HANDLE;
    layout_ = VK_NULL_HANDLE;
    descPool_ = VK_NULL_HANDLE;
    setLayout_ = VK_NULL_HANDLE;
    dev_ = nullptr;
}

} // namespace giga::gpu
