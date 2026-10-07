@echo off
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul || exit /b 1
if not exist out mkdir out
cl /nologo /std:c++17 /O2 /EHsc /W3 /LD vcam_source.cpp /Fe:out\lightup_vcam.dll /Fo:out\ /link /DEF:vcam_source.def mfplat.lib mf.lib mfuuid.lib mfsensorgroup.lib ole32.lib strmiids.lib uuid.lib advapi32.lib || exit /b 1
cl /nologo /std:c++17 /O2 /EHsc /W3 setup.cpp /Fe:out\lightup_setup.exe /Fo:out\ /link mfplat.lib mf.lib mfuuid.lib mfsensorgroup.lib ole32.lib shell32.lib advapi32.lib || exit /b 1
cl /nologo /O2 /W3 feed.cpp /Fe:out\lightup_feed.exe /Fo:out\ || exit /b 1
echo BUILD OK
