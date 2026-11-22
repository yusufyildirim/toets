import { listPackages } from '../.vitepress/packages.ts';

/** One overview page per published package, listing the pages in its own `docs/` folder. */
export default {
  watch: ['../../packages/*/package.json', '../../packages/*/docs/**/*.md'],
  paths() {
    return listPackages().map((pkg) => ({
      params: {
        pkg: pkg.dir,
        name: pkg.name,
        description: pkg.description,
        pages: pkg.pages.map(({ title, description, link }) => ({ title, description, link })),
      },
    }));
  },
};
