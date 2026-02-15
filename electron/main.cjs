const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
// child_process 不需要了，但保留以防万一，暂不删除，或删除它。
// Actually remove it to be clean.


const isPackaged = app.isPackaged;

let serverProcess;
let mainWindow;

// ========= Softcam 虚拟摄像头 =========
let softcamLib = null;
let helperLib = null;
let scCamera = null;
let vcamWidth = 0;
let vcamHeight = 0;

// 缓存函数引用
let fn_scCreateCamera = null;
let fn_scSendFrame = null;
let fn_scDeleteCamera = null;
let fn_rgba_to_bgr_flip = null;

// 预分配原生 BGR 缓冲区
let bgrBuffer = null;

// 性能监控
let droppedFrames = 0;
let processedFrames = 0;
let lastStatsTime = Date.now();

global.serverUrl = null;

function initSoftcam() {
    try {
        const koffi = require('koffi');
        const basePath = isPackaged ? process.resourcesPath : path.join(__dirname, '..');
        const dllPath = path.join(basePath, 'native/softcam/dist/bin/x64/softcam.dll');
        const helperPath = path.join(basePath, 'native/vcam_helper.dll');

        softcamLib = koffi.load(dllPath);
        helperLib = koffi.load(helperPath);

        // 缓存 softcam 函数
        fn_scCreateCamera = softcamLib.func('void* __cdecl scCreateCamera(int width, int height, float framerate)');
        fn_scSendFrame = softcamLib.func('void __cdecl scSendFrame(void* camera, const void* image_bits)');
        fn_scDeleteCamera = softcamLib.func('void __cdecl scDeleteCamera(void* camera)');

        // 缓存原生转换函数
        fn_rgba_to_bgr_flip = helperLib.func('void __cdecl rgba_to_bgr_flip(const uint8_t* rgba, uint8_t* bgr, int width, int height)');

        console.log('[VCam] softcam.dll + vcam_helper.dll loaded');
        return true;
    } catch (err) {
        console.error('[VCam] Failed to load DLLs:', err.message);
        return false;
    }
}

function startVirtualCam(width, height) {
    if (!softcamLib) {
        if (!initSoftcam()) return false;
    }

    if (scCamera) {
        try { fn_scDeleteCamera(scCamera); } catch (e) { }
        scCamera = null;
    }

    try {
        scCamera = fn_scCreateCamera(width, height, 0);
        if (!scCamera) {
            console.error('[VCam] scCreateCamera returned null');
            return false;
        }
        vcamWidth = width;
        vcamHeight = height;

        // 预分配 BGR 缓冲区
        bgrBuffer = Buffer.alloc(width * height * 3);

        console.log(`[VCam] Virtual camera created: ${width}x${height}`);
        return true;
    } catch (err) {
        console.error('[VCam] Error creating camera:', err.message);
        return false;
    }
}

function stopVirtualCam() {
    if (scCamera && fn_scDeleteCamera) {
        try {
            fn_scDeleteCamera(scCamera);
            console.log('[VCam] Virtual camera stopped');
        } catch (err) {
            console.error('[VCam] Error deleting camera:', err.message);
        }
        scCamera = null;
        bgrBuffer = null;
    }
}

// ========= Electron Window =========
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        show: false, // 先不显示，等加载完成后再显示
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
        backgroundMaterial: 'mica',
        vibrancy: 'fullscreen-ui',
    });

    if (isPackaged) {
        // Production: wait for server to start, then load from it
        const waitForServer = () => {
            if (global.serverUrl) {
                mainWindow.loadURL(global.serverUrl);
            } else {
                setTimeout(waitForServer, 200);
            }
        };
        waitForServer();
    } else {
        const startUrl = process.env.ELECTRON_START_URL || 'http://localhost:5173';
        mainWindow.loadURL(startUrl);
    }

    mainWindow.webContents.on('did-finish-load', () => {
        if (global.serverUrl) {
            mainWindow.webContents.send('server-url', global.serverUrl);
        }
        // 加载完成后显示窗口
        mainWindow.show();
    });
}

const { runServer } = require('../server/server.cjs');

function startServer() {
    // 在打包环境中，dist 位于 resources (如果 extraResources) 或者 app.asar (如果 files)
    // 根据新的策略，我们将 server 和 dist 都打包进 app.asar
    // 所以路径应该是 __dirname/../dist
    const distPath = path.join(__dirname, '../dist');

    serverProcess = runServer(isPackaged, distPath, (url) => {
        console.log('Server started, URL:', url);
        global.serverUrl = url;
        if (mainWindow && !mainWindow.webContents.isLoading()) {
            mainWindow.webContents.send('server-url', url);
        }
    });
}

app.whenReady().then(() => {
    ipcMain.on('get-server-url', (event) => {
        if (global.serverUrl) {
            event.reply('server-url', global.serverUrl);
        }
    });

    ipcMain.handle('vcam-start', async (_event, { width, height }) => {
        return startVirtualCam(width, height);
    });

    ipcMain.handle('vcam-stop', async () => {
        stopVirtualCam();
        return true;
    });

    // 高频帧数据：接收 RGBA，用原生 C 函数转 BGR 后发送
    ipcMain.on('vcam-frame', (_event, rgbaBuffer) => {
        if (!scCamera || !fn_rgba_to_bgr_flip || !fn_scSendFrame || !bgrBuffer) {
            droppedFrames++;
            return;
        }

        const startTime = performance.now();

        try {
            const rgba = Buffer.from(rgbaBuffer);
            const expectedSize = vcamWidth * vcamHeight * 4; // RGBA = 4 bytes per pixel

            // Skip frames with mismatched size (happens during resolution transitions)
            if (rgba.length !== expectedSize) {
                droppedFrames++;
                return;
            }

            fn_rgba_to_bgr_flip(rgba, bgrBuffer, vcamWidth, vcamHeight);
            fn_scSendFrame(scCamera, bgrBuffer);

            processedFrames++;

            const processingTime = performance.now() - startTime;
            if (processingTime > 16.67) { // 超过 60fps 的帧时间
                console.warn(`[VCam] Slow frame: ${processingTime.toFixed(2)}ms`);
            }

            // 每 5 秒输出一次统计
            const now = Date.now();
            if (now - lastStatsTime > 5000) {
                const fps = processedFrames / 5;
                console.log(`[VCam] Stats: ${fps.toFixed(1)} fps, dropped: ${droppedFrames}`);
                processedFrames = 0;
                droppedFrames = 0;
                lastStatsTime = now;
            }
        } catch (err) {
            droppedFrames++;
            console.error('[VCam] Frame error:', err.message);
        }
    });

    startServer();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.commandLine.appendSwitch('ignore-certificate-errors');

app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    event.preventDefault();
    callback(true);
});

app.on('will-quit', () => {
    stopVirtualCam();
    if (serverProcess && serverProcess.close) {
        serverProcess.close();
    }
});
