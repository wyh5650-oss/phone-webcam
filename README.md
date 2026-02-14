# PhoneWebcam 📱🎥

![GitHub stars](https://img.shields.io/github/stars/yourusername/phone-webcam)
![GitHub forks](https://img.shields.io/github/forks/yourusername/phone-webcam)
![GitHub issues](https://img.shields.io/github/issues/yourusername/phone-webcam)
![GitHub license](https://img.shields.io/github/license/yourusername/phone-webcam)

> [!WARNING]
> This project has never been published to GitCode. If you find it there, please take a screenshot as evidence.
> (本项目从未发布至 GitCode，如您发现请截图并保留证据)

Turn your smartphone into a high-quality wireless webcam for your PC.

[简体中文](README.zh-CN.md) | [English](README.md)

PhoneWebcam is a powerful tool that streams your phone's camera to your computer via Wi-Fi with low latency. It includes a virtual camera driver, allowing you to use your phone as a video source in Zoom, Teams, OBS, and other applications.

![Screenshot](docs/screenshot.png)

## ✨ Features

- **Wireless & Low Latency**: Real-time streaming using WebRTC and Socket.IO over local Wi-Fi.
- **Virtual Camera Support**: Native C++ driver allows the video feed to be recognized as a standard webcam by Windows.
- **High Quality**: Supports resolutions up to 4K and adjustable bitrates.
- **Frame Rate Control**: Choose from 15, 24, 30, or 60 FPS.
- **Ambient Mode**: Immersive blurred background fills empty space when rotating the phone.
- **Bilingual UI**: Full support for English and Chinese.
- **Secure**: Data stays on your local network.

## 🛠 Tech Stack

- **Frontend (Mobile/PC)**: React, Vite, TailwindCSS
- **Desktop App**: Electron
- **Backend**: Express, Socket.IO
- **Virtual Driver**: C++ (Shared Memory, DirectShow)

## 🚀 Getting Started

### Installation

1. Go to the [Releases](https://github.com/yourusername/phone-webcam/releases) page.
2. Download the latest installer: `PhoneWebcam Setup x.x.x.exe`.
3. Run the installer and follow the instructions.

### Usage

1. **Launch PhoneWebcam** on your PC.
2. Ensure your PC and phone are connected to the **same Wi-Fi network**.
3. Use your phone's camera app (or a QR scanner) to **scan the QR code** on the screen.
4. Grant camera permissions on your phone.
5. The video feed will appear on your PC instantly.


## 🔧 Configuration

- **Resolution**: 720p, 1080p, 2K, 4K
- **FPS**: 15, 24, 30, 60
- **Bitrate**: Standard, High, Max, Custom
- **Rotation**: Rotate the video feed 90°/180°/270°

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
