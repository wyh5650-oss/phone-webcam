@echo off
chcp 65001 >nul
call "E:\vs2022\VC\Auxiliary\Build\vcvarsall.bat" x64
E:
cd "E:\软开\网络手机摄像头串流\native"
echo Compiling vcam_helper.dll...
cl /O2 /LD /Fe:vcam_helper.dll vcam_helper.c
echo BUILD_EXIT_CODE=%ERRORLEVEL%
