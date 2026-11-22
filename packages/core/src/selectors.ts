/** One step of a locator chain. Each step searches within the matches of the previous one. */
export type Selector =
  | { readonly kind: 'testId'; readonly value: string }
  | {
      readonly kind: 'text';
      readonly value: string | RegExp;
      /** Exact, case-sensitive match of the full text. Default: substring, case-insensitive. */
      readonly exact?: boolean;
    }
  | { readonly kind: 'focused' }
  | { readonly kind: 'nth'; readonly index: number };

/** A locator resolves by walking its chain from the root. */
export type SelectorChain = readonly Selector[];
