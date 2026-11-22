import { LAUNCH_PARAM, encodeLaunchPayloadParam, type LaunchPayload } from '@dpad-tv/protocol';
import { describe, expect, it } from 'vitest';
import { launchUrl } from './launch.js';

const payload: LaunchPayload = {
  v: 1,
  sdkUrl: 'ws://localhost:9323',
  token: 'ä/+?',
  state: 'home',
};

describe('web launch url', () => {
  it('adds the base64url parameter, keeping query and hash routes', () => {
    const url = new URL(launchUrl(new URL('http://localhost:3000/tv/?lang=en#/home'), payload));
    expect(url.pathname).toBe('/tv/');
    expect(url.searchParams.get('lang')).toBe('en');
    expect(url.searchParams.get(LAUNCH_PARAM)).toBe(encodeLaunchPayloadParam(payload));
    expect(url.hash).toBe('#/home');
  });

  it('replaces an existing parameter', () => {
    const url = new URL(launchUrl(new URL(`http://localhost:3000/?${LAUNCH_PARAM}=old`), payload));
    expect(url.searchParams.getAll(LAUNCH_PARAM)).toEqual([encodeLaunchPayloadParam(payload)]);
  });
});
