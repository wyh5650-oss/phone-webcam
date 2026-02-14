import React, { useEffect } from 'react'
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom'
import Receiver from './components/Receiver'
import Sender from './components/Sender'

function AppContent() {
    const navigate = useNavigate();

    useEffect(() => {
        // 简单的路由判断：如果是 PC (Electron)，默认去 /
        // 如果是手机访问（通过 URL），应该已经在 /mobile 或者首页
        // 这里可以加一个简单的引导页，或者直接用路由处理
    }, []);

    return (
        <Routes>
            <Route path="/" element={<Receiver />} />
            <Route path="/mobile" element={<Sender />} />
        </Routes>
    )
}

export default function App() {
    return (
        <BrowserRouter>
            <AppContent />
        </BrowserRouter>
    )
}
