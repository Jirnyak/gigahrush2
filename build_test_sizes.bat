@echo off
call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvarsall.bat" x64 >nul
cl /EHsc /I src /I . test_sizes.cpp src\game\save.cpp src\game\craft.cpp src\game\quest.cpp src\game\save_rpg.cpp
if %ERRORLEVEL% equ 0 (
    test_sizes.exe
)
