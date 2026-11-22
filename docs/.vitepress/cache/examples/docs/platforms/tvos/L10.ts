import { defineConfig, platforms } from '@dpad-tv/test';

export default defineConfig({
  app: { tvOS: { app: './build/Example.app', bundleId: 'com.example.tv' } },
  projects: [platforms.tvOS({ runtime: '18' })],
});
