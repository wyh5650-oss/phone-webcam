const express = require('express');
const https = require('https');
const selfsigned = require('selfsigned');
const { Server } = require('socket.io');
const os = require('os');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');


const app = express();
app.use(cors());

// 生成自签名证书
const attrs = [{ name: 'commonName', value: 'PhoneWebcam' }];
const pems = selfsigned.generate(attrs, { days: 365 });

// 获取局域网 IP
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    const addresses = [];

    for (const [name, match] of Object.entries(interfaces)) {
        // 过滤掉虚拟机的网卡 (VMware, VirtualBox, vEthernet)
        if (name.toLowerCase().includes('vmware') ||
            name.toLowerCase().includes('virtualbox') ||
            name.toLowerCase().includes('vethernet')) {
            continue;
        }

        for (const iface of match) {
            // 只取 IPv4，非内部地址
            if (iface.family === 'IPv4' && !iface.internal) {
                addresses.push(iface.address);
            }
        }
    }

    console.log('Available LAN IPs:', addresses);

    // 优先寻找常见的局域网段
    const optimal = addresses.find(ip => ip.startsWith('192.168.'));
    if (optimal) return optimal;

    const ten = addresses.find(ip => ip.startsWith('10.'));
    if (ten) return ten;

    const oneSevenTwo = addresses.find(ip => ip.startsWith('172.'));
    if (oneSevenTwo) return oneSevenTwo;

    // 如果都没有，返回第一个找到的非内部 IP 或 localhost
    return addresses.length > 0 ? addresses[0] : '127.0.0.1';
}

const PORT = 3000;

// 创建 HTTPS 服务器
const httpsServer = https.createServer({
    key: pems.private,
    cert: pems.cert
}, app);

// Socket.io 设置
const io = new Server(httpsServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// 信令逻辑
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // 区分角色：sender (手机), receiver (PC)
    socket.on('join', (role) => {
        socket.join(role);
        console.log(`${socket.id} joined as ${role}`);

        // 如果接入的是 sender，通知 receiver 有人来了（可选）
        if (role === 'sender') {
            socket.to('receiver').emit('sender-joined', socket.id);
        }
    });

    // WebRTC 信令转发
    socket.on('offer', (data) => {
        console.log(`Relaying offer from ${socket.id}`);
        socket.to('receiver').emit('offer', data);
    });

    socket.on('answer', (data) => {
        console.log(`Relaying answer from ${socket.id}`);
        socket.to('sender').emit('answer', data);
    });

    socket.on('ice-candidate', (data) => {
        const target = data.target;
        // console.log(`Relaying ICE candidate from ${socket.id} to ${target}`);
        socket.to(target).emit('ice-candidate', data.candidate);
    });

    // 画质切换信令
    socket.on('quality-change', (data) => {
        console.log(`Relaying quality-change to sender: ${data.resolution}`);
        socket.to('sender').emit('quality-change', data);
    });

    // 语言同步信令
    socket.on('language-change', (lang) => {
        console.log(`Relaying language-change: ${lang}`);
        socket.broadcast.emit('language-change', lang);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

// 启动服务器函数
function runServer(isPackaged, staticPath, callback) {
    // 代理配置：将非 API 请求转发给 Vite 开发服务器
    const isDev = !isPackaged;

    if (isDev) {
        app.use('/', createProxyMiddleware({
            target: 'http://localhost:5173',
            changeOrigin: true,
            ws: true, // 支持 WebSocket (HMR)
            logLevel: 'error',
            onError: (err, req, res) => {
                // 静默处理 ECONNRESET（HMR 连接断开时触发）
                if (err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED') return;
                console.error('[Proxy Error]', err.message);
            }
        }));
    } else {
        // 生产环境托管构建文件
        // staticPath 传入的是 dist 目录的绝对路径
        app.use(express.static(staticPath));
        app.get('*', (req, res) => {
            res.sendFile(path.join(staticPath, 'index.html'));
        });
    }

    // 防止未捕获的连接错误导致进程崩溃
    process.on('uncaughtException', (err) => {
        if (err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED' || err.code === 'EPIPE') {
            // 网络连接中断，静默忽略
            return;
        }
        console.error('[Uncaught Exception]', err);
    });

    // 启动服务器
    httpsServer.listen(PORT, '0.0.0.0', () => {
        const ip = getLocalIP();
        const url = `https://${ip}:${PORT}`;
        console.log(`Server running at ${url}`);

        if (callback) {
            callback(url);
        }
    });

    return httpsServer; // 返回 server 实例以便关闭
}

module.exports = { runServer };

