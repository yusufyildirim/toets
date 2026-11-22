import { describe, expect, it } from 'vitest';
import { DpadError } from '../src/errors.js';

describe('DpadError', () => {
  const error = new DpadError('ELEMENT_NOT_FOUND', 'Nothing matched.', {
    hint: 'Check the test ID.',
    docs: 'reference/core/docs/locators',
  });

  it('prints code, hint and docs with the offline path of package pages', () => {
    expect(error.toString()).toBe(
      [
        'DpadError [ELEMENT_NOT_FOUND]: Nothing matched.',
        'Hint: Check the test ID.',
        'Docs: reference/core/docs/locators (offline: node_modules/@dpad-tv/core/docs/locators.md)',
      ].join('\n'),
    );
  });

  it('leads the stack with the same text, so runners that print stacks show it', () => {
    expect(error.stack?.startsWith(`${error.toString()}\n    at `)).toBe(true);
    expect(error.message).toBe('Nothing matched.');
  });

  it('keeps guide paths as they are', () => {
    expect(new DpadError('X', 'm', { docs: 'concepts/focus' }).toString()).toBe(
      'DpadError [X]: m\nDocs: concepts/focus',
    );
  });
});
