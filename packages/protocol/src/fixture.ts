/** Contract of the conformance fixture app. See `docs/conformance.md`. */
export const CONFORMANCE_FIXTURE = {
  testIds: {
    /** Focusable, visible element. */
    a: 'conformance-a',
    /** Second focusable, visible element. */
    b: 'conformance-b',
    /** Non-focusable element whose own text is {@link CONFORMANCE_FIXTURE.text}. */
    text: 'conformance-text',
  },
  text: 'Conformance',
  /** States the fixture's `onState` handler implements. */
  states: {
    /** Move focus to `conformance-a`. */
    focusA: 'conformance:focus-a',
    /** Move focus to `conformance-b`. */
    focusB: 'conformance:focus-b',
    /** Log `flags.marker` through the platform's normal console (level info). */
    log: 'conformance:log',
    /** Mark the app busy (kind `custom`) for `flags.ms` milliseconds. */
    busy: 'conformance:busy',
    /** Throw from the handler. */
    fail: 'conformance:fail',
  },
} as const;
