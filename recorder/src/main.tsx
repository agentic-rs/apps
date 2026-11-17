import { createRoot } from 'react-dom/client';
import { App } from './App';
import { setAppIcon } from '../../shared/brand';
import recorder_icon from '../../shared/assets/recorder.svg';
import '../../shared/apell.css';
import './style.css';
import './channels.css';
import './app-shell.css';

setAppIcon(recorder_icon);
createRoot(document.getElementById('root')!).render(<App />);
