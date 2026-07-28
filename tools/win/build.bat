@echo off
setlocal EnableDelayedExpansion
rem ---------------------------------------------------------------------------
rem gigahrush2 — Windows build entry point (MSVC + Ninja + LunarG Vulkan SDK).
rem
rem The project's primary platform is macOS/Clang; this script is the Windows
rem equivalent of the three commands in README.md. It locates MSVC via vswhere,
rem enters the x64 developer environment, configures with Ninja, builds, and
rem runs the headless tests.
rem
rem   tools\win\build.bat                  configure + build + test (Release)
rem   tools\win\build.bat Debug            same, Debug
rem   tools\win\build.bat Release notest   skip ctest
rem   tools\win\build.bat Release fresh    wipe the build dir first
rem
rem Requirements (see tools\win\README.md):
rem   - VS 2022 Build Tools or VS with the "Desktop development with C++" workload
rem   - Windows SDK
rem   - LunarG Vulkan SDK  (provides vulkan-1.lib and glslc.exe)
rem   - CMake >= 3.21 and Ninja  (found automatically if not on PATH)
rem SDL3, EnTT and Dear ImGui are fetched and pinned by CMake — nothing to install.
rem
rem Batch note: %ProgramFiles(x86)% is hoisted into PF86 here, at top level. The
rem "(x86)" contains a literal ")" which silently terminates any parenthesised
rem if/for block it is expanded inside — the classic trap that makes this script
rem look like it found MSVC and then fail on the next line.
rem ---------------------------------------------------------------------------

set "PF86=%ProgramFiles(x86)%"
set "PF=%ProgramFiles%"

set "CONFIG=%~1"
if "%CONFIG%"=="" set "CONFIG=Release"
set "OPT2=%~2"

set "REPO=%~dp0..\.."
pushd "%REPO%" || exit /b 1
set "BUILD=%CD%\build-win"

call :find_msvc  || goto :fail
call :find_vulkan || goto :fail
call :find_tool cmake "%PF%\CMake\bin" || goto :fail
call :find_tool ninja ""               || goto :fail

if /i "%OPT2%"=="fresh" if exist "%BUILD%" rmdir /s /q "%BUILD%"

echo [giga] Configuring %CONFIG% -^> %BUILD%
cmake -S . -B "%BUILD%" -G Ninja -DCMAKE_BUILD_TYPE=%CONFIG% || (
    echo [giga] CONFIGURE FAILED & goto :fail
)
echo [giga] Building
cmake --build "%BUILD%" --parallel || (
    echo [giga] BUILD FAILED & goto :fail
)

if /i "%OPT2%"=="notest" goto :done
echo [giga] Testing
ctest --test-dir "%BUILD%" --output-on-failure || (
    echo [giga] TESTS FAILED & goto :fail
)

:done
echo [giga] OK — %BUILD%\gigahrush2.exe
popd & endlocal & exit /b 0

:fail
popd & endlocal & exit /b 1


rem ===========================================================================
rem Subroutines. Kept out of parenthesised blocks on purpose — see the batch
rem note above; `for /f` over a path containing "(x86)" is not block-safe.
rem ===========================================================================

:find_msvc
if defined VCINSTALLDIR exit /b 0
set "VSWHERE=%PF86%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" echo [giga] ERROR: vswhere.exe not found. Install Visual Studio Build Tools. & exit /b 1
set "VSPATH="
for /f "usebackq delims=" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSPATH=%%i"
if not defined VSPATH echo [giga] ERROR: no VS install carries the C++ x64 toolset. Add workload Microsoft.VisualStudio.Workload.VCTools. & exit /b 1
if not exist "%VSPATH%\VC\Auxiliary\Build\vcvars64.bat" echo [giga] ERROR: vcvars64.bat missing under %VSPATH% & exit /b 1
call "%VSPATH%\VC\Auxiliary\Build\vcvars64.bat" >nul
rem Probe for cl.exe rather than trusting the exit code. vcvars64.bat reports
rem success while producing an unusable environment when the Windows SDK is
rem absent -- the workload can be installed without it. Verify, don't trust.
where cl >nul 2>&1
if errorlevel 1 echo [giga] ERROR: vcvars64 ran but cl.exe is not on PATH. The Windows SDK is probably missing: winget install Microsoft.WindowsSDK.10.0.26100 & exit /b 1
echo [giga] MSVC: %VSPATH%
exit /b 0

:find_vulkan
if not defined VULKAN_SDK call :newest_vulkan
if not exist "%VULKAN_SDK%\Bin\glslc.exe" echo [giga] ERROR: Vulkan SDK not usable (VULKAN_SDK=%VULKAN_SDK%). winget install KhronosGroup.VulkanSDK & exit /b 1
echo [giga] Vulkan SDK: %VULKAN_SDK%
exit /b 0

rem Newest SDK by *version*, not by name. `dir /o-n` sorts lexicographically,
rem where 1.4.99.0 would beat 1.4.350.0 because '9' > '3'. Each component is
rem zero-padded to 4 digits to build a sortable key, so the comparison is
rem numeric per component. Pure batch on purpose: a PowerShell one-liner here
rem needs a pipe, and a pipe inside for/f-backquote quoting is a minefield.
:newest_vulkan
if not exist "C:\VulkanSDK" exit /b 0
set "VKBEST="
for /d %%d in ("C:\VulkanSDK\*") do call :vk_consider "%%~nxd"
exit /b 0

:vk_consider
set "P1=0" & set "P2=0" & set "P3=0" & set "P4=0"
for /f "tokens=1-4 delims=." %%a in ("%~1") do set "P1=%%a" & set "P2=%%b" & set "P3=%%c" & set "P4=%%d"
set "K1=000%P1%" & set "K2=000%P2%" & set "K3=000%P3%" & set "K4=000%P4%"
set "VKKEY=!K1:~-4!!K2:~-4!!K3:~-4!!K4:~-4!"
if "!VKKEY!" gtr "!VKBEST!" set "VKBEST=!VKKEY!" & set "VULKAN_SDK=C:\VulkanSDK\%~1"
exit /b 0

rem :find_tool <exe-name> <extra-dir-to-try>
rem Adds the tool's directory to PATH if it is not already resolvable. Searches
rem the caller-supplied hint first, then the WinGet package tree, because a
rem freshly-installed tool is not on the PATH of an already-running shell.
:find_tool
where %1 >nul 2>&1 && exit /b 0
if not "%~2"=="" if exist "%~2\%1.exe" set "PATH=%~2;%PATH%" & echo [giga] %1: %~2 & exit /b 0
set "FOUND="
for /f "delims=" %%n in ('dir /b /s "%LOCALAPPDATA%\Microsoft\WinGet\Packages\%1.exe" 2^>nul') do if not defined FOUND set "FOUND=%%~dpn"
if defined FOUND set "PATH=%FOUND%;%PATH%" & echo [giga] %1: %FOUND% & exit /b 0
echo [giga] ERROR: %1 not found on PATH. Install it (winget) and re-run.
exit /b 1
