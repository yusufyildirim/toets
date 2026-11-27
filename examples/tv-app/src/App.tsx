import { useEffect } from 'react';
import { LogBox, StyleSheet, View } from 'react-native';

import { SideMenu } from './components/SideMenu';
import { isLaunchedByToets, useLaunchState } from './toets';
import { installSpatialNavigation } from './focus/spatialNavigation';
import {
  canGoBack,
  deepLinkActions,
  launchStateActions,
  routeScope,
} from './navigation/navigation';
import { NavigationProvider, useNavigation } from './navigation/NavigationContext';
import { useDeepLinks } from './navigation/useDeepLinks';
import { useBackKey } from './remote/useBackKey';
import { DetailsScreen } from './screens/DetailsScreen';
import { HomeScreen } from './screens/HomeScreen';
import { PlayerScreen } from './screens/PlayerScreen';
import { SearchScreen } from './screens/SearchScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SignInScreen } from './screens/SignInScreen';
import { SettingsProvider, useSettings } from './settings/SettingsContext';
import { colors } from './theme';

export function App() {
  useEffect(() => installSpatialNavigation(), []);
  // Under test, dev-mode warning toasts would cover the UI being asserted on.
  useEffect(() => {
    if (isLaunchedByToets()) LogBox.ignoreAllLogs();
  }, []);
  return (
    <SettingsProvider>
      <NavigationProvider>
        <Navigator />
      </NavigationProvider>
    </SettingsProvider>
  );
}

/** Tabs (side menu + home/settings) at the root, full-screen routes stacked on top. */
function Navigator() {
  const navigation = useNavigation();
  const { tab, stack } = navigation.state;
  const atRoot = stack.length === 0;
  useBackKey(navigation.back, canGoBack(navigation.state));
  const { setAutoplay } = useSettings();
  useLaunchState((state, flags) => {
    if (flags.autoplay !== undefined) setAutoplay(flags.autoplay);
    if (state !== undefined) navigation.apply(launchStateActions(state));
  });
  useDeepLinks((url) => {
    const actions = deepLinkActions(url);
    if (actions) navigation.apply(actions);
  });

  return (
    <View testID="app_root" style={styles.root}>
      <View style={[styles.tabs, !atRoot && styles.hidden]}>
        <SideMenu visible={atRoot} />
        <View style={styles.tabContent}>
          <HomeScreen visible={atRoot && tab === 'home'} />
          <SearchScreen visible={atRoot && tab === 'search'} />
          <SignInScreen visible={atRoot && tab === 'signin'} />
          <SettingsScreen visible={atRoot && tab === 'settings'} />
        </View>
      </View>
      {stack.map((route, index) => {
        const scope = routeScope(route, index);
        const visible = index === stack.length - 1;
        return route.name === 'details' ? (
          <DetailsScreen key={scope} scope={scope} itemId={route.itemId} visible={visible} />
        ) : (
          <PlayerScreen key={scope} scope={scope} itemId={route.itemId} visible={visible} />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  tabs: { flex: 1, flexDirection: 'row' },
  tabContent: { flex: 1 },
  hidden: { display: 'none' },
});
