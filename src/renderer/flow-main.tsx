import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import FlowPage from './pages/FlowPage';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FlowPage />
  </StrictMode>,
);
