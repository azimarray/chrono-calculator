import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import Splash from './components/Splash';
import './index.css';

function Root() {
  const [splash, setSplash] = useState(true);
  return (
    <>
      <App />
      {splash && <Splash onDone={() => setSplash(false)} />}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

// Offline support: register the service worker (skipped where unsupported or sandboxed).
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* e.g. sandboxed previews — the app still works online */
    });
  });
}
