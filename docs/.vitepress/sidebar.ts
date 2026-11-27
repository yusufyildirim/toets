/**
 * Site structure. One source for the sidebar, the nav and the order of llms.txt.
 * Page slugs are stable: errors (`ToetsError.docs`) and skills reference them.
 */
import type { DefaultTheme } from 'vitepress';
import { listPackages } from './packages.ts';

export interface Section {
  readonly text: string;
  readonly items: readonly DefaultTheme.SidebarItem[];
  readonly collapsed?: boolean;
}

export function sections(): Section[] {
  return [
    {
      text: 'Getting started',
      items: [
        { text: 'Install and first test', link: '/getting-started/' },
        { text: 'Working with agents', link: '/getting-started/agents' },
      ],
    },
    {
      text: 'Concepts',
      items: [
        { text: 'Locators and assertions', link: '/concepts/locators-and-assertions' },
        { text: 'Focus', link: '/concepts/focus' },
        { text: 'Remote and keys', link: '/concepts/remote-and-keys' },
        { text: 'Capabilities and parity', link: '/concepts/capabilities' },
        { text: 'Idle and synchronization', link: '/concepts/idle' },
        { text: 'Network mocking', link: '/concepts/network-mocking' },
        { text: 'Text input', link: '/concepts/text-input' },
        { text: 'Deep links', link: '/concepts/deep-links' },
        { text: 'Page objects', link: '/concepts/page-objects' },
        { text: 'The in-app SDK', link: '/concepts/sdk' },
        { text: 'Text snapshots', link: '/concepts/text-snapshots' },
      ],
    },
    {
      text: 'Guides',
      items: [
        { text: 'Writing tests', link: '/guides/writing-tests' },
        { text: 'Debugging failures', link: '/guides/debugging-failures' },
        { text: 'Serial flows', link: '/guides/serial-flows' },
        { text: 'From Playwright', link: '/guides/migrating/from-playwright' },
        { text: 'From Appium / WebdriverIO', link: '/guides/migrating/from-appium' },
        { text: 'From Detox', link: '/guides/migrating/from-detox' },
      ],
    },
    {
      text: 'Platforms',
      items: [
        { text: 'Web', link: '/platforms/web' },
        { text: 'Android TV / Fire TV', link: '/platforms/android-tv' },
        { text: 'tvOS', link: '/platforms/tvos' },
      ],
    },
    {
      text: 'CI recipes',
      items: [
        { text: 'Overview', link: '/ci/' },
        { text: 'Android TV on Linux', link: '/ci/android' },
        { text: 'tvOS on macOS', link: '/ci/tvos' },
        { text: 'Caching', link: '/ci/caching' },
        { text: 'Artifacts and reports', link: '/ci/artifacts' },
      ],
    },
    {
      text: 'Reference',
      collapsed: true,
      items: [
        { text: 'Overview', link: '/reference/' },
        ...listPackages().map((pkg) => ({
          text: pkg.name,
          link: `/reference/${pkg.dir}`,
          collapsed: true,
          ...(pkg.pages.length > 0
            ? { items: pkg.pages.map((p) => ({ text: p.title, link: p.link })) }
            : {}),
        })),
      ],
    },
    {
      text: 'Agent skills',
      collapsed: true,
      items: [
        { text: 'toets-setup', link: '/skills/toets-setup' },
        { text: 'toets-write-tests', link: '/skills/toets-write-tests' },
        { text: 'toets-debug-failures', link: '/skills/toets-debug-failures' },
        { text: 'toets-migrate', link: '/skills/toets-migrate' },
      ],
    },
  ];
}

export function sidebar(): DefaultTheme.SidebarItem[] {
  return sections().map((s) => ({ ...s, items: [...s.items] }));
}

export const nav: DefaultTheme.NavItem[] = [
  { text: 'Getting started', link: '/getting-started/' },
  { text: 'Concepts', link: '/concepts/locators-and-assertions', activeMatch: '^/concepts/' },
  { text: 'Guides', link: '/guides/writing-tests', activeMatch: '^/guides/' },
  { text: 'Platforms', link: '/platforms/web', activeMatch: '^/platforms/' },
  { text: 'CI', link: '/ci/', activeMatch: '^/ci/' },
  { text: 'Reference', link: '/reference/', activeMatch: '^/reference/' },
];
