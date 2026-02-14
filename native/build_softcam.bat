@echo off
chcp 65001 >nul
call "E:\vs2022\VC\Auxiliary\Build\vcvarsall.bat" x64
E:
cd "E:\软开\网络手机摄像头串流\native\softcam"
echo Current dir: %CD%
msbuild softcam.sln /p:Configuration=Release /p:Platform=x64 /m
echo BUILD_EXIT_CODE=%ERRORLEVEL%
