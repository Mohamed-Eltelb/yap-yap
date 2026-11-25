@echo off
rem Builds Yap Yap's Windows helpers with the Visual Studio C++ build tools:
rem   yapyap-keys.dll  the keyboard hook (keyhook.cpp)
rem   yapyap-text.dll  the selection reader (selection.cpp)
rem Each is built on its own, so one that a running Yap Yap keeps locked doesn't stop the other.
setlocal
for /f "usebackq delims=" %%i in (`"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set VS=%%i
if not defined VS (echo Visual Studio C++ build tools not found & exit /b 1)
set "PATH=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer;%PATH%"
call "%VS%\VC\Auxiliary\Build\vcvars64.bat" >nul || exit /b 1
cd /d "%~dp0"
if not exist build mkdir build
set FAILED=
cl /nologo /LD /EHsc /O2 /MT /std:c++17 keyhook.cpp user32.lib /Fo:build\ /Fe:build\yapyap-keys.dll /link /NOIMPLIB /NOEXP || set FAILED=1
cl /nologo /LD /EHsc /O2 /MT /std:c++17 selection.cpp ole32.lib oleaut32.lib user32.lib /Fo:build\ /Fe:build\yapyap-text.dll /link /NOIMPLIB /NOEXP || set FAILED=1
del /q build\*.obj 2>nul
if defined FAILED exit /b 1
