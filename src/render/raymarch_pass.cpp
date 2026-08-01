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

// Matches MarchUbo in shaders/raymarch.frag (std140: mat4 + vec4[32] = 576 B).
struct MarchUbo {
    mat4 invViewProj;
    vec4 albedo[32];
};
static_assert(sizeof(MarchUbo) == 576, "MarchUbo must match the shader block");

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
    if (!create_pipeline(renderPass, shaderDir)) return false;
    std::fprintf(stderr, "[raymarch] world pass up (%s)\n",
                 textured_ ? "textured" : "procedural-only");
    return true;
}

bool RaymarchPass::create_descriptors(const VoxelMirror& mirror) {
    VkDescriptorSetLayoutBinding b[9]{};
    for (std::uint32_t i = 0; i < 9; ++i) {
        b[i].binding = i;
        b[i].descriptorType = i == 5 ? VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER
                                     : VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
        b[i].descriptorCount = 1;
        b[i].stageFlags = VK_SHADER_STAGE_FRAGMENT_BIT;
    }

    VkDescriptorSetLayoutCreateInfo li{};
    li.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
    li.bindingCount = 9;
    li.pBindings = b;
    VK_TRY(vkCreateDescriptorSetLayout(dev_->device, &li, nullptr, &setLayout_));

    VkDescriptorPoolSize sizes[2]{};
    sizes[0].type = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    sizes[0].descriptorCount = 8 * kMaxFramesInFlight;
    sizes[1].type = VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER;
    sizes[1].descriptorCount = kMaxFramesInFlight;
    VkDescriptorPoolCreateInfo pi{};
    pi.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    pi.maxSets = kMaxFramesInFlight;
    pi.poolSizeCount = 2;
    pi.pPoolSizes = sizes;
    VK_TRY(vkCreateDescriptorPool(dev_->device, &pi, nullptr, &descPool_));

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
        for (std::uint32_t i = 0; i < 32; ++i) {
            const vec3 c = i < matCount ? albedo[i] : vec3{0.75f, 0.75f, 0.78f};
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
        bi[6].buffer = mirror.fluid_buffer();
        bi[6].range = VoxelMirror::kFluidBytes;
        w[6].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
        w[6].dstSet = sets_[f];
        w[6].dstBinding = 6;
        w[6].descriptorCount = 1;
        w[6].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
        w[6].pBufferInfo = &bi[6];
        bi[7].buffer = mirror.stain_index_buffer();
        bi[7].range = VoxelMirror::kStainIdxBytes;
        bi[8].buffer = mirror.stain_pool_buffer();
        bi[8].range = VoxelMirror::kStainPoolBytes;
        for (std::uint32_t k = 7; k <= 8; ++k) {
            w[k].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
            w[k].dstSet = sets_[f];
            w[k].dstBinding = k;
            w[k].descriptorCount = 1;
            w[k].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
            w[k].pBufferInfo = &bi[k];
        }
        vkUpdateDescriptorSets(dev_->device, 9, w, 0, nullptr);
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

    VkDescriptorSetLayout setLayouts[3] = {setLayout_, lightGridSetLayout_,
                                           texSetLayout_};
    std::uint32_t setCount = 1;
    if (lightGridSetLayout_ != VK_NULL_HANDLE) setCount = 2;
    if (textured_) setCount = 3;

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

    vkDestroyShaderModule(dev_->device, vs, nullptr);
    vkDestroyShaderModule(dev_->device, fs, nullptr);
    if (!ok) std::fprintf(stderr, "[vk] raymarch pipeline creation failed\n");
    return ok;
}

void RaymarchPass::record(VkCommandBuffer cmd, std::uint32_t frameIndex,
                          const CubePush& push, VkDescriptorSet lightGridSet) {
    if (!ready()) return;
    const std::uint32_t f = frameIndex % kMaxFramesInFlight;

    MarchUbo* u = static_cast<MarchUbo*>(ubo_[f].mapped);
    u->invViewProj = mat4_inverse(push.viewProj);

    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, pipeline_);
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, layout_, 0, 1,
                            &sets_[f], 0, nullptr);
    if (lightGridSetLayout_ != VK_NULL_HANDLE && lightGridSet != VK_NULL_HANDLE)
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, layout_, 1,
                                1, &lightGridSet, 0, nullptr);
    if (textured_)
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, layout_, 2,
                                1, &texSet_, 0, nullptr);

    CubePush p = push;
    p.torus.z = static_cast<float>(texMask_);
    std::uint32_t packedMasks =
        (normalMask_ & 0xFFFFu) | ((roughnessMask_ & 0xFFFFu) << 16);
    float packedF;
    std::memcpy(&packedF, &packedMasks, sizeof(packedF));
    p.torus.w = packedF;
    vkCmdPushConstants(cmd, layout_, VK_SHADER_STAGE_FRAGMENT_BIT, 0,
                       sizeof(CubePush), &p);
    vkCmdDraw(cmd, 3, 1, 0, 0);
}

void RaymarchPass::destroy() {
    if (!dev_) return;
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
