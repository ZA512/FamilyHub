import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import '../app/globals.css';
import { PwaRegistration } from '../components/pwa-registration';

const root = document.getElementById('root');
if (!root) throw new Error('Élément racine introuvable.');

createRoot(root).render(
  <StrictMode>
    <App />
    <PwaRegistration />
  </StrictMode>,
);
