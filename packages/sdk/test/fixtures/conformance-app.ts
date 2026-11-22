/**
 * The dpad conformance fixture (see @dpad-tv/protocol docs/conformance.md) implemented with
 * the web adapter, plus a few extras used by the Chromium round-trip tests.
 */
import { CONFORMANCE_FIXTURE } from '@dpad-tv/protocol';
import { markBusy, onState, startDpad } from '../../src/web/index.js';

const { testIds, states, text } = CONFORMANCE_FIXTURE;

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
});

startDpad();
