import '@reflexify/agentflow-elements';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, type PublicConfig } from './App.js';
import { initialLang, TEXT } from './text.js';
import './styles.css';

const root = document.getElementById('root')!;

void fetch('/case-desk/config.json')
  .then((res) => {
    if (!res.ok) throw new Error(`config.json answered ${res.status}`);
    return res.json() as Promise<PublicConfig>;
  })
  .then(
    (config) =>
      createRoot(root).render(
        <StrictMode>
          <App config={config} />
        </StrictMode>,
      ),
    () => {
      root.textContent = TEXT[initialLang()].noConfig;
    },
  );
