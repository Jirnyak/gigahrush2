// UTF-8 file I/O helpers for src/render (independent of src/app).
#pragma once

#include <cstdio>
#include <filesystem>
#include <string>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#endif

namespace giga::gpu {

#ifdef _WIN32
inline std::wstring utf8_to_wide(const std::string& utf8) {
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

inline std::filesystem::path fs_path_from_utf8(const std::string& utf8Path) {
#ifdef _WIN32
    const std::wstring wide = utf8_to_wide(utf8Path);
    if (!wide.empty()) return std::filesystem::path(wide);
#endif
    return std::filesystem::path(utf8Path);
}

inline std::filesystem::path fs_path_from_utf8(const char* utf8Path) {
    return utf8Path ? fs_path_from_utf8(std::string(utf8Path))
                    : std::filesystem::path{};
}

inline std::FILE* fopen_utf8(const std::string& utf8Path, const char* mode) {
    if (utf8Path.empty() || !mode) return nullptr;
#ifdef _WIN32
    const std::wstring wpath = utf8_to_wide(utf8Path);
    const std::wstring wmode = utf8_to_wide(mode);
    if (!wpath.empty() && !wmode.empty())
        return _wfopen(wpath.c_str(), wmode.c_str());
#endif
    return std::fopen(utf8Path.c_str(), mode);
}

inline std::FILE* fopen_utf8(const char* utf8Path, const char* mode) {
    return utf8Path ? fopen_utf8(std::string(utf8Path), mode) : nullptr;
}

} // namespace giga::gpu
