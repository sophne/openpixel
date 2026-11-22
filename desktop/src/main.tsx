import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import './style.css';      // the app's stylesheet
import './platform.css';   // what differs between macOS, Windows and Linux: fonts, room for the window's buttons
import { App } from './App';
import { prepare, start } from './app/startup';
import { batch } from './lib/store';

prepare();
// The first render happens here and now, so start() finds the page's elements.
// No StrictMode: the canvas modules and the kit's listeners are set up once and must not be set up twice.
// Inside batch(), so a changed() in a mount effect waits for this render instead of starting one of its own.
const root = createRoot(document.getElementById('root')!);
batch(() => flushSync(() => root.render(<App />)));
start();
