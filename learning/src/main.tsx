import { createRoot } from 'react-dom/client';
import { App } from './App';
import { setAppIcon } from '../../shared/brand';
import learning_icon from '../../shared/assets/learning.svg';
import '../../shared/apell.css';
import './style.css';

setAppIcon(learning_icon);
createRoot(document.getElementById('root')!).render(<App />);
