// First: the dpad SDK must be in place before any app module runs.
import './src/dpad/start';

import { registerRootComponent } from 'expo';

import { App } from './src/App';

registerRootComponent(App);
