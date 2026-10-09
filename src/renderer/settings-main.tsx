import React from 'react';
import ReactDOM from 'react-dom/client';
import SettingsPage from './pages/SettingsPage';
import { installBrowserMock } from './mockElectronAPI';
import { installPowerModeDebugHook, startPowerModeSync } from './powerMode';
import './styles.css';

installBrowserMock();

// 供电模式要在首帧前落到 <body>，否则电池模式会先跑一拍全速动效。
startPowerModeSync();
installPowerModeDebugHook();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SettingsPage />
  </React.StrictMode>,
);
