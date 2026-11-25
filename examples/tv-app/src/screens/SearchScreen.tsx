import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api, type CatalogItem } from '../api';
import { useRequest } from '../api/useRequest';
import { OnScreenKeyboard } from '../components/OnScreenKeyboard';
import { Screen } from '../components/Screen';
import { FocusGroup } from '../focus/FocusGroup';
import { Focusable } from '../focus/Focusable';
import { CONTENT_INSET, colors, px } from '../theme';

/**
 * Search with an app-drawn keyboard and no native text input, as most TV apps do it. SELECT on
 * the query field opens the keyboard; results narrow as you type; Go submits and closes it,
 * BACK closes it.
 */
export function SearchScreen({ visible }: { visible: boolean }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [closedOnce, setClosedOnce] = useState(false);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const needle = query.trim().toLowerCase();

  const close = () => {
    setOpen(false);
    setClosedOnce(true);
  };

  return (
    <Screen
      id="search"
      testID="screen_search"
      visible={visible}
      // Focus returns to the field when the keyboard closes.
      initialFocusKey={!open && closedOnce ? 'search_query' : undefined}
    >
      <View style={styles.container}>
        <Text style={styles.heading}>Search</Text>
        <FocusGroup style={styles.fieldRow}>
          <View style={styles.fieldBox}>
            <Focusable
              testID="search_query"
              style={({ focused }) => [styles.field, focused && styles.fieldFocused]}
              onPress={() => setOpen(true)}
            >
              <Text style={styles.fieldText}>{query}</Text>
            </Focusable>
            {/* The placeholder sits outside the field element: the field's text is the query only. */}
            {query === '' && (
              <Text
                testID="search_placeholder"
                pointerEvents="none"
                style={[styles.fieldText, styles.placeholder]}
              >
                Titles, genres
              </Text>
            )}
          </View>
        </FocusGroup>
        {open && visible && (
          <OnScreenKeyboard
            id="search_keyboard"
            onKey={(char) => setQuery((q) => q + char)}
            onDelete={() => setQuery((q) => q.slice(0, -1))}
            onClear={() => setQuery('')}
            onSubmit={() => {
              setSubmitted(query);
              close();
            }}
            onClose={close}
          />
        )}
        {submitted !== null && (
          <Text testID="search_submitted" style={styles.submitted}>
            {`Results for "${submitted}"`}
          </Text>
        )}
        <View testID="search_results" style={styles.results}>
          {needle !== '' && <SearchResults needle={needle} />}
        </View>
      </View>
    </Screen>
  );
}

/** Titles matching `needle`; loads the catalog once mounted (the first typed character). */
function SearchResults({ needle }: { needle: string }) {
  const catalog = useRequest('catalog', (signal) => api.getCatalog(signal));
  const items = useMemo(() => {
    if (catalog.status !== 'success') return [];
    const all = new Map<string, CatalogItem>();
    for (const rail of catalog.data.rails) for (const item of rail.items) all.set(item.id, item);
    return [...all.values()];
  }, [catalog]);
  if (catalog.status !== 'success') return null;
  const results = items.filter((i) => i.title.toLowerCase().includes(needle));
  return (
    <>
      {results.length === 0 && (
        <Text testID="search_empty" style={styles.result}>
          No results
        </Text>
      )}
      {results.slice(0, 6).map((item) => (
        <Text key={item.id} testID={`search_result_${item.id}`} style={styles.result}>
          {item.title}
        </Text>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: CONTENT_INSET, paddingTop: px(72), gap: px(28) },
  heading: { color: colors.text, fontSize: px(64), fontWeight: '800' },
  fieldRow: { alignSelf: 'flex-start' },
  fieldBox: { width: px(720) },
  field: {
    height: px(80),
    justifyContent: 'center',
    paddingHorizontal: px(28),
    borderRadius: px(12),
    backgroundColor: colors.surface,
    borderWidth: px(4),
    borderColor: 'transparent',
  },
  fieldFocused: { borderColor: colors.focus },
  fieldText: { color: colors.text, fontSize: px(32) },
  placeholder: {
    position: 'absolute',
    left: px(32),
    top: px(20),
    color: colors.textMuted,
  },
  submitted: { color: colors.textMuted, fontSize: px(26) },
  results: { gap: px(10) },
  result: { color: colors.text, fontSize: px(30) },
});
