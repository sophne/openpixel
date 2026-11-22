import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import './style.css';      // app/web/style.css, copied as it is: do not edit
import './platform.css';   // what the desktop app adds
import { App } from './App';
import { prepare, start } from './app/startup';
import { batch } from './lib/store';

prepare();
// The first render happens here and now, so start() finds the page's elements, as the old script found its markup.
// No StrictMode: the canvas modules and the kit's listeners are set up once, like the old page's top-level code.
// Inside batch(), so a changed() in a mount effect waits for this render instead of starting one of its own.
const root = createRoot(document.getElementById('root')!);
batch(() => flushSync(() => root.render(<App />)));
start();
