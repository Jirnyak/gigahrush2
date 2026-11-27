#include "app/crash_log.h"

#include <atomic>
#include <csignal>
#include <cstddef>
#include <cstdint>
#include <cstring>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#else
#include <errno.h>
#include <fcntl.h>
#include <time.h>
#include <unistd.h>
#if defined(__APPLE__) || defined(__linux__)
#include <execinfo.h>
#endif
#endif

namespace giga::app {

namespace {

constexpr std::size_t kPathCap = 1024;
constexpr const char* kDefaultCrashPath = "gigahrush2_crash.log";

// Double-buffered path storage so crash_log_set_path() is lock-free with
// respect to a faulting thread reading the active slot.
struct CrashPathSlot {
    char utf8[kPathCap]{};
#ifdef _WIN32
    wchar_t wide[kPathCap]{};
    bool hasWide = false;
#endif
};

CrashPathSlot g_pathSlots[2]{};
std::atomic<int> g_activePathSlot{0};
std::atomic_flag g_pathWriteLock = ATOMIC_FLAG_INIT;

CrashBuildInfo g_buildInfo{};
std::atomic<int> g_ctxFloor{0};
std::atomic<std::uint64_t> g_ctxTick{0};
std::atomic<int> g_ctxSlot{1};
std::atomic<const char*> g_ctxPhase{"startup"};

std::atomic<int> g_inCrash{0};
std::atomic<bool> g_installed{false};

#ifdef _WIN32
LPTOP_LEVEL_EXCEPTION_FILTER g_prevFilter = nullptr;
using WinSigHandler = void (*)(int);
WinSigHandler g_prevAbrt = nullptr;
#else
constexpr std::size_t kAltStackBytes = 65536;
alignas(16) unsigned char g_altStack[kAltStackBytes]{};
stack_t g_prevAltStack{};
bool g_altStackInstalled = false;

struct SavedSig {
    int sig;
    struct sigaction prev;
    bool active;
};
SavedSig g_savedSigs[] = {
    {SIGSEGV, {}, false},
    {SIGABRT, {}, false},
    {SIGFPE,  {}, false},
    {SIGILL,  {}, false},
    {SIGBUS,  {}, false},
};
#endif

// ---- Async-signal-safe formatting buffer (zero heap, zero stdio) ----------

struct SafeBuf {
    char* data;
    std::size_t cap;
    std::size_t len;

    void put(char c) {
        if (len + 1 < cap) {
            data[len++] = c;
            data[len] = '\0';
        }
    }

    void str(const char* s) {
        if (!s) s = "(null)";
        while (*s && len + 1 < cap) {
            data[len++] = *s++;
        }
        if (cap > 0) data[len < cap ? len : cap - 1] = '\0';
    }

    void u64(std::uint64_t v) {
        char tmp[24];
        std::size_t n = 0;
        if (v == 0) {
            put('0');
            return;
        }
        while (v > 0 && n < sizeof tmp) {
            tmp[n++] = static_cast<char>('0' + (v % 10));
            v /= 10;
        }
        while (n > 0) put(tmp[--n]);
    }

    void i64(std::int64_t v) {
        if (v < 0) {
            put('-');
            const std::uint64_t uv =
                static_cast<std::uint64_t>(-(v + 1)) + 1ULL;
            u64(uv);
        } else {
            u64(static_cast<std::uint64_t>(v));
        }
    }

    void dec2(unsigned v) {
        put(static_cast<char>('0' + ((v / 10u) % 10u)));
        put(static_cast<char>('0' + (v % 10u)));
    }

    void dec3(unsigned v) {
        put(static_cast<char>('0' + ((v / 100u) % 10u)));
        put(static_cast<char>('0' + ((v / 10u) % 10u)));
        put(static_cast<char>('0' + (v % 10u)));
    }

    void dec4(unsigned v) {
        put(static_cast<char>('0' + ((v / 1000u) % 10u)));
        put(static_cast<char>('0' + ((v / 100u) % 10u)));
        put(static_cast<char>('0' + ((v / 10u) % 10u)));
        put(static_cast<char>('0' + (v % 10u)));
    }

    void hex64(std::uint64_t v, int minDigits = 16) {
        static constexpr char kHex[] = "0123456789abcdef";
        str("0x");
        char tmp[16];
        int n = 0;
        if (v == 0) {
            tmp[n++] = '0';
        } else {
            while (v > 0 && n < 16) {
                tmp[n++] = kHex[v & 0xFULL];
                v >>= 4;
            }
        }
        for (int pad = n; pad < minDigits; ++pad) put('0');
        while (n > 0) put(tmp[--n]);
    }

    void hex32(std::uint32_t v) { hex64(v, 8); }
};

void copy_cstr_bounded(char* dst, std::size_t cap, const char* src) {
    if (cap == 0) return;
    if (!src) {
        dst[0] = '\0';
        return;
    }
    std::size_t i = 0;
    while (src[i] != '\0' && i + 1 < cap) {
        dst[i] = src[i];
        ++i;
    }
    dst[i] = '\0';
}

void store_crash_path(const char* pathUtf8) {
    const char* src =
        (pathUtf8 != nullptr && *pathUtf8 != '\0') ? pathUtf8 : kDefaultCrashPath;
    while (g_pathWriteLock.test_and_set(std::memory_order_acquire)) {
    }
    const int cur = g_activePathSlot.load(std::memory_order_relaxed);
    const int next = 1 - cur;
    CrashPathSlot& dst = g_pathSlots[next];
    copy_cstr_bounded(dst.utf8, kPathCap, src);
#ifdef _WIN32
    dst.hasWide = false;
    const int wlen = MultiByteToWideChar(
        CP_UTF8, 0, dst.utf8, -1, dst.wide, static_cast<int>(kPathCap));
    if (wlen > 0) dst.hasWide = true;
#endif
    g_activePathSlot.store(next, std::memory_order_release);
    g_pathWriteLock.clear(std::memory_order_release);
}

void write_common_header(SafeBuf& b) {
    b.str("=== GIGAHRUSH 2 CRASH REPORT ===\n");
    b.str("build: ");
    b.str(g_buildInfo.version ? g_buildInfo.version : "gigahrush2");
    b.str(" (");
    b.str(g_buildInfo.buildKind ? g_buildInfo.buildKind : "unknown");
    b.str(") compiled ");
    b.str(g_buildInfo.buildDate ? g_buildInfo.buildDate : "?");
    b.put(' ');
    b.str(g_buildInfo.buildTime ? g_buildInfo.buildTime : "?");
#ifdef _WIN32
#if defined(_M_X64)
    b.str(" [Windows x64]\n");
#elif defined(_M_ARM64)
    b.str(" [Windows arm64]\n");
#else
    b.str(" [Windows]\n");
#endif
#elif defined(__APPLE__)
#if defined(__aarch64__)
    b.str(" [macOS arm64]\n");
#else
    b.str(" [macOS x86_64]\n");
#endif
#elif defined(__linux__)
    b.str(" [Linux]\n");
#else
    b.str(" [POSIX]\n");
#endif

    b.str("context: phase=");
    const char* phase = g_ctxPhase.load(std::memory_order_relaxed);
    b.str(phase ? phase : "?");
    b.str(" floor=");
    b.i64(g_ctxFloor.load(std::memory_order_relaxed));
    b.str(" sim_tick=");
    b.u64(g_ctxTick.load(std::memory_order_relaxed));
    b.str(" save_slot=");
    b.i64(g_ctxSlot.load(std::memory_order_relaxed));
    b.put('\n');
}

#ifdef _WIN32

const char* win_exception_name(DWORD code) {
    switch (code) {
    case EXCEPTION_ACCESS_VIOLATION:         return "EXCEPTION_ACCESS_VIOLATION";
    case EXCEPTION_ARRAY_BOUNDS_EXCEEDED:    return "EXCEPTION_ARRAY_BOUNDS_EXCEEDED";
    case EXCEPTION_BREAKPOINT:               return "EXCEPTION_BREAKPOINT";
    case EXCEPTION_DATATYPE_MISALIGNMENT:    return "EXCEPTION_DATATYPE_MISALIGNMENT";
    case EXCEPTION_FLT_DENORMAL_OPERAND:     return "EXCEPTION_FLT_DENORMAL_OPERAND";
    case EXCEPTION_FLT_DIVIDE_BY_ZERO:       return "EXCEPTION_FLT_DIVIDE_BY_ZERO";
    case EXCEPTION_FLT_INEXACT_RESULT:       return "EXCEPTION_FLT_INEXACT_RESULT";
    case EXCEPTION_FLT_INVALID_OPERATION:    return "EXCEPTION_FLT_INVALID_OPERATION";
    case EXCEPTION_FLT_OVERFLOW:             return "EXCEPTION_FLT_OVERFLOW";
    case EXCEPTION_FLT_STACK_CHECK:          return "EXCEPTION_FLT_STACK_CHECK";
    case EXCEPTION_FLT_UNDERFLOW:            return "EXCEPTION_FLT_UNDERFLOW";
    case EXCEPTION_ILLEGAL_INSTRUCTION:      return "EXCEPTION_ILLEGAL_INSTRUCTION";
    case EXCEPTION_IN_PAGE_ERROR:            return "EXCEPTION_IN_PAGE_ERROR";
    case EXCEPTION_INT_DIVIDE_BY_ZERO:       return "EXCEPTION_INT_DIVIDE_BY_ZERO";
    case EXCEPTION_INT_OVERFLOW:             return "EXCEPTION_INT_OVERFLOW";
    case EXCEPTION_INVALID_DISPOSITION:      return "EXCEPTION_INVALID_DISPOSITION";
    case EXCEPTION_NONCONTINUABLE_EXCEPTION: return "EXCEPTION_NONCONTINUABLE_EXCEPTION";
    case EXCEPTION_PRIV_INSTRUCTION:         return "EXCEPTION_PRIV_INSTRUCTION";
    case EXCEPTION_SINGLE_STEP:              return "EXCEPTION_SINGLE_STEP";
    case EXCEPTION_STACK_OVERFLOW:           return "EXCEPTION_STACK_OVERFLOW";
    case 0xE06D7363UL:                       return "CPP_UNHANDLED_EXCEPTION";
    default:                                 return "UNKNOWN_EXCEPTION";
    }
}

void append_win_module_offset(SafeBuf& b, std::uintptr_t addr) {
    if (addr == 0) return;
    HMODULE mod = nullptr;
    const LPCWSTR addrPtr = reinterpret_cast<LPCWSTR>(addr);
    if (!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS |
                                GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                            addrPtr, &mod) ||
        mod == nullptr) {
        return;
    }
    wchar_t modPathW[MAX_PATH]{};
    const DWORD n = GetModuleFileNameW(mod, modPathW, MAX_PATH);
    if (n == 0) return;

    const wchar_t* baseW = modPathW;
    for (DWORD i = 0; i < n; ++i) {
        if (modPathW[i] == L'\\' || modPathW[i] == L'/')
            baseW = &modPathW[i + 1];
    }
    char modUtf8[260]{};
    const int utf8Len = WideCharToMultiByte(
        CP_UTF8, 0, baseW, -1, modUtf8, static_cast<int>(sizeof modUtf8),
        nullptr, nullptr);
    if (utf8Len <= 0) return;

    const std::uintptr_t modBase = reinterpret_cast<std::uintptr_t>(mod);
    const std::uintptr_t rva = (addr >= modBase) ? (addr - modBase) : 0;
    b.str(" (");
    b.str(modUtf8);
    b.str(" + ");
    b.hex64(static_cast<std::uint64_t>(rva), 1);
    b.put(')');
}

void append_win_time(SafeBuf& b) {
    SYSTEMTIME st{};
    GetSystemTime(&st);
    b.str("time_utc: ");
    b.dec4(st.wYear);
    b.put('-');
    b.dec2(st.wMonth);
    b.put('-');
    b.dec2(st.wDay);
    b.put(' ');
    b.dec2(st.wHour);
    b.put(':');
    b.dec2(st.wMinute);
    b.put(':');
    b.dec2(st.wSecond);
    b.put('.');
    b.dec3(st.wMilliseconds);
    b.put('\n');
}

void append_win_backtrace(SafeBuf& b, ULONG skipFrames) {
    void* frames[48]{};
    const USHORT captured = CaptureStackBackTrace(
        skipFrames, static_cast<ULONG>(sizeof frames / sizeof frames[0]),
        frames, nullptr);
    b.str("stack_frames: ");
    b.u64(captured);
    b.put('\n');
    for (USHORT i = 0; i < captured; ++i) {
        const std::uintptr_t addr = reinterpret_cast<std::uintptr_t>(frames[i]);
        b.str("  #");
        b.dec2(i);
        b.put(' ');
        b.hex64(static_cast<std::uint64_t>(addr));
        append_win_module_offset(b, addr);
        b.put('\n');
    }
}

void write_win_report(const char* buf, std::size_t len) {
    const CrashPathSlot& slot =
        g_pathSlots[g_activePathSlot.load(std::memory_order_acquire)];
    HANDLE hFile = INVALID_HANDLE_VALUE;
    if (slot.hasWide) {
        hFile = CreateFileW(slot.wide, GENERIC_WRITE, FILE_SHARE_READ, nullptr,
                            CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    }
    if (hFile == INVALID_HANDLE_VALUE && slot.utf8[0] != '\0') {
        hFile = CreateFileA(slot.utf8, GENERIC_WRITE, FILE_SHARE_READ, nullptr,
                            CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    }
    if (hFile != INVALID_HANDLE_VALUE) {
        DWORD written = 0;
        WriteFile(hFile, buf, static_cast<DWORD>(len), &written, nullptr);
        FlushFileBuffers(hFile);
        CloseHandle(hFile);
    }

    HANDLE hErr = GetStdHandle(STD_ERROR_HANDLE);
    if (hErr != INVALID_HANDLE_VALUE && hErr != nullptr) {
        DWORD written = 0;
        WriteFile(hErr, buf, static_cast<DWORD>(len), &written, nullptr);
    }
}

LONG WINAPI win_exception_filter(EXCEPTION_POINTERS* ep) {
    if (g_inCrash.exchange(1, std::memory_order_acq_rel) != 0)
        return EXCEPTION_EXECUTE_HANDLER;

    char report[8192];
    SafeBuf b{report, sizeof report, 0};
    write_common_header(b);
    append_win_time(b);

    if (ep && ep->ExceptionRecord) {
        const EXCEPTION_RECORD* er = ep->ExceptionRecord;
        const std::uintptr_t faultAddr =
            reinterpret_cast<std::uintptr_t>(er->ExceptionAddress);
        b.str("exception: ");
        b.str(win_exception_name(er->ExceptionCode));
        b.str(" (code=");
        b.hex32(static_cast<std::uint32_t>(er->ExceptionCode));
        b.str(")\n");
        b.str("address: ");
        b.hex64(static_cast<std::uint64_t>(faultAddr));
        append_win_module_offset(b, faultAddr);
        b.put('\n');

        if ((er->ExceptionCode == EXCEPTION_ACCESS_VIOLATION ||
             er->ExceptionCode == EXCEPTION_IN_PAGE_ERROR) &&
            er->NumberParameters >= 2) {
            const ULONG_PTR kind = er->ExceptionInformation[0];
            b.str("access: ");
            b.str(kind == 0 ? "read" : (kind == 1 ? "write" : "execute"));
            b.str(" at ");
            b.hex64(static_cast<std::uint64_t>(er->ExceptionInformation[1]));
            b.put('\n');
        }
    }

    if (ep && ep->ContextRecord) {
        const CONTEXT* ctx = ep->ContextRecord;
#if defined(_M_X64)
        b.str("regs: rip=");
        b.hex64(ctx->Rip);
        b.str(" rsp=");
        b.hex64(ctx->Rsp);
        b.str(" rbp=");
        b.hex64(ctx->Rbp);
        b.put('\n');
#elif defined(_M_ARM64)
        b.str("regs: pc=");
        b.hex64(ctx->Pc);
        b.str(" sp=");
        b.hex64(ctx->Sp);
        b.str(" lr=");
        b.hex64(ctx->Lr);
        b.put('\n');
#elif defined(_M_IX86)
        b.str("regs: eip=");
        b.hex32(ctx->Eip);
        b.str(" esp=");
        b.hex32(ctx->Esp);
        b.str(" ebp=");
        b.hex32(ctx->Ebp);
        b.put('\n');
#endif
    }

    append_win_backtrace(b, 0);
    write_win_report(b.data, b.len);

    if (g_prevFilter) return g_prevFilter(ep);
    return EXCEPTION_EXECUTE_HANDLER;
}

void win_abort_handler(int sig) {
    if (g_inCrash.exchange(1, std::memory_order_acq_rel) != 0) {
        std::signal(sig, SIG_DFL);
        std::raise(sig);
        return;
    }

    char report[8192];
    SafeBuf b{report, sizeof report, 0};
    write_common_header(b);
    append_win_time(b);
    b.str("signal: SIGABRT (");
    b.i64(sig);
    b.str(")\n");
    append_win_backtrace(b, 1);
    write_win_report(b.data, b.len);

    std::signal(sig, SIG_DFL);
    std::raise(sig);
}

#else

const char* posix_signal_name(int sig) {
    switch (sig) {
    case SIGSEGV: return "SIGSEGV";
    case SIGABRT: return "SIGABRT";
    case SIGFPE:  return "SIGFPE";
    case SIGILL:  return "SIGILL";
    case SIGBUS:  return "SIGBUS";
    default:      return "UNKNOWN_SIGNAL";
    }
}

void write_all_fd(int fd, const char* buf, std::size_t len) {
    std::size_t off = 0;
    while (off < len) {
        const ssize_t n = ::write(fd, buf + off, len - off);
        if (n > 0) {
            off += static_cast<std::size_t>(n);
        } else if (n < 0 && errno == EINTR) {
            continue;
        } else {
            break;
        }
    }
}

void append_posix_time(SafeBuf& b) {
    struct timespec ts{};
    if (clock_gettime(CLOCK_REALTIME, &ts) == 0) {
        b.str("epoch_sec: ");
        b.i64(static_cast<std::int64_t>(ts.tv_sec));
        b.put('\n');
    }
}

void posix_signal_handler(int sig, siginfo_t* info, void* /*uctx*/) {
    if (g_inCrash.exchange(1, std::memory_order_acq_rel) == 0) {
        char report[8192];
        SafeBuf b{report, sizeof report, 0};
        write_common_header(b);
        append_posix_time(b);

        b.str("signal: ");
        b.str(posix_signal_name(sig));
        b.str(" (");
        b.i64(sig);
        b.str(")\n");
        if (info) {
            b.str("si_code: ");
            b.i64(info->si_code);
            b.str(" si_addr: ");
            b.hex64(static_cast<std::uint64_t>(
                reinterpret_cast<std::uintptr_t>(info->si_addr)));
            b.put('\n');
        }

#if defined(__APPLE__) || defined(__linux__)
        void* frames[48]{};
        const int nFrames = backtrace(
            frames, static_cast<int>(sizeof frames / sizeof frames[0]));
        b.str("stack_frames: ");
        b.i64(nFrames);
        b.put('\n');
        for (int i = 0; i < nFrames; ++i) {
            const std::uintptr_t addr =
                reinterpret_cast<std::uintptr_t>(frames[i]);
            b.str("  #");
            b.dec2(static_cast<unsigned>(i));
            b.put(' ');
            b.hex64(static_cast<std::uint64_t>(addr));
            b.put('\n');
        }
#endif

        const CrashPathSlot& slot =
            g_pathSlots[g_activePathSlot.load(std::memory_order_acquire)];
        const char* path =
            (slot.utf8[0] != '\0') ? slot.utf8 : kDefaultCrashPath;
        const int fd =
            ::open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
        if (fd >= 0) {
            write_all_fd(fd, b.data, b.len);
#if defined(__APPLE__) || defined(__linux__)
            if (nFrames > 0) {
                static constexpr char kSymHdr[] = "--- symbols ---\n";
                write_all_fd(fd, kSymHdr, sizeof(kSymHdr) - 1);
                backtrace_symbols_fd(frames, nFrames, fd);
            }
#endif
            ::close(fd);
        }

        write_all_fd(STDERR_FILENO, b.data, b.len);
#if defined(__APPLE__) || defined(__linux__)
        if (nFrames > 0) {
            backtrace_symbols_fd(frames, nFrames, STDERR_FILENO);
        }
#endif
    }

    struct sigaction dfl{};
    dfl.sa_handler = SIG_DFL;
    sigemptyset(&dfl.sa_mask);
    sigaction(sig, &dfl, nullptr);
    raise(sig);
}

#endif

} // namespace

void crash_log_install(const char* crashLogPathUtf8,
                       const CrashBuildInfo& build) {
    g_buildInfo = build;
    store_crash_path(crashLogPathUtf8);

    if (g_installed.exchange(true, std::memory_order_acq_rel)) return;
    g_inCrash.store(0, std::memory_order_release);

#ifdef _WIN32
    ULONG guarantee = 32768;
    SetThreadStackGuarantee(&guarantee);
    g_prevFilter = SetUnhandledExceptionFilter(&win_exception_filter);
    g_prevAbrt = std::signal(SIGABRT, &win_abort_handler);
#else
#if defined(__APPLE__) || defined(__linux__)
    // Pre-warm libgcc_s / unwinder on normal thread before any signal fault.
    void* warm[2]{};
    const int warmN = backtrace(warm, 2);
    (void)warmN;
#endif
    stack_t ss{};
    ss.ss_sp = g_altStack;
    ss.ss_size = kAltStackBytes;
    ss.ss_flags = 0;
    if (sigaltstack(&ss, &g_prevAltStack) == 0) {
        g_altStackInstalled = true;
    }

    struct sigaction sa{};
    sa.sa_sigaction = &posix_signal_handler;
    sigemptyset(&sa.sa_mask);
    for (const SavedSig& s : g_savedSigs) sigaddset(&sa.sa_mask, s.sig);
    sa.sa_flags = SA_SIGINFO | SA_RESETHAND;
    if (g_altStackInstalled) sa.sa_flags |= SA_ONSTACK;

    for (SavedSig& s : g_savedSigs) {
        if (sigaction(s.sig, &sa, &s.prev) == 0) s.active = true;
    }
#endif
}

void crash_log_set_path(const char* crashLogPathUtf8) {
    store_crash_path(crashLogPathUtf8);
}

void crash_log_set_context(int floorNumber,
                           std::uint64_t simTick,
                           int saveSlot,
                           const char* phaseLiteral) {
    g_ctxFloor.store(floorNumber, std::memory_order_relaxed);
    g_ctxTick.store(simTick, std::memory_order_relaxed);
    g_ctxSlot.store(saveSlot, std::memory_order_relaxed);
    g_ctxPhase.store(phaseLiteral ? phaseLiteral : "unknown",
                     std::memory_order_relaxed);
}

const char* crash_log_path() {
    const CrashPathSlot& slot =
        g_pathSlots[g_activePathSlot.load(std::memory_order_acquire)];
    return (slot.utf8[0] != '\0') ? slot.utf8 : kDefaultCrashPath;
}

void crash_log_uninstall() {
    if (!g_installed.exchange(false, std::memory_order_acq_rel)) return;
#ifdef _WIN32
    SetUnhandledExceptionFilter(g_prevFilter);
    g_prevFilter = nullptr;
    if (g_prevAbrt != SIG_ERR) {
        std::signal(SIGABRT, g_prevAbrt);
        g_prevAbrt = nullptr;
    }
#else
    for (SavedSig& s : g_savedSigs) {
        if (s.active) {
            sigaction(s.sig, &s.prev, nullptr);
            s.active = false;
        }
    }
    if (g_altStackInstalled) {
        sigaltstack(&g_prevAltStack, nullptr);
        g_altStackInstalled = false;
    }
#endif
    g_inCrash.store(0, std::memory_order_release);
}

} // namespace giga::app
