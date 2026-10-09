import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installBrowserMock } from './mockElectronAPI';
import { installPowerModeDebugHook, startPowerModeSync } from './powerMode';
import './styles.css';

// 纯浏览器 dev 预览（/index.html）下补齐 electronAPI；Electron 运行时此调用自动退出。
installBrowserMock();

// 供电模式要在首帧前落到 <body>，否则电池模式会先跑一拍全速动效。
startPowerModeSync();
installPowerModeDebugHook();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
