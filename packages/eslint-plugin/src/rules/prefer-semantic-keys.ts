import { Key } from '@dpad-tv/core';
import type { Rule } from 'eslint';
import type { Node } from 'estree';
import { ruleDocsUrl, staticName, unwrap } from '../utils.js';

/** Remote methods whose first argument is a key (`sequence`: an array of keys). */
const KEY_METHODS = new Set(['press', 'longPress', 'repeat', 'sequence']);

/** Raw key names commonly copied from web, Android and tvOS code, mapped to semantic keys. */
const ALIASES: Readonly<Record<string, Key>> = {
  ArrowUp: Key.UP,
  ArrowDown: Key.DOWN,
  ArrowLeft: Key.LEFT,
  ArrowRight: Key.RIGHT,
  Enter: Key.SELECT,
  OK: Key.SELECT,
  Escape: Key.BACK,
  Backspace: Key.BACK,
  GoBack: Key.BACK,
  MediaPlayPause: Key.PLAY_PAUSE,
  MediaPlay: Key.PLAY,
  MediaPause: Key.PAUSE,
  MediaStop: Key.STOP,
  MediaFastForward: Key.FAST_FORWARD,
  MediaRewind: Key.REWIND,
  KEYCODE_DPAD_UP: Key.UP,
  KEYCODE_DPAD_DOWN: Key.DOWN,
  KEYCODE_DPAD_LEFT: Key.LEFT,
  KEYCODE_DPAD_RIGHT: Key.RIGHT,
  KEYCODE_DPAD_CENTER: Key.SELECT,
  KEYCODE_ENTER: Key.SELECT,
  KEYCODE_BACK: Key.BACK,
  KEYCODE_HOME: Key.HOME,
  KEYCODE_MENU: Key.MENU,
  KEYCODE_MEDIA_PLAY_PAUSE: Key.PLAY_PAUSE,
  playPause: Key.PLAY_PAUSE,
};

const KEYS = new Set<string>(Object.values(Key));

export const preferSemanticKeys: Rule.RuleModule = {
  meta: {
    type: 'problem',
    hasSuggestions: true,
    docs: {
      description: 'Require semantic `Key` values for remote presses instead of raw keycodes.',
      recommended: true,
      url: ruleDocsUrl('prefer-semantic-keys'),
    },
    schema: [],
    messages: {
      rawKeycode:
        'Raw keycode `{{raw}}` only means something on one platform. Use a semantic key (`Key.UP`, `Key.SELECT`, ...) from `@dpad-tv/test`; drivers map it per platform.',
      rawString:
        'String key `{{raw}}` bypasses the `Key` type and its per-platform mapping. Use `Key.{{key}}` from `@dpad-tv/test`.',
      unknownKey:
        '`{{raw}}` is not a dpad key. Use a semantic key (`Key.UP`, `Key.SELECT`, `Key.BACK`, ...) from `@dpad-tv/test`; drivers map it per platform.',
      useKey: 'Replace with `Key.{{key}}` (import `Key` from `@dpad-tv/test`).',
    },
  },
  create(context) {
    function check(arg: Node | undefined): void {
      if (!arg) return;
      const node = unwrap(arg);
      if (node.type === 'TemplateLiteral') {
        context.report({ node, messageId: 'unknownKey', data: { raw: '`...`' } });
        return;
      }
      if (node.type !== 'Literal') return;
      const raw = context.sourceCode.getText(node);
      if (typeof node.value === 'number') {
        context.report({ node, messageId: 'rawKeycode', data: { raw } });
        return;
      }
      if (typeof node.value !== 'string') return;
      const upper = node.value.toUpperCase();
      const key = KEYS.has(upper) ? (upper as Key) : ALIASES[node.value];
      if (!key) {
        context.report({ node, messageId: 'unknownKey', data: { raw } });
        return;
      }
      context.report({
        node,
        messageId: KEYS.has(node.value) ? 'rawString' : 'unknownKey',
        data: { raw, key },
        suggest: [
          {
            messageId: 'useKey',
            data: { key },
            fix: (fixer) => fixer.replaceText(arg, `Key.${key}`),
          },
        ],
      });
    }

    return {
      CallExpression(node) {
        const callee = unwrap(node.callee);
        if (callee.type !== 'MemberExpression') return;
        const method = staticName(callee);
        if (!method || !KEY_METHODS.has(method)) return;
        if (!/remote$/i.test(staticName(callee.object as Node) ?? '')) return;

        const first = node.arguments[0] as Node | undefined;
        if (method === 'sequence') {
          const list = first && unwrap(first);
          if (list?.type === 'ArrayExpression') {
            for (const el of list.elements) if (el && el.type !== 'SpreadElement') check(el);
          }
          return;
        }
        check(first);
      },
    };
  },
};
