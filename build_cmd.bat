call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
cmake -B build-win -G "Visual Studio 17 2022" -A x64
cmake --build build-win --config Release
