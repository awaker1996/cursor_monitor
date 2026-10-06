import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installBrowserMock } from './mockElectronAPI';
import './styles.css';

// 纯浏览器 dev 预览（/index.html）下补齐 electronAPI；Electron 运行时此调用自动退出。
installBrowserMock();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
