// Standalone fatal crash handler (Windows SEH + POSIX signals) writing an
// async-signal-safe crash report (fault reason, address, stack trace, build
// stamp, and lightweight engine context) to pref-dir/crash.log and stderr.
//
// Zero C++ exceptions, zero RTTI, zero heap allocations inside fault handlers.
#pragma once

#include <cstdint>

namespace giga::app {

struct CrashBuildInfo {
    const char* version = "gigahrush2";
    const char* buildKind = "unknown";
    const char* buildDate = __DATE__;
    const char* buildTime = __TIME__;
};

// Installs fatal fault handlers:
//   - Windows: SetUnhandledExceptionFilter (+ SetThreadStackGuarantee) and SIGABRT.
//   - POSIX:   sigaction (SA_SIGINFO | SA_ONSTACK | SA_RESETHAND) on alternate
//              signal stack for SIGSEGV, SIGABRT, SIGFPE, SIGILL, SIGBUS.
// `crashLogPathUtf8`: full UTF-8 path to the output file (e.g.
// app_paths().crash_log_file().c_str()). Falls back to "gigahrush2_crash.log"
// if nullptr or empty.
void crash_log_install(const char* crashLogPathUtf8,
                       const CrashBuildInfo& build = {});

// Updates the destination path without reinstalling handlers (e.g., once
// SDL_GetPrefPath resolves after early startup).
void crash_log_set_path(const char* crashLogPathUtf8);

// Updates lightweight runtime context included in crash reports.
// Lock-free (atomics only). `phaseLiteral` must point to static storage
// (e.g. "init", "menu", "playing", "lift", "shot").
void crash_log_set_context(int floorNumber,
                           std::uint64_t simTick,
                           int saveSlot,
                           const char* phaseLiteral);

// Returns the active UTF-8 crash log path.
const char* crash_log_path();

// Restores default signal/exception handlers (primarily for unit tests).
void crash_log_uninstall();

} // namespace giga::app
