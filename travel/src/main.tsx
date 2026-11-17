import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { setAppIcon } from '../../shared/brand';
import fieldnotes_icon from '../../shared/assets/fieldnotes.svg';
import '../../shared/apell.css';
import './style.css';

setAppIcon(fieldnotes_icon);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
