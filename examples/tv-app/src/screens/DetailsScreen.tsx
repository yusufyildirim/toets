import { StyleSheet, Text, View } from 'react-native';

import { api, type ItemDetails } from '../api';
import { useRequest } from '../api/useRequest';
import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { StatusView } from '../components/StatusView';
import { FocusGroup } from '../focus/FocusGroup';
import { useNavigation } from '../navigation/NavigationContext';
import { useSettings } from '../settings/SettingsContext';
import { CONTENT_INSET, colors, px } from '../theme';

interface DetailsScreenProps {
  readonly scope: string;
  readonly itemId: string;
  readonly visible: boolean;
}

/** Details of one title. Initial focus: Play. */
export function DetailsScreen({ scope, itemId, visible }: DetailsScreenProps) {
  const item = useRequest(`item:${itemId}`, (signal) => api.getItem(itemId, signal));
  return (
    <Screen id={scope} testID="screen_details" visible={visible} initialFocusKey="details_play">
      {item.status === 'success' ? (
        <Details item={item.data} />
      ) : (
        <StatusView
          prefix="details"
          {...(item.status === 'error' ? { error: item.error } : {})}
          onRetry={item.retry}
        />
      )}
    </Screen>
  );
}

function Details({ item }: { item: ItemDetails }) {
  const { push } = useNavigation();
  const { myList, toggleMyList } = useSettings();
  const inList = myList.has(item.id);
  return (
    <View style={styles.container}>
      <View
        style={[
          styles.backdrop,
          { backgroundImage: `linear-gradient(120deg, ${item.colors[0]}, ${item.colors[1]})` },
        ]}
      />
      <View style={styles.scrim} />
      <View
        style={[
          styles.art,
          { backgroundImage: `linear-gradient(135deg, ${item.colors[0]}, ${item.colors[1]})` },
        ]}
      >
        <Text style={styles.artTitle}>{item.title}</Text>
      </View>
      <View style={styles.content}>
        <Text testID="details_title" style={styles.title}>
          {item.title}
        </Text>
        <Text testID="details_meta" style={styles.meta}>
          {item.year} · {item.genre} · {formatRuntime(item.runtime)}
        </Text>
        <Text testID="details_description" style={styles.description}>
          {item.description}
        </Text>
        <FocusGroup style={styles.actions}>
          <Button
            testID="details_play"
            label="Play"
            variant="primary"
            onPress={() => push({ name: 'player', itemId: item.id })}
          />
          <Button
            testID="details_my_list"
            label={inList ? 'In My List' : 'Add to My List'}
            aria-selected={inList}
            onPress={() => toggleMyList(item.id)}
          />
        </FocusGroup>
      </View>
    </View>
  );
}

function formatRuntime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  backdrop: { ...StyleSheet.absoluteFill, opacity: 0.55 },
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundImage: `linear-gradient(90deg, ${colors.background} 30%, transparent)`,
  },
  art: {
    position: 'absolute',
    right: CONTENT_INSET * 2,
    top: '50%',
    width: px(640),
    height: px(360),
    marginTop: px(-180),
    borderRadius: px(24),
    justifyContent: 'flex-end',
    padding: px(32),
    boxShadow: '0 24px 64px rgba(0, 0, 0, 0.5)',
  },
  artTitle: { color: colors.text, fontSize: px(48), fontWeight: '800' },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: CONTENT_INSET * 2,
    maxWidth: px(1100),
  },
  title: { color: colors.text, fontSize: px(80), fontWeight: '800' },
  meta: { color: colors.textMuted, fontSize: px(32), marginTop: px(12) },
  description: { color: colors.text, fontSize: px(32), lineHeight: px(46), marginTop: px(32) },
  actions: { flexDirection: 'row', gap: px(24), marginTop: px(56) },
});
