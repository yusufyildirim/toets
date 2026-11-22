import type { ViewStyle } from 'react-native';

/**
 * Web: focus is drawn by each component's focused style, so drop the browser's focus ring.
 * react-native-web passes `outlineStyle: 'none'` through; RN's types only know border styles.
 */
export const hideFocusRing = { outlineStyle: 'none' } as unknown as ViewStyle;
