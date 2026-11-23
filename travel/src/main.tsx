import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { trackFocusInput } from './lib/focus-visibility';
import { setAppIcon } from '../../shared/brand';
import fieldnotes_icon from '../../shared/assets/fieldnotes.svg';
import '../../shared/apell.css';
import './style.css';
import './trips.css';

setAppIcon(fieldnotes_icon);
const stopTrackingFocus = trackFocusInput();
if (import.meta.hot) import.meta.hot.dispose(stopTrackingFocus);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
