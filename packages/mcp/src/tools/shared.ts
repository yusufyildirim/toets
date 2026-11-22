import { describeElement, DpadError, Key, type ElementSnapshot } from '@dpad-tv/core';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { DocsIndex } from '../docs/search.js';
import type { Session } from '../session.js';

/** What tool handlers share. */
export interface ToolContext {
  readonly session: Session;
  /** Lazily built docs index (first `docs_search` call). */
  readonly docs: () => Promise<DocsIndex>;
}

export const keySchema = z.enum(Object.values(Key) as [Key, ...Key[]]);

export const targetSchema = z
  .object({
    testId: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Test ID (web data-testid, Android resource-id, tvOS accessibilityIdentifier). Preferred: stable across platforms and languages.',
      ),
    text: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Visible text. Case-insensitive substring unless `exact`; matches the deepest element with that text. Searched inside `testId` when both are given.',
      ),
    exact: z.boolean().optional().describe('Match the full text exactly, case-sensitive.'),
    nth: z.number().int().min(0).optional().describe('0-based pick when several elements match.'),
  })
  .refine((t) => t.testId !== undefined || t.text !== undefined, {
    message: 'Give `testId` and/or `text`.',
  })
  .describe('Element to act on, using the same selectors as tests (test ID and/or text).');

export function text(...lines: string[]): CallToolResult {
  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

export function failure(...lines: string[]): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: lines.join('\n') }] };
}

/** Runs a handler, turning thrown errors into readable tool errors (code, hint, docs). */
export async function guarded(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof DpadError) return failure(error.toString());
    return failure(`Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** `Focus: card_1 "Movie 1"`, in the vocabulary of dpad failure messages. */
export function focusLine(el: ElementSnapshot | null): string {
  return el
    ? `Focus: ${describeElement(el)}`
    : 'Focus: nothing is focused (some TV apps show focus only after the first key press).';
}

/** A JavaScript string literal, as a test would write it. */
export function quote(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
  return `'${escaped}'`;
}
