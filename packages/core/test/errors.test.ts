import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ToetsError } from '../src/errors.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('ToetsError', () => {
  const error = new ToetsError('ELEMENT_NOT_FOUND', 'Nothing matched.', {
    hint: 'Check the test ID.',
    docs: 'reference/core/docs/locators',
  });

  it('prints code, hint and docs with the offline path of package pages', () => {
    const offline = relative(process.cwd(), join(here, '../docs/locators.md'));
    expect(error.toString()).toBe(
      [
        'ToetsError [ELEMENT_NOT_FOUND]: Nothing matched.',
        'Hint: Check the test ID.',
        `Docs: reference/core/docs/locators (offline: ${offline})`,
      ].join('\n'),
    );
    expect(existsSync(offline)).toBe(true);
  });

  it('leads the stack with the same text, so runners that print stacks show it', () => {
    expect(error.stack?.startsWith(`${error.toString()}\n    at `)).toBe(true);
    expect(error.message).toBe('Nothing matched.');
  });

  it('keeps guide paths as they are', () => {
    expect(new ToetsError('X', 'm', { docs: 'concepts/focus' }).toString()).toBe(
      'ToetsError [X]: m\nDocs: concepts/focus',
    );
  });
});
