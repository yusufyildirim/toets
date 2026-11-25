/**
 * The toets conformance fixture (see @toets/protocol docs/conformance.md) implemented with
 * the web adapter, plus a few extras used by the Chromium round-trip tests.
 */
import { CONFORMANCE_FIXTURE } from '@toets/protocol';
import { markBusy, onState, reportFocus, startToets } from '../../src/web/index.js';

const { testIds, states, text, fieldValue, secretValue } = CONFORMANCE_FIXTURE;

document.body.innerHTML = `
  <style>
    .card { width: 200px; height: 100px; transition: transform 400ms; }
    .card.grow { transform: scale(1.2); }
    @keyframes spin { to { transform: rotate(360deg); } }
    .spinner { width: 10px; height: 10px; animation: spin 1s linear infinite; }
  </style>
  <main>
    <button class="card" data-testid="${testIds.a}">A</button>
    <button class="card" data-testid="${testIds.b}">B</button>
    <p data-testid="${testIds.text}">${text}</p>
    <input data-testid="${testIds.field}" value="${fieldValue}" placeholder="Name" />
    <input data-testid="${testIds.secret}" type="password" value="${secretValue}" />
    <div class="spinner" data-testid="spinner"></div>
  </main>`;

const byTestId = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement;

onState(async (state, flags) => {
  if (state === states.focusA) byTestId(testIds.a).focus();
  else if (state === states.focusB) byTestId(testIds.b).focus();
  else if (state === states.log) console.info(String(flags.marker));
  else if (state === states.busy) {
    const done = markBusy('conformance busy');
    setTimeout(done, Number(flags.ms));
  } else if (state === states.fail) throw new Error('conformance failure');
  else if (state === 'grow') byTestId(testIds.a).classList.add('grow');
  else if (state === 'js-engine') startJsFocusEngine();
});

/**
 * A minimal JS focus engine: tiles are plain divs (no DOM focus); arrow keys move a `focused`
 * class and the engine reports each move with `reportFocus()`.
 */
function startJsFocusEngine(): void {
  const row = document.createElement('div');
  row.innerHTML = [0, 1, 2]
    .map((i) => `<div class="tile" data-testid="tile-${i}">Tile ${i}</div>`)
    .join('');
  document.body.appendChild(row);
  const tiles = Array.from(row.children);
  let index = 0;
  const focus = (i: number) => {
    tiles[index]?.classList.remove('focused');
    index = Math.max(0, Math.min(tiles.length - 1, i));
    tiles[index]?.classList.add('focused');
    reportFocus(tiles[index] ?? null);
  };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') focus(index + 1);
    if (e.key === 'ArrowLeft') focus(index - 1);
  });
  focus(0);
}

startToets();
