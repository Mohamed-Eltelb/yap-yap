import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppTooltip } from './components/AppTooltip';
import './index.css';

if (window.location.hash === '#/hud') {
  document.documentElement.classList.add('hud-mode');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <AppTooltip />
  </StrictMode>
);
