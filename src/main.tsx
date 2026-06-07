import React from 'react';
import ReactDOM from 'react-dom/client';
// Polices embarquées en local (offline-first, aucun CDN) : Manrope + JetBrains Mono.
import '@fontsource-variable/manrope';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/playfair-display';
import { App } from './App';
import './styles/app.css';
import './styles/maquette.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
