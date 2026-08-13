#include "render/gas_pass.h"
#include <cstdio>
#include <fstream>
#include <cstring>
#include "render/vk_device.h"

namespace giga::gpu {

namespace {

bool read_file(const std::string& path, std::vector<char>& out) {
    std::ifstream f(path, std::ios::binary | std::ios::ate);
    if (!f) return false;
    const std::streamsize n = f.tellg();
    f.seekg(0);
    out.resize(static_cast<std::size_t>(n));
    return static_cast<bool>(f.read(out.data(), n));
}

bool make_module(VkDevice dev, const std::vector<char>& spv, VkShaderModule* m) {
    VkShaderModuleCreateInfo ci{};
    ci.sType = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO;
    ci.codeSize = spv.size();
    ci.pCode = reinterpret_cast<const uint32_t*>(spv.data());
    return vkCreateShaderModule(dev, &ci, nullptr, m) == VK_SUCCESS;
}

std::string join(const char* dir, const char* file) {
    std::string s = dir;
    if (!s.empty() && s.back() != '/') s += '/';
    s += file;
    return s;
}

struct GasPush {
    int32_t downX, downY, downZ, downW;
    float diffuseRate, buoyancy, burnRate, dt;
};
static_assert(sizeof(GasPush) == 32, "GasPush is 32 bytes");

} // namespace

bool GasPass::init(VulkanDevice* dev, const char* shaderDir, VkBuffer masksBuffer) {
    dev_ = dev;
    const size_t poolSize = 128 * 128 * 128 * sizeof(uint32_t); // 8MB

    for (int i = 0; i < 2; ++i) {
        if (!buf_[i].create_host_visible(*dev_, poolSize,
                                         VK_BUFFER_USAGE_STORAGE_BUFFER_BIT,
                                         "gas-pool"))
            return false;
        std::memset(buf_[i].mapped, 0, poolSize);
    }

    VkDescriptorSetLayoutBinding b[3]{};
    b[0].binding = 0; // GasIn
    b[0].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    b[0].descriptorCount = 1;
    b[0].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT | VK_SHADER_STAGE_FRAGMENT_BIT;
    
    b[1].binding = 1; // GasOut
    b[1].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    b[1].descriptorCount = 1;
    b[1].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
    
    b[2].binding = 2; // Masks
    b[2].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    b[2].descriptorCount = 1;
    b[2].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;

    VkDescriptorSetLayoutCreateInfo slci{};
    slci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
    slci.bindingCount = 3;
    slci.pBindings = b;
    if (vkCreateDescriptorSetLayout(dev_->device, &slci, nullptr, &descLayout_) != VK_SUCCESS) return false;

    VkDescriptorPoolSize ps{VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 6};
    VkDescriptorPoolCreateInfo pci{};
    pci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    pci.maxSets = 2; // two sets, one for ping, one for pong
    pci.poolSizeCount = 1;
    pci.pPoolSizes = &ps;
    if (vkCreateDescriptorPool(dev_->device, &pci, nullptr, &descPool_) != VK_SUCCESS) return false;

    VkDescriptorSetLayout layouts[2] = {descLayout_, descLayout_};
    VkDescriptorSetAllocateInfo ai{};
    ai.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
    ai.descriptorPool = descPool_;
    ai.descriptorSetCount = 2;
    ai.pSetLayouts = layouts;
    if (vkAllocateDescriptorSets(dev_->device, &ai, descSets_) != VK_SUCCESS) return false;

    for (int i = 0; i < 2; ++i) {
        VkDescriptorBufferInfo bi[3] = {
            {buf_[i].buffer, 0, VK_WHOLE_SIZE},           // GasIn
            {buf_[1 - i].buffer, 0, VK_WHOLE_SIZE},       // GasOut
            {masksBuffer, 0, VK_WHOLE_SIZE}               // Masks
        };
        VkWriteDescriptorSet w[3]{};
        for (int j = 0; j < 3; ++j) {
            w[j].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
            w[j].dstSet = descSets_[i];
            w[j].dstBinding = j;
            w[j].descriptorCount = 1;
            w[j].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
            w[j].pBufferInfo = &bi[j];
        }
        vkUpdateDescriptorSets(dev_->device, 3, w, 0, nullptr);
    }

    VkPushConstantRange pcr{};
    pcr.stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
    pcr.offset = 0;
    pcr.size = sizeof(GasPush);

    VkPipelineLayoutCreateInfo plci{};
    plci.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
    plci.setLayoutCount = 1;
    plci.pSetLayouts = &descLayout_;
    plci.pushConstantRangeCount = 1;
    plci.pPushConstantRanges = &pcr;
    if (vkCreatePipelineLayout(dev_->device, &plci, nullptr, &pipelineLayout_) != VK_SUCCESS) return false;

    std::vector<char> spv;
    if (!read_file(join(shaderDir, "gas_sim.comp.spv"), spv)) {
        // Warning if no shader is compiled yet
        std::fprintf(stderr, "[gas] gas_sim.comp.spv missing. Gas sim will not run.\n");
        return true; 
    }
    VkShaderModule compModule = VK_NULL_HANDLE;
    if (!make_module(dev_->device, spv, &compModule)) return false;

    VkComputePipelineCreateInfo cpci{};
    cpci.sType = VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO;
    cpci.layout = pipelineLayout_;
    cpci.stage.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    cpci.stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
    cpci.stage.module = compModule;
    cpci.stage.pName = "main";
    const bool ok = vkCreateComputePipelines(dev_->device, VK_NULL_HANDLE, 1, &cpci, nullptr, &computePipeline_) == VK_SUCCESS;
    
    vkDestroyShaderModule(dev_->device, compModule, nullptr);
    return ok;
}

void GasPass::destroy() {
    if (!dev_) return;
    if (computePipeline_) vkDestroyPipeline(dev_->device, computePipeline_, nullptr);
    if (pipelineLayout_) vkDestroyPipelineLayout(dev_->device, pipelineLayout_, nullptr);
    if (descLayout_) vkDestroyDescriptorSetLayout(dev_->device, descLayout_, nullptr);
    if (descPool_) vkDestroyDescriptorPool(dev_->device, descPool_, nullptr);
    buf_[0].destroy(*dev_);
    buf_[1].destroy(*dev_);
    dev_ = nullptr;
}

void GasPass::upload(const std::vector<GasCell>& gasCells) {
    if (gasCells.size() != 128*128*128) return;
    std::memcpy(buf_[currentIdx_].mapped, gasCells.data(), gasCells.size() * sizeof(GasCell));
}

void GasPass::step_sim(VkCommandBuffer cmd, float dt, int downX, int downY, int downZ,
                       float diffuseRate, float buoyancy, float burnRate) {
    if (!computePipeline_) return;

    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, computePipeline_);
    
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pipelineLayout_,
                            0, 1, &descSets_[currentIdx_], 0, nullptr);
                            
    GasPush push{};
    push.downX = downX;
    push.downY = downY;
    push.downZ = downZ;
    push.downW = 0;
    push.diffuseRate = diffuseRate;
    push.buoyancy = buoyancy;
    push.burnRate = burnRate;
    push.dt = dt;
    
    vkCmdPushConstants(cmd, pipelineLayout_, VK_SHADER_STAGE_COMPUTE_BIT, 0, sizeof(GasPush), &push);
    
    vkCmdDispatch(cmd, 128 / 8, 128 / 8, 128 / 4);
    
    // We would need a barrier here before next iteration or before read.
    // For now, assume render pass handles sync.
    currentIdx_ = 1 - currentIdx_;
}

} // namespace giga::gpu
