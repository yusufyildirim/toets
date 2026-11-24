// First: the toets SDK must be in place before any app module runs.
import './src/toets/start';

import { registerRootComponent } from 'expo';

import { App } from './src/App';

registerRootComponent(App);
