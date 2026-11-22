/** Wire types of the example JSON API, shared by the app and the dev API server. */

/** A title as shown on a rail card. */
export interface CatalogItem {
  readonly id: string;
  readonly title: string;
  readonly year: number;
  readonly genre: string;
  /** Two CSS colors used to paint the card artwork as a gradient. */
  readonly colors: readonly [string, string];
}

/** A horizontal row of titles on the home screen. */
export interface Rail {
  readonly id: string;
  readonly title: string;
  readonly items: readonly CatalogItem[];
}

/** `GET /api/catalog` */
export interface Catalog {
  readonly rails: readonly Rail[];
}

/** `GET /api/items/:id` */
export interface ItemDetails extends CatalogItem {
  readonly description: string;
  /** Runtime in minutes. */
  readonly runtime: number;
  /** Progressive MP4 (H.264/AAC) playable on every target platform. */
  readonly streamUrl: string;
}
