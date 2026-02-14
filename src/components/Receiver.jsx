import React, { useState, useEffect, useRef } from 'react'
import { io } from 'socket.io-client'
import QRCode from 'qrcode'
import { motion, AnimatePresence } from 'framer-motion'
import { Wifi, WifiOff, RefreshCw, Smartphone, Monitor, RotateCw, Settings, Camera, CameraOff } from 'lucide-react'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { useTranslation } from '../contexts/LanguageContext'

function cn(...inputs) {
    return twMerge(clsx(inputs))
}

const Receiver = () => {
    const { t, lang, setLang } = useTranslation()
    const [serverUrl, setServerUrl] = useState('')
    const [qrCodeData, setQrCodeData] = useState('')
    const [status, setStatus] = useState('waiting') // waiting, connecting, connected, error
    const [statusMsg, setStatusMsg] = useState('Waiting for connection...')
    const [logs, setLogs] = useState([])
    const [showLogs, setShowLogs] = useState(false)
    const [rotation, setRotation] = useState(0)
    const [quality, setQuality] = useState('720p')
    const [bitrate, setBitrate] = useState('standard')
    const [customBitrate, setCustomBitrate] = useState(20)
    const [showSettings, setShowSettings] = useState(false)
    const [vcamActive, setVcamActive] = useState(false)
    const [vcamFps, setVcamFps] = useState(30)

    const videoRef = useRef(null)
    const bgVideoRef = useRef(null)
    const canvasRef = useRef(null)
    const socketRef = useRef(null)
    const peerConnectionRef = useRef(null)
    const vcamActiveRef = useRef(false)
    const vcamAnimFrameRef = useRef(null)
    const resizeTimeoutRef = useRef(null)
    const currentVcamSize = useRef({ w: 0, h: 0 })
    // Use Ref to access current quality in event listeners (closure trap fix)
    const qualityRef = useRef('720p')
    const vcamFpsRef = useRef(30)

    const RESOLUTIONS = ['720p', '1080p', '2k', '4k']
    const VCAM_FPS_OPTIONS = [15, 24, 30, 60]
    const BITRATES = ['standard', 'high', 'max', 'custom']

    const log = (msg) => {
        console.log(msg)
        setLogs(prev => [...prev.slice(-19), msg])
    }

    // 更新初始状态文本
    useEffect(() => {
        if (status === 'waiting') setStatusMsg(t('receiver.waiting'))
    }, [lang]) // 当语言改变且处于 waiting 状态时更新文本

    useEffect(() => {
        // 获取 Server URL
        if (window.electronAPI) {
            // 监听主进程推来的 URL (通常带 IP)
            window.electronAPI.onServerUrl((url) => {
                if (!url) return
                log('Received Server URL from Electron: ' + url)
                setServerUrl(url)
                generateQR(`${url}/mobile`)
                initSocket(url)
            })
            // 主动请求一次 (处理已经 ready 的情况)
            window.electronAPI.getServerUrl()
        } else {
            // 浏览器模式 (开发调试用)
            const origin = window.location.origin
            // 如果是 localhost，延迟提醒或者尝试寻找服务器
            setServerUrl(origin)
            generateQR(`${origin}/mobile`)
            initSocket(origin)
        }

        return () => {
            stopVcamCapture()
            if (socketRef.current) socketRef.current.disconnect()
            if (peerConnectionRef.current) peerConnectionRef.current.close()
        }
    }, [])

    const generateQR = async (url) => {
        try {
            const data = await QRCode.toDataURL(url, {
                width: 300,
                margin: 2,
                color: {
                    dark: '#000000',
                    light: '#ffffff'
                }
            })
            setQrCodeData(data)
        } catch (err) {
            log('QR Error: ' + err.message)
        }
    }

    const initSocket = (url) => {
        if (socketRef.current) return;

        log('Connecting to socket: ' + url)
        const socket = io(url, { transports: ['websocket'] })
        socketRef.current = socket

        socket.on('connect', () => {
            log('Socket connected')
            socket.emit('join', 'receiver')
        })

        // Sync language
        socket.on('language-change', (newLang) => {
            if (newLang) setLang(newLang)
        })

        socket.on('disconnect', () => {
            setStatus('error')
            setStatusMsg(t('receiver.socket_disconnected'))
        })

        socket.on('connect_error', (err) => {
            setStatus('error')
            setStatusMsg(t('receiver.connection_error'))
        })

        // Sync quality when sender joins/rejoins
        socket.on('sender-joined', () => {
            const currentQ = qualityRef.current
            log(`Sender joined. Syncing quality: ${currentQ}`)
            socket.emit('quality-change', { resolution: currentQ })
        })

        socket.on('offer', async (data) => {
            log('Received OFFER')
            setStatus('connecting')
            setStatusMsg(t('receiver.connecting'))
            await handleOffer(data)
        })

        socket.on('ice-candidate', async (candidate) => {
            if (peerConnectionRef.current) {
                try {
                    await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate))
                } catch (e) {
                    log('ICE Error: ' + e.message)
                }
            }
        })
    }

    const handleOffer = async (offer) => {
        // Cleanup previous connection
        if (peerConnectionRef.current) {
            peerConnectionRef.current.ontrack = null
            peerConnectionRef.current.onicecandidate = null
            peerConnectionRef.current.close()
            peerConnectionRef.current = null
        }

        const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        })
        peerConnectionRef.current = pc

        pc.onconnectionstatechange = () => {
            const state = pc.connectionState
            log('PC State: ' + state)
            if (state === 'connected') {
                setStatus('connected')
                setStatusMsg(t('receiver.connected'))
            } else if (state === 'disconnected' || state === 'failed') {
                setStatus('waiting')
                setStatusMsg(t('receiver.connection_lost'))
            }
        }

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socketRef.current.emit('ice-candidate', {
                    target: 'sender',
                    candidate: event.candidate
                })
            }
        }

        pc.ontrack = (event) => {
            log('Highlight: Video Track Received')
            if (event.streams && event.streams[0]) {
                if (videoRef.current) {
                    videoRef.current.srcObject = event.streams[0]
                    videoRef.current.play().catch(e => log('Play Error: ' + e.message))

                    // Sync to background video
                    if (bgVideoRef.current) {
                        bgVideoRef.current.srcObject = event.streams[0]
                        bgVideoRef.current.play().catch(e => log('BG Play Error: ' + e.message))
                    }

                    // Ensure state update
                    setStatus('connected')
                    setStatusMsg(t('receiver.connected'))
                }
            }
        }

        pc.addTransceiver('video', { direction: 'recvonly' })
        pc.addTransceiver('audio', { direction: 'recvonly' })

        try {
            await pc.setRemoteDescription(new RTCSessionDescription(offer))
            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            socketRef.current.emit('answer', { type: 'answer', sdp: answer.sdp })
        } catch (e) {
            log('PC Error: ' + e.message)
            setStatus('error')
            setStatusMsg(t('receiver.handshake_failed'))
        }
    }

    const handleRotate = () => {
        setRotation(prev => (prev + 90) % 360)
    }

    const handleQualityChange = (res) => {
        setQuality(res)
        qualityRef.current = res // Update Ref
        if (socketRef.current) {
            log('Requesting quality: ' + res)
            socketRef.current.emit('quality-change', { resolution: res })
        }
        setShowSettings(false)
    }

    const handleBitrateChange = (mode, value) => {
        setBitrate(mode)
        let payload = { mode }
        if (mode === 'custom') {
            const val = value !== undefined ? value : customBitrate
            payload.value = val * 1000000
        }

        if (socketRef.current) {
            log('Requesting bitrate: ' + mode + (payload.value ? ` (${payload.value})` : ''))
            socketRef.current.emit('bitrate-change', payload)
        }
    }

    // ========= 虚拟摄像头 =========
    const toggleVcam = async () => {
        if (vcamActiveRef.current) {
            stopVcamCapture()
        } else {
            await startVcamCapture()
        }
    }

    const startVcamCapture = async () => {
        if (!window.electronAPI || !videoRef.current) {
            log('[VCam] electronAPI or video not available')
            return
        }

        const video = videoRef.current
        const w = video.videoWidth || 1280
        const h = video.videoHeight || 720

        log(`[VCam] Starting ${w}x${h}...`)
        let ok = false
        try {
            ok = await window.electronAPI.startVirtualCam(w, h)
        } catch (err) {
            log('[VCam] startVirtualCam threw: ' + err.message)
            return
        }
        if (!ok) {
            log('[VCam] Failed to create camera')
            return
        }

        vcamActiveRef.current = true
        currentVcamSize.current = { w, h }
        setVcamActive(true)
        const currentFps = vcamFpsRef.current
        log(`[VCam] Active! Capturing at ${currentFps}fps...`)

        const canvas = canvasRef.current
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d', { willReadFrequently: true })

        // Use setInterval for stable, predictable frame rate
        const FRAME_INTERVAL = 1000 / currentFps

        const intervalId = setInterval(() => {
            if (!vcamActiveRef.current) {
                clearInterval(intervalId)
                return
            }

            try {
                // Check video is still playing and has valid dimensions
                if (video.readyState < 2 || video.videoWidth === 0) return

                // If video dimensions changed, update canvas (without restarting vcam)
                if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
                    // Only log once per resize
                    log(`[VCam] Canvas resize: ${canvas.width}x${canvas.height} → ${video.videoWidth}x${video.videoHeight}`)
                    canvas.width = video.videoWidth
                    canvas.height = video.videoHeight
                }

                ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

                const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data
                window.electronAPI.sendFrame(rgba.buffer)
            } catch (err) {
                // Don't kill the loop on a single frame error
                // This prevents "movement crash"
            }
        }, FRAME_INTERVAL)

        // Store interval ID for cleanup (reuse the animFrame ref)
        vcamAnimFrameRef.current = intervalId
    }

    const stopVcamCapture = async () => {
        vcamActiveRef.current = false
        currentVcamSize.current = { w: 0, h: 0 }
        setVcamActive(false)
        if (vcamAnimFrameRef.current) {
            clearInterval(vcamAnimFrameRef.current)
            vcamAnimFrameRef.current = null
        }
        if (window.electronAPI) {
            try {
                await window.electronAPI.stopVirtualCam()
            } catch (err) {
                log('[VCam] stopVirtualCam error: ' + err.message)
            }
        }
        log('[VCam] Stopped')
    }

    const handleVideoResize = () => {
        if (!videoRef.current || !vcamActiveRef.current) return
        const { videoWidth, videoHeight } = videoRef.current
        const { w, h } = currentVcamSize.current

        if (videoWidth === 0 || videoHeight === 0) return

        // Only restart vcam if resolution changed significantly (>10% difference)
        // Small fluctuations during movement should NOT trigger restart
        const wDiff = Math.abs(videoWidth - w) / (w || 1)
        const hDiff = Math.abs(videoHeight - h) / (h || 1)

        if (wDiff > 0.1 || hDiff > 0.1) {
            if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current)

            log(`[VCam] Significant size change (${w}x${h} → ${videoWidth}x${videoHeight}). Restarting in 1.5s...`)

            resizeTimeoutRef.current = setTimeout(() => {
                if (vcamActiveRef.current) {
                    log('[VCam] Executing restart...')
                    stopVcamCapture().then(() => {
                        // Small delay to let DLL fully release
                        setTimeout(() => startVcamCapture(), 300)
                    })
                }
            }, 1500)
        }
    }

    return (
        <div className="relative min-h-screen w-full flex items-center justify-center bg-slate-900 overflow-hidden">
            {/* Animated Background */}
            <div className="absolute inset-0 animated-bg z-0" />

            {/* Main Content Container */}
            <div className="relative z-10 w-full max-w-5xl h-[85vh] p-6 flex flex-col items-center justify-center">

                <AnimatePresence mode="wait">
                    {status === 'connected' ? (
                        /* Video View */
                        <motion.div
                            key="video-view"
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 1.05 }}
                            transition={{ duration: 0.5, ease: "circOut" }}
                            className="bg-slate-950 rounded-2xl w-full h-full relative flex items-center justify-center shadow-2xl ring-1 ring-white/10 overflow-hidden"
                        >
                            {/* Ambient Backdrop (Blurred Video) */}
                            <video
                                ref={bgVideoRef}
                                autoPlay
                                playsInline
                                muted
                                style={{
                                    transform: `rotate(${rotation}deg) scale(1.8)`,
                                    filter: 'blur(40px) brightness(0.7) saturate(1.5)',
                                    opacity: 0.6
                                }}
                                className="absolute inset-0 w-full h-full object-cover z-0 pointer-events-none transition-transform duration-500 ease-in-out"
                            />

                            {/* Clear Foreground Video */}
                            <video
                                ref={videoRef}
                                onResize={handleVideoResize}
                                onLoadedMetadata={handleVideoResize}
                                autoPlay
                                playsInline
                                muted
                                style={{ transform: `rotate(${rotation}deg)` }}
                                className="relative z-10 w-full h-full object-contain transition-transform duration-500 ease-in-out drop-shadow-[0_20px_50px_rgba(0,0,0,0.8)]"
                            />

                            {/* Overlay Controls */}
                            <div className="absolute top-4 left-4 flex gap-2 z-20">
                                <div className="px-3 py-1.5 rounded-full bg-black/60 backdrop-blur text-xs font-medium text-green-400 flex items-center gap-2 border border-white/5">
                                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                    {t('receiver.live')}
                                </div>

                                <div className="relative">
                                    <button
                                        onClick={() => setShowSettings(!showSettings)}
                                        className="px-3 py-1.5 rounded-full bg-black/60 backdrop-blur text-xs font-medium text-white hover:bg-white/20 transition-colors border border-white/5 flex items-center gap-2"
                                    >
                                        <Settings className="w-3 h-3" />
                                        {quality.toUpperCase()}
                                    </button>

                                    {showSettings && (
                                        <motion.div
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            className="absolute top-full left-0 mt-2 bg-slate-800 rounded-lg shadow-xl border border-white/10 overflow-hidden w-40 flex flex-col"
                                        >
                                            <div className="px-3 py-1 text-[10px] font-bold text-gray-500 uppercase mt-1">{t('receiver.resolution')}</div>
                                            {RESOLUTIONS.map(res => (
                                                <button
                                                    key={res}
                                                    onClick={() => handleQualityChange(res)}
                                                    className={cn(
                                                        "px-3 py-1.5 text-xs text-left hover:bg-white/10 transition-colors",
                                                        quality === res ? "text-indigo-400 font-bold" : "text-gray-300"
                                                    )}
                                                >
                                                    {res.toUpperCase()}
                                                </button>
                                            ))}

                                            <div className="border-t border-white/10 my-1" />
                                            <div className="px-3 py-1 text-[10px] font-bold text-gray-500 uppercase">{t('receiver.bitrate')}</div>
                                            {BITRATES.map(b => (
                                                <button
                                                    key={b}
                                                    onClick={() => handleBitrateChange(b)}
                                                    className={cn(
                                                        "px-3 py-1.5 text-xs text-left hover:bg-white/10 transition-colors",
                                                        bitrate === b ? "text-indigo-400 font-bold" : "text-gray-300"
                                                    )}
                                                >
                                                    {t(`bitrates.${b}`) || b.toUpperCase()}
                                                </button>
                                            ))}

                                            {bitrate === 'custom' && (
                                                <div className="px-3 py-2 border-t border-white/10 bg-black/20">
                                                    <div className="flex justify-between text-[10px] text-gray-400 mb-1 font-mono">
                                                        <span>{customBitrate} Mbps</span>
                                                    </div>
                                                    <input
                                                        type="range"
                                                        min="1"
                                                        max="500"
                                                        value={customBitrate}
                                                        onChange={(e) => setCustomBitrate(parseInt(e.target.value))}
                                                        onMouseUp={() => handleBitrateChange('custom', customBitrate)}
                                                        onTouchEnd={() => handleBitrateChange('custom', customBitrate)}
                                                        className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-indigo-500 focus:outline-none"
                                                    />
                                                </div>
                                            )}

                                            <div className="border-t border-white/10 my-1" />
                                            <div className="px-3 py-1 text-[10px] font-bold text-gray-500 uppercase">{t('receiver.vcam_fps') || 'VCAM FPS'}</div>
                                            <div className="flex gap-1 px-2 pb-1">
                                                {VCAM_FPS_OPTIONS.map(fps => (
                                                    <button
                                                        key={fps}
                                                        onClick={() => {
                                                            vcamFpsRef.current = fps
                                                            setVcamFps(fps)
                                                            // If vcam is running, restart with new fps
                                                            if (vcamActiveRef.current) {
                                                                stopVcamCapture().then(() => setTimeout(() => startVcamCapture(), 200))
                                                            }
                                                        }}
                                                        className={cn(
                                                            "flex-1 text-[10px] py-1 rounded border transition-colors",
                                                            vcamFps === fps
                                                                ? "bg-indigo-500/20 border-indigo-500 text-indigo-300"
                                                                : "border-white/10 text-gray-400 hover:bg-white/5"
                                                        )}
                                                    >
                                                        {fps}
                                                    </button>
                                                ))}
                                            </div>

                                            <div className="border-t border-white/10 my-1" />
                                            <div className="px-3 py-1 text-[10px] font-bold text-gray-500 uppercase">{t('app.language')}</div>
                                            <div className="flex gap-1 px-2 pb-2">
                                                <button
                                                    onClick={() => { setLang('en'); if (socketRef.current) socketRef.current.emit('language-change', 'en'); }}
                                                    className={cn("flex-1 text-[10px] py-1 rounded border transition-colors", lang === 'en' ? "bg-indigo-500/20 border-indigo-500 text-indigo-300" : "border-white/10 text-gray-400 hover:bg-white/5")}
                                                >
                                                    EN
                                                </button>
                                                <button
                                                    onClick={() => { setLang('zh'); if (socketRef.current) socketRef.current.emit('language-change', 'zh'); }}
                                                    className={cn("flex-1 text-[10px] py-1 rounded border transition-colors", lang === 'zh' ? "bg-indigo-500/20 border-indigo-500 text-indigo-300" : "border-white/10 text-gray-400 hover:bg-white/5")}
                                                >
                                                    中文
                                                </button>
                                            </div>
                                        </motion.div>
                                    )}
                                </div>

                                <button
                                    onClick={handleRotate}
                                    className="px-3 py-1.5 rounded-full bg-black/60 backdrop-blur text-xs font-medium text-white hover:bg-white/20 transition-colors border border-white/5 flex items-center gap-2"
                                >
                                    <RotateCw className="w-3 h-3" />
                                    {t('receiver.rotate')}
                                </button>

                                {/* 虚拟摄像头开关 */}
                                <button
                                    onClick={toggleVcam}
                                    className={cn(
                                        "px-3 py-1.5 rounded-full backdrop-blur text-xs font-medium transition-colors border flex items-center gap-2",
                                        vcamActive
                                            ? "bg-green-500/30 text-green-300 border-green-400/30 hover:bg-green-500/40"
                                            : "bg-black/60 text-white border-white/5 hover:bg-white/20"
                                    )}
                                >
                                    {vcamActive ? <Camera className="w-3 h-3" /> : <CameraOff className="w-3 h-3" />}
                                    {vcamActive ? t('receiver.vcam_on') : t('receiver.vcam')}
                                </button>
                            </div>
                        </motion.div>
                    ) : (
                        /* QR Code View */
                        <motion.div
                            key="qr-view"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                            transition={{ duration: 0.4 }}
                            className="glass-panel p-12 rounded-3xl flex flex-col items-center gap-8 max-w-md w-full relative overflow-hidden"
                        >
                            {/* Scanning Effect */}
                            <div className="absolute inset-0 pointer-events-none">
                                <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500/10 to-purple-500/10" />
                            </div>

                            <div className="text-center space-y-2 z-10">
                                <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-200 to-purple-200">
                                    {t('app.title')}
                                </h1>
                                <p className="text-slate-400 text-sm">{t('receiver.scan_to_connect')}</p>
                            </div>

                            <div className="relative group">
                                <div className={cn(
                                    "p-4 bg-white rounded-2xl shadow-xl transition-all duration-500",
                                    status === 'connecting' ? "blur-sm scale-95 opacity-50" : "group-hover:scale-105"
                                )}>
                                    {qrCodeData ? (
                                        <img src={qrCodeData} alt="QR Code" className="w-64 h-64 mix-blend-multiply opacity-90" />
                                    ) : (
                                        <div className="w-64 h-64 bg-slate-100 animate-pulse rounded-xl" />
                                    )}
                                </div>

                                {/* Loading State Overlay */}
                                {status === 'connecting' && (
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <RefreshCw className="w-12 h-12 text-indigo-500 animate-spin" />
                                    </div>
                                )}

                                {/* Scan Line */}
                                {status === 'waiting' && (
                                    <div className="absolute inset-0 overflow-hidden rounded-2xl pointer-events-none">
                                        <div className="w-full h-1/2 scan-line" />
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center gap-3 px-4 py-2 bg-slate-800/50 rounded-full border border-white/5 backdrop-blur z-10">
                                {status === 'waiting' && <Smartphone className="w-4 h-4 text-slate-400" />}
                                {status === 'connecting' && <Wifi className="w-4 h-4 text-indigo-400 animate-pulse" />}
                                {status === 'error' && <WifiOff className="w-4 h-4 text-red-400" />}

                                <span className={cn(
                                    "text-sm font-medium font-mono",
                                    status === 'waiting' && "text-slate-400",
                                    status === 'connecting' && "text-indigo-300",
                                    status === 'error' && "text-red-300"
                                )}>
                                    {statusMsg}
                                </span>
                            </div>

                            {/* Browser Hint */}
                            {!window.electronAPI && window.location.hostname === 'localhost' && (
                                <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-[10px] text-amber-200 text-center max-w-[250px]">
                                    {t('receiver.use_desktop_app_hint') || "请使用桌面客户端启动以获取内网 IP 和完整功能"}
                                </div>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Bottom Status Bar */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5 }}
                    className="absolute bottom-8 flex gap-4 z-20"
                >
                    <button
                        onClick={() => setShowLogs(!showLogs)}
                        className="px-4 py-2 rounded-full glass-card hover:bg-white/10 transition-colors text-xs font-mono text-slate-400 flex items-center gap-2"
                    >
                        <Monitor className="w-3 h-3" />
                        {serverUrl ? serverUrl.split('//')[1] : t('receiver.loading_url')}
                    </button>
                </motion.div>

            </div>

            {/* Debug Logs Drawer */}
            <AnimatePresence>
                {showLogs && (
                    <motion.div
                        initial={{ y: '100%' }}
                        animate={{ y: 0 }}
                        exit={{ y: '100%' }}
                        className="fixed bottom-0 left-0 right-0 h-48 bg-slate-900/95 backdrop-blur border-t border-white/10 p-4 z-50 overflow-y-auto font-mono text-xs text-green-400 shadow-2xl"
                    >
                        <div className="flex justify-between items-center mb-2 sticky top-0 bg-slate-900 pb-2 border-b border-white/10">
                            <span className="font-bold text-white">{t('receiver.logs')}</span>
                            <button onClick={() => setShowLogs(false)} className="text-slate-400 hover:text-white">{t('receiver.close')}</button>
                        </div>
                        {logs.map((l, i) => <div key={i} className="border-b border-white/5 py-0.5">{l}</div>)}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Hidden canvas for frame capture */}
            <canvas ref={canvasRef} className="hidden" />
        </div>
    )
}

export default Receiver
