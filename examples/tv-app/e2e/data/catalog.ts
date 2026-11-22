import { http, HttpResponse } from '@dpad-tv/test';

import type { Catalog, ItemDetails } from '../../src/api/types.js';

/** A tiny catalog for tests that assert on exact data. */
export const PICKS: Catalog = {
  rails: [
    {
      id: 'picks',
      title: 'Test picks',
      items: [
        { id: 'pick-1', title: 'First Pick', year: 2020, genre: 'Drama', colors: ['#111', '#222'] },
        {
          id: 'pick-2',
          title: 'Second Pick',
          year: 2021,
          genre: 'Comedy',
          colors: ['#333', '#444'],
        },
      ],
    },
  ],
};

export const PICK_1: ItemDetails = {
  ...PICKS.rails[0]!.items[0]!,
  description: 'A test title with a fixed description.',
  runtime: 75,
  streamUrl: 'https://media.w3.org/2010/05/video/movie_300.mp4',
};

/** Handlers serving {@link PICKS} and {@link PICK_1}. */
export const picksApi = [
  http.get('*/api/catalog', () => HttpResponse.json(PICKS)),
  http.get('*/api/items/pick-1', () => HttpResponse.json(PICK_1)),
];
