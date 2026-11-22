import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { api, type CatalogItem } from '../api';
import { useRequest } from '../api/useRequest';
import { Rail } from '../components/Rail';
import { Screen } from '../components/Screen';
import { StatusView } from '../components/StatusView';
import { FocusGroup } from '../focus/FocusGroup';
import { useNavigation } from '../navigation/NavigationContext';
import { CONTENT_INSET, colors, px } from '../theme';

/** Home: a hero for the focused title and rails of cards. Initial focus: first card. */
export function HomeScreen({ visible }: { visible: boolean }) {
  const catalog = useRequest('catalog', (signal) => api.getCatalog(signal));
  const { push } = useNavigation();
  const [focused, setFocused] = useState<CatalogItem | null>(null);

  const onSelectItem = useCallback(
    (item: CatalogItem) => push({ name: 'details', itemId: item.id }),
    [push],
  );
  const firstItem = catalog.status === 'success' ? catalog.data.rails[0]?.items[0] : undefined;
  const hero = focused ?? firstItem;

  return (
    <Screen
      id="home"
      testID="screen_home"
      visible={visible}
      initialFocusKey={
        catalog.status === 'error' ? 'home_retry' : firstItem && `card_${firstItem.id}`
      }
    >
      {catalog.status !== 'success' ? (
        <StatusView
          prefix="home"
          {...(catalog.status === 'error' ? { error: catalog.error } : {})}
          onRetry={catalog.retry}
        />
      ) : (
        <View style={styles.container}>
          <View testID="home_hero" style={styles.hero}>
            <Text testID="home_hero_title" style={styles.heroTitle} numberOfLines={1}>
              {hero?.title}
            </Text>
            <Text testID="home_hero_meta" style={styles.heroMeta}>
              {hero ? `${hero.year} · ${hero.genre}` : ''}
            </Text>
          </View>
          {/* Up and down stay in the rails; the menu is reached with left. */}
          <FocusGroup style={styles.rails} trap={['up', 'down']}>
            <ScrollView
              testID="home_rails"
              showsVerticalScrollIndicator={false}
              // Every D-pad press moves focus, see Rail.
              snapToAlignment="item"
            >
              {catalog.data.rails.map((rail) => (
                <Rail
                  key={rail.id}
                  rail={rail}
                  onFocusItem={setFocused}
                  onSelectItem={onSelectItem}
                />
              ))}
            </ScrollView>
          </FocusGroup>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  hero: {
    height: px(300),
    justifyContent: 'flex-end',
    paddingHorizontal: CONTENT_INSET,
    paddingBottom: px(40),
  },
  heroTitle: { color: colors.text, fontSize: px(80), fontWeight: '800' },
  heroMeta: { color: colors.textMuted, fontSize: px(30), marginTop: px(8) },
  rails: { flex: 1 },
});
