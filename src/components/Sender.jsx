import React, { useState, useEffect, useRef } from 'react'
import { io } from 'socket.io-client'
import { useTranslation } from '../contexts/LanguageContext'
import { Maximize2, Minimize2, Settings, Globe } from 'lucide-react'

const Sender = () => {
    const { t, lang, setLang } = useTranslation()
    // State Refactoring: Using explicit state codes for better i18n support
    const [connectionState, setConnectionState] = useState('initializing') // initializing, ready, connecting, live, error, disconnected, connection_failed
    const [activeResString, setActiveResString] = useState('') // e.g., "1280x720"
    const [errorMessage, setErrorMessage] = useState('')

    // Keep other states
    const [stream, setStream] = useState(null)
    const [logs, setLogs] = useState([])
    const [showLogs, setShowLogs] = useState(false)
    const [resolution, setResolution] = useState('720p')
    const [bitrateMode, setBitrateMode] = useState('standard')
    const [isFullscreen, setIsFullscreen] = useState(false)

    // Refs for accessing state inside socket callbacks
    const resolutionRef = useRef('720p')
    const bitrateModeRef = useRef('standard')

    const videoRef = useRef(null)
    const socketRef = useRef(null)
    const peerConnectionRef = useRef(null)
    const streamRef = useRef(null)
    const wakeLockRef = useRef(null)

    const log = (msg) => {
        console.log(msg)
        setLogs(prev => [...prev.slice(-19), msg])
    }

    const RESOLUTIONS = {
        '720p': { width: { ideal: 1280 }, height: { ideal: 720 }, bitrate: 2500000 },
        '1080p': { width: { ideal: 1920 }, height: { ideal: 1080 }, bitrate: 6000000 },
        '2k': { width: { ideal: 2560 }, height: { ideal: 1440 }, bitrate: 10000000 },
        '4k': { width: { ideal: 3840 }, height: { ideal: 2160 }, bitrate: 15000000 }
    }

    // Helper to get translated status text dynamically
    const getStatusText = () => {
        switch (connectionState) {
            case 'initializing': return t('sender.initializing')
            case 'ready': return `${t('sender.ready')} (${activeResString})`
            case 'connecting': return t('sender.connecting')
            case 'live': return `${t('sender.live')} (${activeResString})`
            case 'disconnected': return t('sender.disconnected')
            case 'connection_failed': return t('sender.connection_failed')
            case 'error': return `Error: ${errorMessage}`
            default: return connectionState
        }
    }

    // Wake Lock & Fullscreen Listener
    useEffect(() => {
        // Request Wake Lock
        const requestWakeLock = async () => {
            try {
                if ('wakeLock' in navigator) {
                    wakeLockRef.current = await navigator.wakeLock.request('screen')
                    log('Wake Lock active')
                }
            } catch (err) {
                log(`Wake Lock Error: ${err.name}, ${err.message}`)
            }
        }

        const handleVisibilityChange = async () => {
            if (wakeLockRef.current !== null && document.visibilityState === 'visible') {
                await requestWakeLock()
            }
        }

        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement)
        }

        requestWakeLock()
        document.addEventListener('visibilitychange', handleVisibilityChange)
        document.addEventListener('fullscreenchange', handleFullscreenChange)

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange)
            document.removeEventListener('fullscreenchange', handleFullscreenChange)
            if (wakeLockRef.current) wakeLockRef.current.release()
        }
    }, [])

    const toggleFullscreen = () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                log(`Fullscreen Error: ${err.message}`)
            })
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen()
            }
        }
    }

    const handleLanguageToggle = (e) => {
        e.stopPropagation()
        const nextLang = lang === 'en' ? 'zh' : 'en'
        setLang(nextLang)
        // Sync with other client
        if (socketRef.current) {
            socketRef.current.emit('language-change', nextLang)
        }
    }

    const getConstraints = (resKey, facingMode = 'environment') => {
        const res = RESOLUTIONS[resKey] || RESOLUTIONS['720p']
        return {
            video: {
                facingMode: facingMode,
                width: res.width,
                height: res.height,
            },
            audio: false
        }
    }

    const setBandwidth = async (resKey, mode, customValue) => {
        if (!peerConnectionRef.current) return
        const sender = peerConnectionRef.current.getSenders().find(s => s.track && s.track.kind === 'video')
        if (!sender) return

        // Use provided args or fall back to refs
        const finalRes = resKey || resolutionRef.current
        const finalMode = mode || bitrateModeRef.current

        try {
            const parameters = sender.getParameters()
            if (!parameters.encodings) parameters.encodings = [{}]
            if (!parameters.encodings[0]) parameters.encodings[0] = {}

            let bitrate = (RESOLUTIONS[finalRes] || RESOLUTIONS['720p']).bitrate

            // Apply multiplier based on mode
            if (finalMode === 'high') bitrate *= 1.5
            if (finalMode === 'max') bitrate *= 2.5
            if (finalMode === 'custom' && customValue) bitrate = customValue

            parameters.encodings[0].maxBitrate = bitrate

            await sender.setParameters(parameters)
            log(`bw: ${(bitrate / 1000000).toFixed(1)} Mbps (${finalMode})`)
        } catch (e) {
            log('bw error: ' + e.message)
        }
    }

    useEffect(() => {
        start()
        return () => {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop())
            }
            if (socketRef.current) socketRef.current.disconnect()
            if (peerConnectionRef.current) peerConnectionRef.current.close()
        }
    }, [])

    const start = async () => {
        try {
            log('Requesting camera...')
            setConnectionState('initializing')
            const mediaStream = await navigator.mediaDevices.getUserMedia(getConstraints('720p'))
            setStream(mediaStream)
            streamRef.current = mediaStream
            if (videoRef.current) {
                videoRef.current.srcObject = mediaStream
            }

            const track = mediaStream.getVideoTracks()[0]
            const settings = track.getSettings()
            const s = `${settings.width}x${settings.height}`
            setActiveResString(s)
            setConnectionState('ready')

            const socket = io(window.location.origin, { transports: ['websocket'] })
            socketRef.current = socket

            socket.on('connect', () => {
                log('Socket connected')
                socket.emit('join', 'sender')
                // Sync language on connect? Maybe not, rely on explicit toggle.
                startWebRTC(socket, mediaStream)
            })

            socket.on('disconnect', () => setConnectionState('disconnected'))

            // Language Sync Listener
            socket.on('language-change', (newLang) => {
                if (newLang) {
                    log(`Sync language to: ${newLang}`)
                    setLang(newLang)
                }
            })

            socket.on('quality-change', async (data) => {
                const res = data.resolution
                log(`PC requests quality: ${res}`)
                await changeQuality(res)
            })

            socket.on('bitrate-change', (data) => {
                const mode = data.mode
                const value = data.value
                log(`PC requests bitrate: ${mode} ${value ? (value / 1000000).toFixed(1) + 'M' : ''}`)
                setBitrateMode(mode)
                bitrateModeRef.current = mode
                // Apply new bitrate immediately using current resolution
                setBandwidth(null, mode, value)
            })

            socket.on('answer', async (answer) => {
                log('Received answer')
                if (peerConnectionRef.current) {
                    try {
                        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer))
                    } catch (e) {
                        log('Error: ' + e.message)
                    }
                }
            })

            socket.on('ice-candidate', async (candidate) => {
                if (peerConnectionRef.current) {
                    try {
                        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate))
                    } catch (e) {
                        // ignore
                    }
                }
            })

        } catch (err) {
            setErrorMessage(err.message)
            setConnectionState('error')
            log('Start Error: ' + err.message)
        }
    }

    const changeQuality = async (newRes) => {
        const currentStream = streamRef.current
        if (!currentStream) return

        const currentTrack = currentStream.getVideoTracks()[0]
        const currentFacingMode = currentTrack.getSettings().facingMode || 'environment'

        try {
            log(`Switching to ${newRes}...`)
            // 先停止旧流以释放摄像头（安卓部分设备需要）
            currentTrack.stop()

            const newStream = await navigator.mediaDevices.getUserMedia(getConstraints(newRes, currentFacingMode))
            const newTrack = newStream.getVideoTracks()[0]
            const settings = newTrack.getSettings()
            const actualRes = `${settings.width}x${settings.height}`

            if (peerConnectionRef.current) {
                const sender = peerConnectionRef.current.getSenders().find(s => s.track && s.track.kind === 'video')
                if (sender) {
                    await sender.replaceTrack(newTrack)
                }
            }

            if (videoRef.current) {
                videoRef.current.srcObject = newStream
            }

            setStream(newStream)
            streamRef.current = newStream
            setResolution(newRes)
            resolutionRef.current = newRes // Update Ref

            setActiveResString(actualRes)
            setConnectionState('live')
            log(`Quality OK: ${actualRes}`)

            // 延迟一点设置码率，确保轨道已生效
            setTimeout(() => setBandwidth(newRes), 500)

        } catch (err) {
            log(`Quality Error: ${err.message}`)
            // 回退到 720p
            try {
                const fallback = await navigator.mediaDevices.getUserMedia(getConstraints('720p', currentFacingMode))
                setStream(fallback)
                streamRef.current = fallback
                if (videoRef.current) videoRef.current.srcObject = fallback
                if (peerConnectionRef.current) {
                    const sender = peerConnectionRef.current.getSenders().find(s => s.track && s.track.kind === 'video')
                    if (sender) await sender.replaceTrack(fallback.getVideoTracks()[0])
                }
                const s = fallback.getVideoTracks()[0].getSettings()
                setActiveResString(`${s.width}x${s.height})`)
                setConnectionState('live')
            } catch (e) {
                log('Recovery failed: ' + e.message)
            }
        }
    }

    const toggleCamera = async () => {
        const currentStream = streamRef.current
        if (!currentStream) return

        const currentTrack = currentStream.getVideoTracks()[0]
        const currentFacingMode = currentTrack.getSettings().facingMode
        const newFacingMode = currentFacingMode === 'user' ? 'environment' : 'user'

        try {
            log(`Switching to ${newFacingMode}...`)
            currentTrack.stop()

            const newStream = await navigator.mediaDevices.getUserMedia(getConstraints(resolution, newFacingMode))
            const newTrack = newStream.getVideoTracks()[0]
            const settings = newTrack.getSettings()

            if (peerConnectionRef.current) {
                const sender = peerConnectionRef.current.getSenders().find(s => s.track && s.track.kind === 'video')
                if (sender) {
                    await sender.replaceTrack(newTrack)
                }
            }

            if (videoRef.current) {
                videoRef.current.srcObject = newStream
            }

            setStream(newStream)
            streamRef.current = newStream

            setActiveResString(`${settings.width}x${settings.height}`)
            setConnectionState('live')
            log(`Camera switched to ${newFacingMode}`)

            // Re-apply bandwidth settings after switching camera
            setTimeout(() => setBandwidth(resolution), 500)

        } catch (err) {
            log('Switch Error: ' + err.message)
        }
    }

    const startWebRTC = async (socket, mediaStream) => {
        const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        })
        peerConnectionRef.current = pc

        pc.onconnectionstatechange = () => {
            const s = pc.connectionState
            if (s === 'connected') {
                const track = streamRef.current?.getVideoTracks()[0]
                if (track) {
                    const settings = track.getSettings()
                    setActiveResString(`${settings.width}x${settings.height}`)
                    setConnectionState('live')
                    // 连接成功后设置初始码率
                    setTimeout(() => setBandwidth(), 1000)
                }
            } else if (s === 'failed') {
                setConnectionState('connection_failed')
            }
        }

        mediaStream.getTracks().forEach(track => {
            pc.addTrack(track, mediaStream)
        })

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('ice-candidate', {
                    target: 'receiver',
                    candidate: event.candidate
                })
            }
        }

        try {
            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            socket.emit('offer', { type: 'offer', sdp: offer.sdp })
            setConnectionState('connecting')
        } catch (e) {
            log('Offer Error: ' + e.message)
        }
    }

    return (
        <div className="relative h-[100dvh] w-full bg-black overflow-hidden flex flex-col" onDoubleClick={toggleFullscreen}>
            {/* 摄像头画面 */}
            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
            />

            {/* 左上角：语言切换 */}
            <button
                onClick={handleLanguageToggle}
                className="absolute top-4 left-4 z-30 w-10 h-10 rounded-full bg-black/30 backdrop-blur flex items-center justify-center border border-white/10 active:scale-95 transition-transform"
            >
                <Globe size={16} className="text-white/80" />
                <span className="text-[10px] text-white/80 font-bold ml-1">{lang === 'en' ? 'EN' : '中'}</span>
            </button>

            {/* 右上角：全屏切换 */}
            <button
                onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
                className="absolute top-4 right-4 z-30 w-10 h-10 rounded-full bg-black/30 backdrop-blur flex items-center justify-center border border-white/10 active:scale-95 transition-transform"
            >
                {isFullscreen ? <Minimize2 size={18} className="text-white/80" /> : <Maximize2 size={18} className="text-white/80" />}
            </button>

            {/* 顶部中央：状态栏 */}
            <div className="absolute top-4 left-0 right-0 flex justify-center z-20 pointer-events-none">
                <div className="bg-black/30 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${connectionState === 'live' ? 'bg-red-500 animate-pulse' : 'bg-yellow-500'}`} />
                    <span className="text-white font-medium text-sm tracking-wide">{getStatusText()}</span>
                </div>
            </div>

            {/* 底部控制按钮 */}
            <div className="fixed bottom-12 left-0 right-0 flex justify-center gap-12 items-center z-30">
                {/* 切换前后摄像头 */}
                <button
                    onClick={(e) => { e.stopPropagation(); toggleCamera(); }}
                    className="w-20 h-20 rounded-full bg-white/20 backdrop-blur flex items-center justify-center border border-white/30 active:scale-95 transition-transform shadow-lg"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M23 4v6h-6" />
                        <path d="M1 20v-6h6" />
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
                        <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
                    </svg>
                </button>

                {/* 日志按钮 */}
                <button
                    onClick={(e) => { e.stopPropagation(); setShowLogs(!showLogs); }}
                    className="absolute right-8 w-12 h-12 rounded-full bg-white/10 backdrop-blur flex items-center justify-center border border-white/20 active:scale-95 transition-transform"
                >
                    <span className="text-[10px] text-white/50 font-bold">LOG</span>
                </button>
            </div>

            {/* 日志面板 */}
            {showLogs && (
                <div className="absolute inset-x-0 bottom-0 h-1/2 bg-black/80 backdrop-blur text-green-400 p-4 font-mono text-xs overflow-y-auto z-40">
                    <button onClick={() => setShowLogs(false)} className="mb-2 text-white bg-gray-700 px-2 rounded">{t('sender.close')}</button>
                    {logs.map((l, i) => <div key={i}>{l}</div>)}
                </div>
            )}
        </div>
    )
}

export default Sender
