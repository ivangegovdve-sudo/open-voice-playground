import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { registerServiceWorker } from './pwa';
import './styles.css';

const rootElement = document.querySelector('#root');

if (rootElement === null) {
  throw new Error('The application root element is missing');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();
