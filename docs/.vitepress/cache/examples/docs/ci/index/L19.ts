import { defineConfig, platforms } from '@dpad-tv/test';

const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  retries: ci ? 1 : 0,
  workers: ci ? 2 : '50%',
  reporter: ci ? [['blob'], ['github']] : 'html',
  app: {
    web: { url: 'http://localhost:8080' },
    androidTV: { apk: './build/app-debug.apk', package: 'com.example.tv' },
    tvOS: { app: './build/Example.app', bundleId: 'com.example.tv' },
  },
  projects: [platforms.web(), platforms.androidTV({ api: 34 }), platforms.tvOS({ runtime: '18' })],
});
