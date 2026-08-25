#include "render/body_pass.h"

#include "render/vk_device.h"

#include <cmath>
#include <cstdio>
#include <cstring> // memcpy — раздельная укладка кубов и сфер в инстанс-буфер
#include <string>
#include <vector>

#include "core/wrap.h"
#include "ecs/components.h"

namespace giga::gpu {

namespace {

// Upper bound on simultaneously-drawn bodies. Embodiment keeps only the active
// area live (a floor slice / the crowd around the player), so a few tens of
// thousands is generous headroom; sizing for it once means the per-frame buffer
// never reallocates. 64k * sizeof(BodyInstance) ~ 2.4 MB per in-flight frame.
constexpr std::uint32_t kMaxBodies = 1u << 16;

struct CubeVertex {
    vec3 pos;
    vec3 normal;
};

// 6 faces * 2 triangles * 3 verts = 36 vertices of a unit cube [0,1]^3 with
// outward face normals, CCW from outside (matches the pipeline's front face).
// Identical to the world pass's mesh; the body pass owns its own copy so the two
// passes stay independent.
void build_unit_cube(std::vector<CubeVertex>& out) {
    struct Face { vec3 n; vec3 a, b, c, d; };
    const Face faces[6] = {
        {{1, 0, 0}, {1, 0, 0}, {1, 1, 0}, {1, 1, 1}, {1, 0, 1}},
        {{-1, 0, 0}, {0, 0, 0}, {0, 0, 1}, {0, 1, 1}, {0, 1, 0}},
        {{0, 1, 0}, {0, 1, 0}, {0, 1, 1}, {1, 1, 1}, {1, 1, 0}},
        {{0, -1, 0}, {0, 0, 0}, {1, 0, 0}, {1, 0, 1}, {0, 0, 1}},
        {{0, 0, 1}, {0, 0, 1}, {1, 0, 1}, {1, 1, 1}, {0, 1, 1}},
        {{0, 0, -1}, {0, 0, 0}, {0, 1, 0}, {1, 1, 0}, {1, 0, 0}},
    };
    for (const auto& f : faces) {
        out.push_back({f.a, f.n});
        out.push_back({f.b, f.n});
        out.push_back({f.c, f.n});
        out.push_back({f.a, f.n});
        out.push_back({f.c, f.n});
        out.push_back({f.d, f.n});
    }
}

// UV-сфера диаметра 1 с центром (0.5,0.5,0.5) — тот же контракт [0,1]³, что у
// куба, поэтому body.vert не меняется: инстанс растягивает её в half-габарит.
// Шар физики (RigidBody без ContactForm) обязан ВЫГЛЯДЕТЬ шаром — сфера и
// есть словарь движка ([markoaudit/plans/ragdoll.md] §6). 12×8 сегментов =
// 576 вершин: низкополигонально намеренно, стиль дома — гранёный.
void build_unit_sphere(std::vector<CubeVertex>& out) {
    constexpr int kLon = 12, kLat = 8;
    constexpr float kPi = 3.14159265f;
    auto point = [](int lon, int lat) {
        const float th = kPi * static_cast<float>(lat) / kLat;   // 0..pi
        const float ph = 2.0f * kPi * static_cast<float>(lon) / kLon;
        return vec3{std::sin(th) * std::cos(ph) * 0.5f,
                    std::sin(th) * std::sin(ph) * 0.5f,
                    std::cos(th) * 0.5f};
    };
    const vec3 c{0.5f, 0.5f, 0.5f};
    for (int lat = 0; lat < kLat; ++lat)
        for (int lon = 0; lon < kLon; ++lon) {
            const vec3 a = point(lon, lat), b = point(lon + 1, lat);
            const vec3 d = point(lon, lat + 1), e = point(lon + 1, lat + 1);
            // Плоская нормаль грани — гранёный шейдинг, как у куба.
            const vec3 n = normalize(a + b + d + e);
            if (lat > 0) {
                out.push_back({c + a, n});
                out.push_back({c + b, n});
                out.push_back({c + e, n});
            }
            if (lat < kLat - 1) {
                out.push_back({c + a, n});
                out.push_back({c + e, n});
                out.push_back({c + d, n});
            }
        }
}

std::string join(const char* dir, const char* file) {
    std::string s = dir;
    if (!s.empty() && s.back() != '/') s += '/';
    s += file;
    return s;
}

bool read_file(const std::string& path, std::vector<char>& out) {
    std::FILE* f = std::fopen(path.c_str(), "rb");
    if (!f) { std::fprintf(stderr, "[vk] cannot open %s\n", path.c_str()); return false; }
    std::fseek(f, 0, SEEK_END);
    long n = std::ftell(f);
    std::fseek(f, 0, SEEK_SET);
    if (n <= 0) { std::fclose(f); return false; }
    out.resize(static_cast<std::size_t>(n));
    std::size_t rd = std::fread(out.data(), 1, static_cast<std::size_t>(n), f);
    std::fclose(f);
    return rd == static_cast<std::size_t>(n);
}

bool make_module(VkDevice dev, const std::vector<char>& spv, VkShaderModule* m) {
    VkShaderModuleCreateInfo ci{};
    ci.sType = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO;
    ci.codeSize = spv.size();
    ci.pCode = reinterpret_cast<const std::uint32_t*>(spv.data());
    return vkCreateShaderModule(dev, &ci, nullptr, m) == VK_SUCCESS;
}

} // namespace

bool BodyPass::init(VulkanDevice& dev, VkRenderPass renderPass,
                    const char* shaderDir, VkDescriptorSetLayout lightGridSetLayout,
                    VkDescriptorSetLayout shadowSetLayout) {
    dev_ = &dev;
    lightGridSetLayout_ = lightGridSetLayout;
    shadowSetLayout_ = shadowSetLayout;
    if (!create_cube_mesh()) return false;
    if (!create_pipeline(renderPass, shaderDir)) return false;

    instanceCapacity_ = kMaxBodies;
    VkDeviceSize bytes = static_cast<VkDeviceSize>(instanceCapacity_)
                       * sizeof(BodyInstance);
    for (int i = 0; i < kMaxFramesInFlight; ++i)
        if (!instances_[i].create_host_visible(
                dev, bytes, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT))
            return false;
    return true;
}

bool BodyPass::create_cube_mesh() {
    std::vector<CubeVertex> verts;
    build_unit_cube(verts);
    vertexCount_ = static_cast<std::uint32_t>(verts.size());
    if (!cubeVerts_.create_device_local(
            *dev_, verts.data(), verts.size() * sizeof(CubeVertex),
            VK_BUFFER_USAGE_VERTEX_BUFFER_BIT))
        return false;
    verts.clear();
    build_unit_sphere(verts);
    sphereVertexCount_ = static_cast<std::uint32_t>(verts.size());
    return sphereVerts_.create_device_local(
        *dev_, verts.data(), verts.size() * sizeof(CubeVertex),
        VK_BUFFER_USAGE_VERTEX_BUFFER_BIT);
}

bool BodyPass::create_pipeline(VkRenderPass renderPass, const char* shaderDir) {
    std::vector<char> vsrc, fsrc;
    // Own vertex stage; reuse the world pass's fragment stage (identical inputs).
    if (!read_file(join(shaderDir, "body.vert.spv"), vsrc)) return false;
    if (!read_file(join(shaderDir, "cube.frag.spv"), fsrc)) return false;

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

    // Two bindings: 0 = per-vertex cube mesh, 1 = per-instance body data.
    VkVertexInputBindingDescription bindings[2]{};
    bindings[0].binding = 0;
    bindings[0].stride = sizeof(CubeVertex);
    bindings[0].inputRate = VK_VERTEX_INPUT_RATE_VERTEX;
    bindings[1].binding = 1;
    bindings[1].stride = sizeof(BodyInstance);
    bindings[1].inputRate = VK_VERTEX_INPUT_RATE_INSTANCE;

    VkVertexInputAttributeDescription attrs[6]{};
    attrs[0] = {0, 0, VK_FORMAT_R32G32B32_SFLOAT, offsetof(CubeVertex, pos)};
    attrs[1] = {1, 0, VK_FORMAT_R32G32B32_SFLOAT, offsetof(CubeVertex, normal)};
    attrs[2] = {2, 1, VK_FORMAT_R32G32B32_SFLOAT, offsetof(BodyInstance, center)};
    attrs[3] = {3, 1, VK_FORMAT_R32G32B32_SFLOAT, offsetof(BodyInstance, half)};
    attrs[4] = {4, 1, VK_FORMAT_R32G32B32_SFLOAT, offsetof(BodyInstance, color)};
    attrs[5] = {5, 1, VK_FORMAT_R32G32B32A32_SFLOAT, offsetof(BodyInstance, rot)};

    VkPipelineVertexInputStateCreateInfo vi{};
    vi.sType = VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO;
    vi.vertexBindingDescriptionCount = 2;
    vi.pVertexBindingDescriptions = bindings;
    vi.vertexAttributeDescriptionCount = 6;
    vi.pVertexAttributeDescriptions = attrs;

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
    rs.cullMode = VK_CULL_MODE_BACK_BIT;
    rs.frontFace = VK_FRONT_FACE_COUNTER_CLOCKWISE;
    rs.lineWidth = 1.0f;

    VkPipelineMultisampleStateCreateInfo ms{};
    ms.sType = VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO;
    ms.rasterizationSamples = VK_SAMPLE_COUNT_1_BIT;

    VkPipelineColorBlendAttachmentState cba{};
    cba.colorWriteMask = VK_COLOR_COMPONENT_R_BIT | VK_COLOR_COMPONENT_G_BIT
                       | VK_COLOR_COMPONENT_B_BIT | VK_COLOR_COMPONENT_A_BIT;
    cba.blendEnable = VK_FALSE;
    VkPipelineColorBlendStateCreateInfo cb{};
    cb.sType = VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO;
    cb.attachmentCount = 1;
    cb.pAttachments = &cba;

    // Same depth state as the world pass, so bodies occlude and are occluded by
    // voxels correctly (shared depth buffer, VK_COMPARE_OP_LESS).
    VkPipelineDepthStencilStateCreateInfo ds{};
    ds.sType = VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO;
    ds.depthTestEnable = VK_TRUE;
    ds.depthWriteEnable = VK_TRUE;
    ds.depthCompareOp = VK_COMPARE_OP_LESS;

    VkDynamicState dyn[] = {VK_DYNAMIC_STATE_VIEWPORT, VK_DYNAMIC_STATE_SCISSOR};
    VkPipelineDynamicStateCreateInfo dsi{};
    dsi.sType = VK_STRUCTURE_TYPE_PIPELINE_DYNAMIC_STATE_CREATE_INFO;
    dsi.dynamicStateCount = 2;
    dsi.pDynamicStates = dyn;

    VkPushConstantRange pcr{};
    pcr.stageFlags = VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT;
    pcr.offset = 0;
    pcr.size = sizeof(CubePush);

    VkPipelineLayoutCreateInfo lci{};
    lci.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
    lci.pushConstantRangeCount = 1;
    lci.pPushConstantRanges = &pcr;

    VkDescriptorSetLayout dummySet0 = VK_NULL_HANDLE;
    VkDescriptorSetLayout setLayouts[3] = {};
    if (lightGridSetLayout_ != VK_NULL_HANDLE) {
        VkDescriptorSetLayoutCreateInfo li{};
        li.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        vkCreateDescriptorSetLayout(dev_->device, &li, nullptr, &dummySet0);

        setLayouts[0] = dummySet0;
        setLayouts[1] = lightGridSetLayout_;
        lci.setLayoutCount = 2;
        // Set 2 — теневой сет вокселного зеркала: тела принимают тени мира
        // ([ddalight.md]; отбрасывать свои — отдельная задача, тел нет в
        // зеркале).
        if (shadowSetLayout_ != VK_NULL_HANDLE) {
            setLayouts[2] = shadowSetLayout_;
            lci.setLayoutCount = 3;
        }
        lci.pSetLayouts = setLayouts;
    }

    bool ok = vkCreatePipelineLayout(dev_->device, &lci, nullptr, &layout_)
              == VK_SUCCESS;
    if (dummySet0 != VK_NULL_HANDLE) {
        vkDestroyDescriptorSetLayout(dev_->device, dummySet0, nullptr);
    }
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
    if (!ok) std::fprintf(stderr, "[vk] body pipeline creation failed\n");
    return ok;
}

void BodyPass::record(VkCommandBuffer cmd, std::uint32_t frameIndex,
                      const Registry& reg, LayerId layer, const CubePush& push,
                      VkDescriptorSet lightGridSet, VkDescriptorSet shadowSet) {
    const vec3 camPos{push.camPos.x, push.camPos.y, push.camPos.z};
    const float fogEnd = push.fog.y;
    const float fogEndSq = fogEnd * fogEnd;

    // Toroidal (minimal-image) placement, identical to the world pass: draw each
    // body at the tile-copy nearest the camera so a body across the seam appears
    // in front of the player instead of vanishing at the wrap.
    // One shared definition in core/wrap.h rather than a local lambda — the same
    // rule is implemented in shaders/cube.vert for the world pass, and having it
    // written out three different ways is how the seam eventually comes back.
    const float period = kWorldExtent;

    // Two shapes, one pipeline: boxes first, then spheres — a RigidBody with
    // no ContactForm IS a sphere (the solver's whole vocabulary) and must read
    // as one. Instances land in one buffer, spheres drawn via firstInstance.
    static thread_local std::vector<BodyInstance> cubes, spheres;
    cubes.clear();
    spheres.clear();

    auto view = reg.view<const Transform, const AABB, const Renderable>();
    for (auto e : view) {
        // Don't draw the viewer's own body: it would fill the first-person view.
        if (reg.all_of<CameraTag>(e)) continue;
        // Static furniture is PropPass-only ([jirnyak.md] section 18). Detached
        // props drop StaticPropTag for DynamicBodyTag and fall through as cubes.
        if (reg.all_of<StaticPropTag>(e)) continue;
        const Transform& tr = view.get<const Transform>(e);
        if (tr.layer != layer) continue;

        vec3 c{nearest_image(tr.pos.x, camPos.x, period),
               nearest_image(tr.pos.y, camPos.y, period),
               nearest_image(tr.pos.z, camPos.z, period)};
        float dx = c.x - camPos.x, dy = c.y - camPos.y, dz = c.z - camPos.z;
        if (dx * dx + dy * dy + dz * dz > fogEndSq) continue; // fogged to black

        BodyInstance inst;
        inst.center = c;
        inst.half = view.get<const AABB>(e).half;
        inst.color = view.get<const Renderable>(e).color;
        // Tumbling props carry a RigidBody orientation; everything else draws
        // axis-aligned (identity quat). Read-only skin over sim state —
        // sim -> render only, as ever.
        bool isSphere = false;
        if (const auto* rb = reg.try_get<RigidBody>(e)) {
            inst.rot = vec4{rb->q.x, rb->q.y, rb->q.z, rb->q.w};
            isSphere = !reg.all_of<ContactForm>(e);
        } else {
            inst.rot = vec4{0.0f, 0.0f, 0.0f, 1.0f};
        }
        if (cubes.size() + spheres.size() >= instanceCapacity_) {
            // S11: молчаливое обрезание по порядку вставки запрещено —
            // переполнение кричит (аудит 2026-08-25; сосед verlet кричал,
            // этот кран молчал).
            static bool warned = false;
            if (!warned) {
                warned = true;
                std::fprintf(stderr,
                             "[body] INSTANCE CAP: %u тел не влезли, хвост "
                             "не рисуется\n",
                             instanceCapacity_);
            }
            break;
        }
        (isSphere ? spheres : cubes).push_back(inst);
    }
    const std::uint32_t nCubes = static_cast<std::uint32_t>(cubes.size());
    const std::uint32_t nSpheres = static_cast<std::uint32_t>(spheres.size());
    const std::uint32_t count = nCubes + nSpheres;
    auto* dst = static_cast<BodyInstance*>(instances_[frameIndex].mapped);
    if (nCubes)
        std::memcpy(dst, cubes.data(), nCubes * sizeof(BodyInstance));
    if (nSpheres)
        std::memcpy(dst + nCubes, spheres.data(),
                    nSpheres * sizeof(BodyInstance));
    lastInstanceCount_ = count;
    if (count == 0) return;

    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, pipeline_);
    if (lightGridSet != VK_NULL_HANDLE) {
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, layout_, 1, 1, &lightGridSet, 0, nullptr);
    }
    if (shadowSet != VK_NULL_HANDLE) {
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, layout_, 2, 1, &shadowSet, 0, nullptr);
    }
    vkCmdPushConstants(cmd, layout_,
                       VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT,
                       0, sizeof(CubePush), &push);
    VkDeviceSize offs[2] = {0, 0};
    VkBuffer bufs[2] = {cubeVerts_.buffer, instances_[frameIndex].buffer};
    vkCmdBindVertexBuffers(cmd, 0, 2, bufs, offs);
    if (nCubes) vkCmdDraw(cmd, vertexCount_, nCubes, 0, 0);
    if (nSpheres) {
        // Второй меш, тот же инстанс-буфер: firstInstance смещает атрибуты
        // binding 1 на хвост со сферами.
        VkDeviceSize zero = 0;
        vkCmdBindVertexBuffers(cmd, 0, 1, &sphereVerts_.buffer, &zero);
        vkCmdDraw(cmd, sphereVertexCount_, nSpheres, 0, nCubes);
    }
}

void BodyPass::destroy() {
    if (!dev_) return;
    for (int i = 0; i < kMaxFramesInFlight; ++i) instances_[i].destroy(*dev_);
    cubeVerts_.destroy(*dev_);
    sphereVerts_.destroy(*dev_);
    if (pipeline_) { vkDestroyPipeline(dev_->device, pipeline_, nullptr); pipeline_ = VK_NULL_HANDLE; }
    if (layout_) { vkDestroyPipelineLayout(dev_->device, layout_, nullptr); layout_ = VK_NULL_HANDLE; }
}

} // namespace giga::gpu
