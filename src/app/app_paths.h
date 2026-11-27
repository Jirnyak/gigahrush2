// Runtime user-writable paths for saves, lightvis cache, keybinds, UI config,
// soak/debug logs, and crash reports.
//
// Resolves through SDL_GetPrefPath (passed from main after SDL_Init or before)
// so launching from Finder/Explorer or any arbitrary CWD works instead of
// failing on read-only working directories. Supports deterministic overrides
// (--save-dir / GIGA_PREF_DIR / GIGA_SAVE_DIR) for tests and --shot harnesses.
#pragma once

#include <cstdint>
#include <cstdio>
#include <filesystem>
#include <string>

namespace giga::app {

enum class PathOrigin : std::uint8_t {
    CliOverride = 0, // --save-dir / --pref-dir
    EnvPrefDir,      // GIGA_PREF_DIR
    SdlPrefPath,     // SDL_GetPrefPath("TenevikGames", "gigahrush2")
    EnvSaveDir,      // GIGA_SAVE_DIR fallback when SDL pref unavailable
    CwdFallback,     // "." fallback (headless / SDL failure)
};

struct AppPaths {
    std::string prefDir;     // Root for keys, UI cfg, logs, and crash report
    std::string saveDir;     // Root for slot<N>/ and lightvis/
    PathOrigin origin = PathOrigin::CwdFallback;
    bool prefDirWritable = false;

    std::string slot_dir(int slot) const;
    std::string run_save(int slot) const;
    std::string floor_save(int slot, int floor) const;
    std::string light_vis_dir() const;
    std::string light_vis_file(std::uint64_t key) const;
    std::string keybinds_file() const;
    std::string ui_config_file() const;
    std::string soak_log_file() const;
    std::string light_debug_log_file() const;
    std::string prof_log_file() const;
    std::string crash_log_file() const;
};

// Initialize and store the process-wide path configuration.
// Precedence for prefDir:
//   1. cliOverride (--save-dir / --pref-dir)
//   2. GIGA_PREF_DIR environment variable
//   3. sdlPrefPath (from SDL_GetPrefPath, if non-null/non-empty & writable)
//   4. GIGA_SAVE_DIR environment variable
//   5. "." (CWD fallback)
// Precedence for saveDir:
//   - When cliOverride or GIGA_PREF_DIR is active: <prefDir>/save (full test isolation).
//   - Else if GIGA_SAVE_DIR is set: GIGA_SAVE_DIR.
//   - Else if SdlPrefPath is active: <prefDir>/save.
//   - Else (CwdFallback): "gigahrush2_save".
// Safe to call multiple times (e.g., early fallback before SDL, then after
// SDL_GetPrefPath). Thread-safe.
AppPaths init_app_paths(const char* cliOverride, const char* sdlPrefPath);

// Returns a snapshot of the active path configuration. If init_app_paths has
// not been called yet, lazily initializes from environment / CWD.
AppPaths app_paths();

// Creates directory and parents without throwing. Returns true if the target
// exists as a directory afterward.
bool ensure_directory(const std::string& utf8Dir);

// Converts a UTF-8 path string to std::filesystem::path (handling UTF-8 -> UTF-16
// on Windows so non-ASCII usernames resolve correctly).
std::filesystem::path fs_path_from_utf8(const std::string& utf8Path);

// Opens a UTF-8 path with std::FILE* (uses _wfopen on Windows; std::fopen on POSIX).
std::FILE* fopen_utf8(const std::string& utf8Path, const char* mode);

// Human-readable label for PathOrigin.
const char* path_origin_name(PathOrigin origin);

} // namespace giga::app
