import type { Catalog, ItemDetails } from '../src/api/types.ts';

/**
 * Public, CORS-friendly test streams (W3C media test files). Not the W3C bunny trailer: its
 * 853px width breaks the Android emulator's H.264 decoder.
 */
const STREAMS = [
  'https://media.w3.org/2010/05/sintel/trailer.mp4',
  'https://media.w3.org/2010/05/video/movie_300.mp4',
] as const;

const PALETTES: readonly (readonly [string, string])[] = [
  ['#ff6b6b', '#5f27cd'],
  ['#1dd1a1', '#0a3d62'],
  ['#feca57', '#ee5253'],
  ['#48dbfb', '#341f97'],
  ['#ff9ff3', '#6c5ce7'],
  ['#00d2d3', '#222f3e'],
  ['#f368e0', '#c0392b'],
  ['#54a0ff', '#10ac84'],
];

interface Seed {
  readonly title: string;
  readonly year: number;
  readonly genre: string;
  readonly runtime: number;
  readonly description: string;
}

const RAILS: readonly { id: string; title: string; seeds: readonly Seed[] }[] = [
  {
    id: 'trending',
    title: 'Trending now',
    seeds: [
      {
        title: 'Northern Lights',
        year: 2025,
        genre: 'Drama',
        runtime: 112,
        description:
          'A lighthouse keeper on a remote island starts receiving letters from a stranger who claims to be her future self.',
      },
      {
        title: 'Signal Lost',
        year: 2024,
        genre: 'Thriller',
        runtime: 98,
        description:
          'When every screen in the city goes dark, a radio engineer becomes the only link between two halves of a divided town.',
      },
      {
        title: 'Paper Planes',
        year: 2025,
        genre: 'Comedy',
        runtime: 94,
        description:
          'Three retired pilots enter a children’s paper plane contest and take it far more seriously than anyone should.',
      },
      {
        title: 'The Long Orbit',
        year: 2023,
        genre: 'Sci-fi',
        runtime: 131,
        description:
          'The crew of a slow cargo ship discovers they are not alone on a journey that will outlast them all.',
      },
      {
        title: 'Saltwater',
        year: 2024,
        genre: 'Drama',
        runtime: 105,
        description:
          'A family of fishers fights to keep their harbour alive as a storm season unlike any other approaches.',
      },
      {
        title: 'Night Market',
        year: 2025,
        genre: 'Crime',
        runtime: 101,
        description:
          'An undercover chef infiltrates a midnight food market run by the city’s most charming smuggler.',
      },
      {
        title: 'Second Verse',
        year: 2022,
        genre: 'Music',
        runtime: 117,
        description:
          'A one-hit wonder gets a last chance at a comeback when her old song goes viral thirty years later.',
      },
      {
        title: 'Glasshouse',
        year: 2024,
        genre: 'Mystery',
        runtime: 109,
        description:
          'Guests at a botanical estate start disappearing one by one, and the plants seem to know why.',
      },
    ],
  },
  {
    id: 'new',
    title: 'New releases',
    seeds: [
      {
        title: 'Afterglow',
        year: 2026,
        genre: 'Romance',
        runtime: 103,
        description: 'Two strangers keep meeting on the last train home, every night, for a year.',
      },
      {
        title: 'Ironwood',
        year: 2026,
        genre: 'Western',
        runtime: 124,
        description:
          'A retired marshal returns to the frontier town she swore she would never see again.',
      },
      {
        title: 'Low Tide',
        year: 2026,
        genre: 'Thriller',
        runtime: 96,
        description:
          'A diver finds something on the seabed that a powerful company would rather keep buried.',
      },
      {
        title: 'Small Hours',
        year: 2026,
        genre: 'Comedy',
        runtime: 88,
        description:
          'A night-shift radio host and her only caller try to save a failing station before sunrise.',
      },
      {
        title: 'Cartographers',
        year: 2026,
        genre: 'Adventure',
        runtime: 119,
        description: 'Mapmakers chart an island that changes shape every time they look away.',
      },
      {
        title: 'Halfway Home',
        year: 2025,
        genre: 'Drama',
        runtime: 107,
        description:
          'A road trip across the country turns into a reckoning for two estranged brothers.',
      },
      {
        title: 'Static',
        year: 2026,
        genre: 'Horror',
        runtime: 92,
        description:
          'An old television starts broadcasting tomorrow’s news, and tomorrow looks grim.',
      },
      {
        title: 'Blue Hour',
        year: 2026,
        genre: 'Drama',
        runtime: 110,
        description:
          'A photographer chases the perfect light in the twenty minutes after every sunset.',
      },
    ],
  },
  {
    id: 'documentaries',
    title: 'Documentaries',
    seeds: [
      {
        title: 'Deep Forest',
        year: 2024,
        genre: 'Nature',
        runtime: 52,
        description:
          'A year inside the oldest forest in Europe, filmed from the canopy to the roots.',
      },
      {
        title: 'Made by Hand',
        year: 2025,
        genre: 'Craft',
        runtime: 48,
        description:
          'Portraits of makers keeping centuries-old crafts alive in a machine-made world.',
      },
      {
        title: 'The Coldest City',
        year: 2023,
        genre: 'Travel',
        runtime: 55,
        description:
          'Daily life in a city where winter lasts nine months and the sun sets for weeks.',
      },
      {
        title: 'Signals from Space',
        year: 2025,
        genre: 'Science',
        runtime: 61,
        description:
          'The scientists listening to the sky and the faint signals they cannot explain.',
      },
      {
        title: 'Street Food Atlas',
        year: 2024,
        genre: 'Food',
        runtime: 45,
        description: 'One dish, ten cities: how a simple flatbread conquered the world’s streets.',
      },
      {
        title: 'Wild Rivers',
        year: 2022,
        genre: 'Nature',
        runtime: 58,
        description: 'Following three rivers from mountain spring to open sea.',
      },
      {
        title: 'Arcade',
        year: 2025,
        genre: 'History',
        runtime: 50,
        description: 'The rise, fall and unexpected return of the video game arcade.',
      },
      {
        title: 'Night Shift',
        year: 2024,
        genre: 'Society',
        runtime: 47,
        description: 'The people who keep a city running while everyone else sleeps.',
      },
    ],
  },
  {
    id: 'family',
    title: 'Family',
    seeds: [
      {
        title: 'Robo Pals',
        year: 2025,
        genre: 'Animation',
        runtime: 84,
        description: 'A tiny repair robot and a lost satellite team up to find their way home.',
      },
      {
        title: 'The Kite Club',
        year: 2024,
        genre: 'Adventure',
        runtime: 91,
        description: 'A group of kids builds the biggest kite their town has ever seen.',
      },
      {
        title: 'Moon Bakery',
        year: 2025,
        genre: 'Animation',
        runtime: 79,
        description: 'A bakery on the moon delivers cakes to every planet in the solar system.',
      },
      {
        title: 'Treehouse Rules',
        year: 2023,
        genre: 'Comedy',
        runtime: 86,
        description:
          'Siblings declare their treehouse an independent nation, with predictable chaos.',
      },
      {
        title: 'Dragon Days',
        year: 2024,
        genre: 'Fantasy',
        runtime: 95,
        description: 'A shy dragon enrolls at a school for knights, undercover.',
      },
      {
        title: 'Snow Puppies',
        year: 2025,
        genre: 'Animation',
        runtime: 72,
        description: 'Six puppies explore their first winter in the mountains.',
      },
      {
        title: 'Captain Pancake',
        year: 2022,
        genre: 'Comedy',
        runtime: 81,
        description: 'A breakfast-obsessed superhero saves the day, one stack at a time.',
      },
      {
        title: 'The Map Room',
        year: 2024,
        genre: 'Mystery',
        runtime: 88,
        description: 'A secret room in the library holds a map to every lost thing in the world.',
      },
    ],
  },
];

function buildItems(): ItemDetails[] {
  const items: ItemDetails[] = [];
  RAILS.forEach((rail, railIndex) => {
    rail.seeds.forEach((seed, index) => {
      const n = items.length;
      items.push({
        id: `${rail.id}-${index + 1}`,
        ...seed,
        colors: PALETTES[(index + railIndex * 3) % PALETTES.length]!,
        streamUrl: STREAMS[n % STREAMS.length]!,
      });
    });
  });
  return items;
}

/** Every title, keyed by id. */
export const ITEMS: ReadonlyMap<string, ItemDetails> = new Map(
  buildItems().map((item) => [item.id, item]),
);

/** The home screen catalog: rails of lightweight cards. */
export const CATALOG: Catalog = {
  rails: RAILS.map((rail) => ({
    id: rail.id,
    title: rail.title,
    items: rail.seeds.map((_, index) => {
      const { id, title, year, genre, colors } = ITEMS.get(`${rail.id}-${index + 1}`)!;
      return { id, title, year, genre, colors };
    }),
  })),
};
