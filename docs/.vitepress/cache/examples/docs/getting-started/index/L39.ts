import { defineConfig, platforms } from '@dpad-tv/test';

export default defineConfig({
  testDir: './e2e',
  app: {
    web: { url: 'http://localhost:8080' },
    androidTV: { apk: './build/app-debug.apk', package: 'com.example.tv' },
    tvOS: { app: './build/Example.app', bundleId: 'com.example.tv' },
  },
  projects: [
    platforms.web(),
    platforms.androidTV({ avd: 'tv_1080p', api: 34 }),
    platforms.tvOS({ runtime: '18' }),
  ],
});
