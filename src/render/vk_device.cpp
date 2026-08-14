#include "render/vk_device.h"

#include "render/vk_common.h"

#include <SDL3/SDL.h>
#include <SDL3/SDL_vulkan.h>

#include <cstdlib>
#include <cstring>
#include <vector>

namespace giga::gpu {

namespace {

constexpr const char* kValidationLayer = "VK_LAYER_KHRONOS_validation";

#ifdef __APPLE__
// The Homebrew Vulkan loader does not always auto-discover the MoltenVK ICD.
// Point it at a known dev location so a native binary runs without the caller
// exporting VK_ICD_FILENAMES by hand.
void ensure_moltenvk_icd() {
    if (std::getenv("VK_ICD_FILENAMES") || std::getenv("VK_DRIVER_FILES"))
        return;
    const char* cands[] = {
        "/opt/homebrew/share/vulkan/icd.d/MoltenVK_icd.json",
        "/opt/homebrew/etc/vulkan/icd.d/MoltenVK_icd.json",
        "/usr/local/share/vulkan/icd.d/MoltenVK_icd.json",
        "/usr/local/etc/vulkan/icd.d/MoltenVK_icd.json",
    };
    for (const char* c : cands) {
        std::FILE* fp = std::fopen(c, "rb");
        if (fp) {
            std::fclose(fp);
            SDL_setenv_unsafe("VK_ICD_FILENAMES", c, 1);
            std::fprintf(stderr, "[vk] MoltenVK ICD: %s\n", c);
            return;
        }
    }
}
#endif

bool instance_has_layer(const char* name) {
    std::uint32_t n = 0;
    vkEnumerateInstanceLayerProperties(&n, nullptr);
    std::vector<VkLayerProperties> layers(n);
    vkEnumerateInstanceLayerProperties(&n, layers.data());
    for (const auto& l : layers)
        if (std::strcmp(l.layerName, name) == 0) return true;
    return false;
}

bool device_has_ext(VkPhysicalDevice dev, const char* name) {
    std::uint32_t n = 0;
    vkEnumerateDeviceExtensionProperties(dev, nullptr, &n, nullptr);
    std::vector<VkExtensionProperties> exts(n);
    vkEnumerateDeviceExtensionProperties(dev, nullptr, &n, exts.data());
    for (const auto& e : exts)
        if (std::strcmp(e.extensionName, name) == 0) return true;
    return false;
}

VKAPI_ATTR VkBool32 VKAPI_CALL debug_cb(
    VkDebugUtilsMessageSeverityFlagBitsEXT sev,
    VkDebugUtilsMessageTypeFlagsEXT,
    const VkDebugUtilsMessengerCallbackDataEXT* data, void*) {
    if (sev >= VK_DEBUG_UTILS_MESSAGE_SEVERITY_WARNING_BIT_EXT)
        std::fprintf(stderr, "[vk] %s\n", data->pMessage);
    return VK_FALSE;
}

QueueFamilies find_queues(VkPhysicalDevice dev, VkSurfaceKHR surface) {
    QueueFamilies q;
    std::uint32_t n = 0;
    vkGetPhysicalDeviceQueueFamilyProperties(dev, &n, nullptr);
    std::vector<VkQueueFamilyProperties> fams(n);
    vkGetPhysicalDeviceQueueFamilyProperties(dev, &n, fams.data());
    for (std::uint32_t i = 0; i < n; ++i) {
        if ((fams[i].queueFlags & VK_QUEUE_GRAPHICS_BIT)
            && q.graphics == UINT32_MAX)
            q.graphics = i;
        VkBool32 present = VK_FALSE;
        vkGetPhysicalDeviceSurfaceSupportKHR(dev, i, surface, &present);
        if (present && q.present == UINT32_MAX) q.present = i;
        if (q.complete()) break;
    }
    return q;
}

int score_device(const VkPhysicalDeviceProperties& p) {
    int s = 0;
    if (p.deviceType == VK_PHYSICAL_DEVICE_TYPE_DISCRETE_GPU) s += 1000;
    else if (p.deviceType == VK_PHYSICAL_DEVICE_TYPE_INTEGRATED_GPU) s += 500;
    s += static_cast<int>(p.limits.maxImageDimension2D / 1024);
    return s;
}

} // namespace

bool VulkanDevice::init(SDL_Window* window, bool enableValidation) {
#ifdef __APPLE__
    ensure_moltenvk_icd();
#endif
    // Instance extensions SDL needs for the window surface. SDL3 returns an
    // owned array in one call.
    std::uint32_t sdlN = 0;
    const char* const* sdlExts = SDL_Vulkan_GetInstanceExtensions(&sdlN);
    if (!sdlExts) {
        std::fprintf(stderr, "[vk] SDL_Vulkan_GetInstanceExtensions: %s\n",
                     SDL_GetError());
        return false;
    }
    std::vector<const char*> exts(sdlExts, sdlExts + sdlN);
#ifdef __APPLE__
    exts.push_back(VK_KHR_GET_PHYSICAL_DEVICE_PROPERTIES_2_EXTENSION_NAME);
    exts.push_back(VK_KHR_PORTABILITY_ENUMERATION_EXTENSION_NAME);
#endif

    validation = enableValidation && instance_has_layer(kValidationLayer);
    if (enableValidation && !validation)
        std::fprintf(stderr,
                     "[vk] validation requested but %s not installed; "
                     "continuing without.\n", kValidationLayer);
    if (validation) exts.push_back(VK_EXT_DEBUG_UTILS_EXTENSION_NAME);

    VkApplicationInfo app{};
    app.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO;
    app.pApplicationName = "gigahrush2";
    app.applicationVersion = VK_MAKE_VERSION(0, 1, 0);
    app.pEngineName = "gigahrush2";
    app.engineVersion = VK_MAKE_VERSION(0, 1, 0);
    app.apiVersion = VK_API_VERSION_1_2;

    VkInstanceCreateInfo ci{};
    ci.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO;
    ci.pApplicationInfo = &app;
    ci.enabledExtensionCount = static_cast<std::uint32_t>(exts.size());
    ci.ppEnabledExtensionNames = exts.data();
#ifdef __APPLE__
    ci.flags |= VK_INSTANCE_CREATE_ENUMERATE_PORTABILITY_BIT_KHR;
#endif
    const char* layers[] = {kValidationLayer};
    if (validation) {
        ci.enabledLayerCount = 1;
        ci.ppEnabledLayerNames = layers;
    }
    VkResult ir = vkCreateInstance(&ci, nullptr, &instance);
    if (ir == VK_ERROR_LAYER_NOT_PRESENT && validation) {
        std::fprintf(stderr,
                     "[vk] %s enumerated but not loadable; continuing without "
                     "validation.\n", kValidationLayer);
        validation = false;
        ci.enabledLayerCount = 0;
        ci.ppEnabledLayerNames = nullptr;
        ir = vkCreateInstance(&ci, nullptr, &instance);
    }
    if (ir != VK_SUCCESS) {
        std::fprintf(stderr, "[vk] vkCreateInstance failed: %s (%d)\n",
                     vk_result_str(ir), static_cast<int>(ir));
        return false;
    }

    if (validation) {
        auto create = reinterpret_cast<PFN_vkCreateDebugUtilsMessengerEXT>(
            vkGetInstanceProcAddr(instance, "vkCreateDebugUtilsMessengerEXT"));
        if (create) {
            VkDebugUtilsMessengerCreateInfoEXT dci{};
            dci.sType = VK_STRUCTURE_TYPE_DEBUG_UTILS_MESSENGER_CREATE_INFO_EXT;
            dci.messageSeverity =
                VK_DEBUG_UTILS_MESSAGE_SEVERITY_WARNING_BIT_EXT
                | VK_DEBUG_UTILS_MESSAGE_SEVERITY_ERROR_BIT_EXT;
            dci.messageType =
                VK_DEBUG_UTILS_MESSAGE_TYPE_GENERAL_BIT_EXT
                | VK_DEBUG_UTILS_MESSAGE_TYPE_VALIDATION_BIT_EXT
                | VK_DEBUG_UTILS_MESSAGE_TYPE_PERFORMANCE_BIT_EXT;
            dci.pfnUserCallback = debug_cb;
            create(instance, &dci, nullptr, &debug);
        }
    }

    // Window surface (SDL owns platform specifics). SDL3 takes an allocator arg
    // and returns bool.
    if (!SDL_Vulkan_CreateSurface(window, instance, nullptr, &surface)) {
        std::fprintf(stderr, "[vk] SDL_Vulkan_CreateSurface: %s\n",
                     SDL_GetError());
        return false;
    }

    std::uint32_t devN = 0;
    vkEnumeratePhysicalDevices(instance, &devN, nullptr);
    if (devN == 0) {
        std::fprintf(stderr, "[vk] no Vulkan physical devices\n");
        return false;
    }
    std::vector<VkPhysicalDevice> devs(devN);
    vkEnumeratePhysicalDevices(instance, &devN, devs.data());

    int best = -1;
    for (auto d : devs) {
        VkPhysicalDeviceProperties p{};
        vkGetPhysicalDeviceProperties(d, &p);
        QueueFamilies q = find_queues(d, surface);
        if (!q.complete()) continue;
        if (!device_has_ext(d, VK_KHR_SWAPCHAIN_EXTENSION_NAME)) continue;
        int sc = score_device(p);
        if (sc > best) {
            best = sc;
            physical = d;
            families = q;
            props = p;
        }
    }
    if (physical == VK_NULL_HANDLE) {
        std::fprintf(stderr,
                     "[vk] no suitable GPU (need graphics+present+swapchain)\n");
        return false;
    }

    // Timestamp width is a property of the QUEUE FAMILY, not of the device, so
    // it has to be re-read for the family we actually settled on (gpu_timer.h).
    {
        std::uint32_t n = 0;
        vkGetPhysicalDeviceQueueFamilyProperties(physical, &n, nullptr);
        std::vector<VkQueueFamilyProperties> fams(n);
        vkGetPhysicalDeviceQueueFamilyProperties(physical, &n, fams.data());
        if (families.graphics < n)
            graphicsTimestampValidBits = fams[families.graphics].timestampValidBits;
    }

    float prio = 1.0f;
    std::vector<VkDeviceQueueCreateInfo> qcis;
    VkDeviceQueueCreateInfo qg{};
    qg.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO;
    qg.queueFamilyIndex = families.graphics;
    qg.queueCount = 1;
    qg.pQueuePriorities = &prio;
    qcis.push_back(qg);
    if (families.present != families.graphics) {
        VkDeviceQueueCreateInfo qp = qg;
        qp.queueFamilyIndex = families.present;
        qcis.push_back(qp);
    }

    std::vector<const char*> devExts = {VK_KHR_SWAPCHAIN_EXTENSION_NAME};
    if (device_has_ext(physical, "VK_KHR_portability_subset"))
        devExts.push_back("VK_KHR_portability_subset");

    VkPhysicalDeviceFeatures feats{};
    // The renderer indexes SSBOs from GPU-resident tables (page indices, stain
    // slots); with robustness off any stale slot is genuine UB. robustBufferAccess
    // is the one feature the spec guarantees on every implementation.
    feats.robustBufferAccess = VK_TRUE;
    VkPhysicalDeviceFeatures supported{};
    vkGetPhysicalDeviceFeatures(physical, &supported);
    if (supported.samplerAnisotropy) {
        feats.samplerAnisotropy = VK_TRUE;
    }
    features = feats;

    VkDeviceCreateInfo dci{};
    dci.sType = VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO;
    dci.queueCreateInfoCount = static_cast<std::uint32_t>(qcis.size());
    dci.pQueueCreateInfos = qcis.data();
    dci.enabledExtensionCount = static_cast<std::uint32_t>(devExts.size());
    dci.ppEnabledExtensionNames = devExts.data();
    dci.pEnabledFeatures = &feats;
    VK_TRY(vkCreateDevice(physical, &dci, nullptr, &device));

    vkGetDeviceQueue(device, families.graphics, 0, &graphicsQueue);
    vkGetDeviceQueue(device, families.present, 0, &presentQueue);

    std::fprintf(stderr,
                 "[vk] device: %s | api %u.%u.%u | queues g=%u p=%u | "
                 "validation=%d\n",
                 props.deviceName, VK_VERSION_MAJOR(props.apiVersion),
                 VK_VERSION_MINOR(props.apiVersion),
                 VK_VERSION_PATCH(props.apiVersion), families.graphics,
                 families.present, static_cast<int>(validation));
    return true;
}

void VulkanDevice::destroy() {
    if (device) {
        vkDestroyDevice(device, nullptr);
        device = VK_NULL_HANDLE;
    }
    if (surface) {
        vkDestroySurfaceKHR(instance, surface, nullptr);
        surface = VK_NULL_HANDLE;
    }
    if (debug) {
        auto destroyFn = reinterpret_cast<PFN_vkDestroyDebugUtilsMessengerEXT>(
            vkGetInstanceProcAddr(instance, "vkDestroyDebugUtilsMessengerEXT"));
        if (destroyFn) destroyFn(instance, debug, nullptr);
        debug = VK_NULL_HANDLE;
    }
    if (instance) {
        vkDestroyInstance(instance, nullptr);
        instance = VK_NULL_HANDLE;
    }
}

} // namespace giga::gpu
