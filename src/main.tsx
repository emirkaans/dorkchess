import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App.tsx';
import { registerServiceWorker } from './pwa/register.ts';
import { installErrorReporting } from './ui/errorReport.ts';
import './ui/styles.css';

installErrorReporting();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();
