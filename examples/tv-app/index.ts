import { registerRootComponent } from 'expo';
import { LogBox } from 'react-native';

import { App } from './src/App';
import { getLaunchPayload } from './src/dpad';

// Under test, dev-mode warning toasts would cover the UI being asserted on.
if (getLaunchPayload()) LogBox.ignoreAllLogs();

registerRootComponent(App);
