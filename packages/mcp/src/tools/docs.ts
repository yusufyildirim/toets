import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { excerpt } from '../docs/search.js';
import { guarded, text, type ToolContext } from './shared.js';

export function registerDocsTools(server: McpServer, { docs }: ToolContext): void {
  server.registerTool(
    'docs_search',
    {
      title: 'Search toets docs',
      description: [
        'Search the toets documentation shipped with the installed @toets packages (test API, locators, matchers, keys, focus, capabilities, config, page objects, platforms, errors).',
        'Returns the best matching sections with their file paths. Use it before writing test code you are unsure about, and to look up an error code or hint.',
        'Works without a running app.',
      ].join(' '),
      inputSchema: z.object({
        query: z
          .string()
          .min(2)
          .describe('Keywords or an API name, e.g. "navigateTo", "long press", "page objects".'),
        limit: z.number().int().min(1).max(10).optional().describe('Max sections. Default 5.'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ query, limit }) =>
      guarded(async () => {
        const index = await docs();
        if (!index.sectionCount) {
          return text(
            'No toets docs found.',
            `Looked in node_modules/@toets/*/docs above the working directory${
              index.sources.length ? ` and ${index.sources.map((s) => s.dir).join(', ')}` : ''
            }. Install the toets packages you use (e.g. @toets/test) in the project.`,
          );
        }
        const hits = index.search(query, limit ?? 5);
        if (!hits.length) {
          return text(
            `No docs match "${query}". Try fewer or different keywords (API names work well).`,
          );
        }
        return text(
          ...hits.flatMap((hit, i) => [
            `[${i + 1}] ${hit.packageName} > ${hit.page} > ${hit.heading}`,
            `Path: ${hit.path}`,
            '',
            excerpt(hit.text),
            '',
          ]),
        );
      }),
  );
}
