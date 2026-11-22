import { Dimensions } from 'react-native';

/**
 * Layout is designed on a 1920x1080 canvas and scaled to the window, so the app looks the
 * same on a 1080p Android TV (960dp wide), an Apple TV (1920pt) and any browser viewport.
 */
const scale = Dimensions.get('window').width / 1920;

/** Converts design pixels (1920-wide canvas) to layout units. */
export function px(value: number): number {
  return Math.round(value * scale);
}

export const colors = {
  background: '#0b0e14',
  surface: '#151a24',
  surfaceRaised: '#1e2533',
  accent: '#4f8cff',
  text: '#f5f7fa',
  textMuted: '#9aa4b5',
  focus: '#ffffff',
  danger: '#ff6b6b',
} as const;

export const SIDE_MENU_WIDTH = px(300);
export const CONTENT_INSET = px(64);
