import React from 'react';
import ReactDOM from 'react-dom/client';
import SettingsPage from './pages/SettingsPage';
import { installBrowserMock } from './mockElectronAPI';import './styles.css';

installBrowserMock();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SettingsPage />
  </React.StrictMode>,
);
