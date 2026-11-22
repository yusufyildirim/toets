import { memo } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import type { CatalogItem, Rail as RailData } from '../api';
import { FocusGroup } from '../focus/FocusGroup';
import { CONTENT_INSET, colors, px } from '../theme';
import { Card, CARD_HEIGHT } from './Card';

interface RailProps {
  readonly rail: RailData;
  readonly onFocusItem: (item: CatalogItem) => void;
  readonly onSelectItem: (item: CatalogItem) => void;
}

/** A titled horizontal row of cards that remembers its focused card. testID `rail_<railId>`. */
export const Rail = memo(function Rail({ rail, onFocusItem, onSelectItem }: RailProps) {
  return (
    <View testID={`rail_${rail.id}`} style={styles.rail}>
      <Text testID={`rail_${rail.id}_title`} style={styles.title}>
        {rail.title}
      </Text>
      <FocusGroup>
        <FlatList
          horizontal
          data={rail.items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Card item={item} onFocusItem={onFocusItem} onSelectItem={onSelectItem} />
          )}
          showsHorizontalScrollIndicator={false}
          style={styles.list}
          contentContainerStyle={styles.content}
        />
      </FocusGroup>
    </View>
  );
});

const styles = StyleSheet.create({
  rail: { marginBottom: px(36) },
  title: {
    color: colors.text,
    fontSize: px(34),
    fontWeight: '700',
    marginLeft: CONTENT_INSET,
    marginBottom: px(12),
  },
  // Room for the focused card's scale-up so it is not clipped.
  list: { height: CARD_HEIGHT + px(40) },
  content: { paddingHorizontal: CONTENT_INSET, paddingVertical: px(20), gap: px(32) },
});
