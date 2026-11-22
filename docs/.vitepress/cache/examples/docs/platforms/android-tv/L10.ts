import { defineConfig, platforms } from '@dpad-tv/test';

export default defineConfig({
  app: { androidTV: { apk: './build/app-debug.apk', package: 'com.example.tv' } },
  projects: [platforms.androidTV({ avd: 'tv_1080p', api: 34 })],
});
