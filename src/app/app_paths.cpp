#include "app/app_paths.h"

#include <cstdlib>
#include <mutex>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <process.h>
#include <windows.h>
#else
#include <unistd.h>
#endif

namespace giga::app {

namespace {

std::mutex g_pathsMx;
bool g_pathsInitialized = false;
AppPaths g_paths{};

bool non_empty(const char* s) {
    return s != nullptr && *s != '\0';
}

bool is_sep(char c) {
    return c == '/' || c == '\\';
}

std::string normalize_dir(const char* raw) {
    if (!non_empty(raw)) return {};
    std::string s(raw);
    while (s.size() > 1 && is_sep(s.back())) {
#ifdef _WIN32
        // Keep drive root like "C:\" or "C:/" intact.
        if (s.size() == 3 && s[1] == ':') break;
#endif
        s.pop_back();
    }
    return s;
}

std::string join_path(const std::string& base, const std::string& leaf) {
    if (base.empty() || base == ".") return leaf;
    if (leaf.empty()) return base;
    if (is_sep(base.back())) return base + leaf;
    return base + "/" + leaf;
}

int current_pid() {
#ifdef _WIN32
    return _getpid();
#else
    return static_cast<int>(getpid());
#endif
}

bool probe_dir_writable(const std::string& dir) {
    if (!ensure_directory(dir)) return false;
    char probeName[64];
    std::snprintf(probeName, sizeof probeName, ".giga_write_probe_%d.tmp",
                  current_pid());
    const std::string probePath = join_path(dir, probeName);
    std::FILE* f = fopen_utf8(probePath, "wb");
    if (!f) return false;
    const bool closed = (std::fclose(f) == 0);
    std::error_code ec;
    std::filesystem::remove(fs_path_from_utf8(probePath), ec);
    return closed;
}

#ifdef _WIN32
std::wstring utf8_to_wide(const std::string& utf8) {
    if (utf8.empty()) return {};
    const int wlen = MultiByteToWideChar(
        CP_UTF8, 0, utf8.c_str(), static_cast<int>(utf8.size()), nullptr, 0);
    if (wlen <= 0) return {};
    std::wstring wide(static_cast<std::size_t>(wlen), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(),
                        static_cast<int>(utf8.size()), wide.data(), wlen);
    return wide;
}
#endif

AppPaths resolve_paths(const char* cliOverride, const char* sdlPrefPath) {
    AppPaths out;
    const char* envPref = std::getenv("GIGA_PREF_DIR");
    const char* envSave = std::getenv("GIGA_SAVE_DIR");

    if (non_empty(cliOverride)) {
        out.prefDir = normalize_dir(cliOverride);
        out.saveDir = join_path(out.prefDir, "save");
        out.origin = PathOrigin::CliOverride;
        out.prefDirWritable = probe_dir_writable(out.prefDir);
    } else if (non_empty(envPref)) {
        out.prefDir = normalize_dir(envPref);
        out.saveDir = join_path(out.prefDir, "save");
        out.origin = PathOrigin::EnvPrefDir;
        out.prefDirWritable = probe_dir_writable(out.prefDir);
    } else if (non_empty(sdlPrefPath)) {
        const std::string candidate = normalize_dir(sdlPrefPath);
        if (probe_dir_writable(candidate)) {
            out.prefDir = candidate;
            out.saveDir =
                non_empty(envSave) ? normalize_dir(envSave)
                                   : join_path(out.prefDir, "save");
            out.origin = PathOrigin::SdlPrefPath;
            out.prefDirWritable = true;
        } else {
            std::fprintf(stderr,
                         "[paths] SDL pref path not writable (%s), falling back\n",
                         candidate.c_str());
        }
    }

    if (out.prefDir.empty()) {
        if (non_empty(envSave)) {
            out.prefDir = normalize_dir(envSave);
            out.saveDir = out.prefDir;
            out.origin = PathOrigin::EnvSaveDir;
            out.prefDirWritable = probe_dir_writable(out.prefDir);
        } else {
            out.prefDir = ".";
            out.saveDir = "gigahrush2_save";
            out.origin = PathOrigin::CwdFallback;
            out.prefDirWritable = probe_dir_writable(out.prefDir);
        }
    }

    if (out.prefDirWritable) {
        ensure_directory(out.saveDir);
        ensure_directory(out.light_vis_dir());
    }
    return out;
}

} // namespace

std::string AppPaths::slot_dir(int slot) const {
    char buf[32];
    std::snprintf(buf, sizeof buf, "slot%d", slot);
    return join_path(saveDir, buf);
}

std::string AppPaths::run_save(int slot) const {
    return join_path(slot_dir(slot), "run.sav");
}

std::string AppPaths::floor_save(int slot, int floor) const {
    char buf[48];
    std::snprintf(buf, sizeof buf, "floor_%d.sav", floor);
    return join_path(slot_dir(slot), buf);
}

std::string AppPaths::light_vis_dir() const {
    return join_path(saveDir, "lightvis");
}

std::string AppPaths::light_vis_file(std::uint64_t key) const {
    char buf[32];
    std::snprintf(buf, sizeof buf, "%016llx.lvc",
                  static_cast<unsigned long long>(key));
    return join_path(light_vis_dir(), buf);
}

std::string AppPaths::keybinds_file() const {
    return join_path(prefDir, "gigahrush2.keys");
}

std::string AppPaths::ui_config_file() const {
    return join_path(prefDir, "gigahrush2.ui");
}

std::string AppPaths::soak_log_file() const {
    return join_path(prefDir, "soak_log.txt");
}

std::string AppPaths::light_debug_log_file() const {
    return join_path(prefDir, "light_debug.log");
}

std::string AppPaths::prof_log_file() const {
    return join_path(prefDir, "gigahrush2_prof.txt");
}

std::string AppPaths::crash_log_file() const {
    return join_path(prefDir, "crash.log");
}

AppPaths init_app_paths(const char* cliOverride, const char* sdlPrefPath) {
    AppPaths resolved = resolve_paths(cliOverride, sdlPrefPath);
    std::lock_guard<std::mutex> lk(g_pathsMx);
    g_paths = resolved;
    g_pathsInitialized = true;
    return g_paths;
}

AppPaths app_paths() {
    std::lock_guard<std::mutex> lk(g_pathsMx);
    if (!g_pathsInitialized) {
        g_paths = resolve_paths(nullptr, nullptr);
        g_pathsInitialized = true;
    }
    return g_paths;
}

bool ensure_directory(const std::string& utf8Dir) {
    if (utf8Dir.empty() || utf8Dir == ".") return true;
    std::error_code ec;
    const std::filesystem::path p = fs_path_from_utf8(utf8Dir);
    if (std::filesystem::is_directory(p, ec)) return true;
    std::filesystem::create_directories(p, ec);
    return std::filesystem::is_directory(p, ec);
}

std::filesystem::path fs_path_from_utf8(const std::string& utf8Path) {
#ifdef _WIN32
    const std::wstring wide = utf8_to_wide(utf8Path);
    if (!wide.empty()) return std::filesystem::path(wide);
#endif
    return std::filesystem::path(utf8Path);
}

std::FILE* fopen_utf8(const std::string& utf8Path, const char* mode) {
    if (utf8Path.empty() || !mode) return nullptr;
#ifdef _WIN32
    const std::wstring wpath = utf8_to_wide(utf8Path);
    const std::wstring wmode = utf8_to_wide(mode);
    if (!wpath.empty() && !wmode.empty())
        return _wfopen(wpath.c_str(), wmode.c_str());
#endif
    return std::fopen(utf8Path.c_str(), mode);
}

const char* path_origin_name(PathOrigin origin) {
    switch (origin) {
    case PathOrigin::CliOverride: return "cli(--save-dir)";
    case PathOrigin::EnvPrefDir:  return "env(GIGA_PREF_DIR)";
    case PathOrigin::SdlPrefPath: return "SDL_GetPrefPath";
    case PathOrigin::EnvSaveDir:  return "env(GIGA_SAVE_DIR)";
    case PathOrigin::CwdFallback: return "cwd(.)";
    }
    return "unknown";
}

} // namespace giga::app
