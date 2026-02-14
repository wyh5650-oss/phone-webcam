import React, { createContext, useState, useContext, useEffect } from 'react';
import en from '../locales/en.json';
import zh from '../locales/zh.json';

const LanguageContext = createContext();

export const LanguageProvider = ({ children }) => {
    // 默认语言：尝试从 localStorage 读取，没有则自动检测浏览器语言
    const [lang, setLang] = useState(() => {
        const saved = localStorage.getItem('app-language');
        if (saved) return saved;
        return navigator.language.startsWith('zh') ? 'zh' : 'en';
    });

    useEffect(() => {
        localStorage.setItem('app-language', lang);
    }, [lang]);

    const t = (key) => {
        const keys = key.split('.');
        let value = lang === 'zh' ? zh : en;

        let current = value;
        for (const k of keys) {
            if (current[k] === undefined) {
                // console.warn(`Translation missing for key: ${key}`);
                return key;
            }
            current = current[k];
        }
        return current;
    };

    return (
        <LanguageContext.Provider value={{ lang, setLang, t }}>
            {children}
        </LanguageContext.Provider>
    );
};

export const useTranslation = () => useContext(LanguageContext);
