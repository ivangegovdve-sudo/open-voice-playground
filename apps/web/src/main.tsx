import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const rootElement = document.querySelector('#root');

if (rootElement === null) {
  throw new Error('The application root element is missing');
}

createRoot(rootElement).render(
  <StrictMode>
    <main>
      <h1>Open Voice Playground</h1>
      <p>Workspace foundation is ready. Product UI arrives in a later task.</p>
    </main>
  </StrictMode>,
);
