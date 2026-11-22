import { defineConfig, platforms } from '@dpad-tv/test';

export default defineConfig({
  app: { web: { url: 'http://localhost:8080' } },
  projects: [platforms.web()],
});
