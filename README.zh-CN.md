# 电脑手机虚拟摄像头

![GitHub stars](https://img.shields.io/github/stars/yourusername/phone-webcam)
![GitHub forks](https://img.shields.io/github/forks/yourusername/phone-webcam)
![GitHub issues](https://img.shields.io/github/issues/yourusername/phone-webcam)
![GitHub license](https://img.shields.io/github/license/yourusername/phone-webcam)

> [!WARNING]
> 本项目从未发布至 GitCode，如您发现请截图并保留证据

将您的智能手机变成电脑的高清无线网络摄像头。

[English](README.md) | [简体中文](README.zh-CN.md)

PhoneWebcam 是一款强大的工具，可以通过 Wi-Fi 将手机画面低延迟地传输到电脑。它内置了虚拟摄像头驱动，让您可以在 Zoom、Teams、OBS 等软件中直接使用手机画面作为视频源。

## ✨主要功能

- **无线低延迟**：通过 WebRTC 和 Socket.IO 在局域网内进行实时传输。
- **虚拟摄像头支持**：原生 C++ 驱动支持，系统可识别为标准摄像头设备。
- **高清画质**：支持最高 4K 分辨率和自定义码率调节。
- **帧率控制**：支持 15/24/30/60 FPS 切换。
- **双语界面**：完全支持中文和英文。
- **安全隐私**：所有数据仅在本地局域网传输，不上传云端。

## 🛠 技术栈

- **前端 (手机/PC)**: React, Vite, TailwindCSS
- **桌面端**: Electron
- **后端**: Express, Socket.IO
- **虚拟驱动**: C++ (共享内存, DirectShow)

## 🚀 快速开始

### 安装说明

1. 访问 [Releases](https://github.com/yourusername/phone-webcam/releases) 页面。
2. 下载最新的安装包：`PhoneWebcam Setup x.x.x.exe`。
3. 双击运行安装包并完成安装。

### 使用指南

1. 在电脑上**启动 PhoneWebcam**。
2. 确保您的手机和电脑连接到了**同一个 Wi-Fi 网络**。
3. 使用手机相机（或扫码应用）**扫描屏幕上的二维码**。
4. 在手机上允许摄像头权限。
5. 视频画面将立即显示在电脑上。


## 🔧 配置选项

- **分辨率**: 720p, 1080p, 2K, 4K
- **帧率**: 15, 24, 30, 60
- **码率**: 标准, 高画质, 最高画质, 自定义
- **旋转**: 视频画面旋转 90°/180°/270°

## 📄 许可证

本项目采用 MIT 许可证 - 详情请参阅 [LICENSE](LICENSE) 文件。
