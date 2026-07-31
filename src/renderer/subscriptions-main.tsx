import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import SubscriptionsPage from './pages/SubscriptionsPage';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SubscriptionsPage />
  </StrictMode>,
);
