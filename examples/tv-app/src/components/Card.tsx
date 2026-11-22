import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { CatalogItem } from '../api';
import { Focusable } from '../focus/Focusable';
import { colors, px } from '../theme';

export const CARD_WIDTH = px(400);
export const CARD_HEIGHT = px(225);

interface CardProps {
  readonly item: CatalogItem;
  readonly onFocusItem: (item: CatalogItem) => void;
  readonly onSelectItem: (item: CatalogItem) => void;
}

/** A 16:9 title card. testID `card_<itemId>`. */
export const Card = memo(function Card({ item, onFocusItem, onSelectItem }: CardProps) {
  return (
    <Focusable
      testID={`card_${item.id}`}
      style={({ focused }) => [styles.card, focused && styles.focused]}
      onFocus={() => onFocusItem(item)}
      onPress={() => onSelectItem(item)}
    >
      <View
        style={[
          styles.art,
          { backgroundImage: `linear-gradient(135deg, ${item.colors[0]}, ${item.colors[1]})` },
        ]}
      >
        <Text style={styles.title} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={styles.meta}>
          {item.year} · {item.genre}
        </Text>
      </View>
    </Focusable>
  );
});

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: px(16),
    borderWidth: px(4),
    borderColor: 'transparent',
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  focused: { borderColor: colors.focus, transform: [{ scale: 1.06 }] },
  art: { flex: 1, justifyContent: 'flex-end', padding: px(20) },
  title: { color: colors.text, fontSize: px(32), fontWeight: '700' },
  meta: { color: colors.text, opacity: 0.8, fontSize: px(22), marginTop: px(4) },
});
