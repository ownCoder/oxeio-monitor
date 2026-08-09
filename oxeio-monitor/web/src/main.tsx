import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root পাওয়া যায়নি');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
