import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// VS Code's official icon font — provides the `.codicon-*` classes used by <Codicon>.
import '@vscode/codicons/dist/codicon.css';
import { App } from './App.js';
import './globals.css';

const container = document.getElementById('root');
if (!container) throw new Error('root element not found');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
