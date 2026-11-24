/* global window, document, location, localStorage, customElements, HTMLElement, URLSearchParams, TextDecoder, atob, console, setInterval, setTimeout */
// A tiny TV-style app: DOM focus moved by arrow keys, media keys, color keys.
'use strict';

const $ = (testId) => document.querySelector(`[data-testid="${testId}"]`);
const setAction = (text) => ($('last-action').textContent = text);

// Every key event, for assertions through the escape hatch.
window.__keys = [];
for (const type of ['keydown', 'keypress', 'keyup']) {
  window.addEventListener(
    type,
    (e) =>
      window.__keys.push({ type, key: e.key, code: e.code, keyCode: e.keyCode, repeat: e.repeat }),
    true,
  );
}

// Launch payload: `?__toets=<base64url(JSON)>` or `window.__TOETS__` (same encoding).
function decodeParam(param) {
  const bytes = Uint8Array.from(atob(param.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
    c.charCodeAt(0),
  );
  return new TextDecoder().decode(bytes);
}
function readPayload() {
  const param = new URLSearchParams(location.search).get('__toets');
  if (param) return { source: 'query', json: decodeParam(param) };
  if (typeof window.__TOETS__ === 'string') {
    return { source: 'global', json: decodeParam(window.__TOETS__) };
  }
  return { source: 'none', json: '' };
}
const payload = readPayload();
$('payload-source').textContent = payload.source;
$('payload').textContent = payload.json;

// Persistent state, to observe reset/clearData.
const launches = Number(localStorage.getItem('launches') ?? '0') + 1;
localStorage.setItem('launches', String(launches));
$('launches').textContent = `launches ${launches}`;

// Shadow DOM component with a slot.
customElements.define(
  'toets-badge',
  class extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML =
        '<span data-testid="badge-label">New</span> <slot></slot>';
    }
  },
);

// Rail of cards with focus memory and scrolling.
const track = document.querySelector('.rail-track');
for (let i = 1; i <= 10; i++) {
  const card = document.createElement('div');
  card.className = 'card';
  card.tabIndex = -1;
  card.dataset.testid = `card-${i}`;
  card.innerHTML = `<span class="card-title">Card ${i}</span>`;
  track.appendChild(card);
}
const cards = [...track.children];
const menu = [...document.querySelectorAll('.menu-item')];
const controls = [$('play-button'), $('locked-label'), $('icon-button')];
let railIndex = 0;

function scrollRail() {
  const first = Math.max(0, railIndex - 3);
  track.style.transform = `translateX(${-first * 320}px)`;
}

function move(dir) {
  const el = document.activeElement;
  if (cards.includes(el)) {
    const i = cards.indexOf(el);
    if (dir === 'right' && i < cards.length - 1) railIndex = i + 1;
    else if (dir === 'left' && i > 0) railIndex = i - 1;
    else if (dir === 'left') return menu[0].focus();
    else if (dir === 'down') return controls[0].focus();
    else return;
    scrollRail();
    cards[railIndex].focus();
  } else if (menu.includes(el)) {
    const i = menu.indexOf(el);
    if (dir === 'down' && i < menu.length - 1) menu[i + 1].focus();
    else if (dir === 'up' && i > 0) menu[i - 1].focus();
    else if (dir === 'right') cards[railIndex].focus();
  } else if (controls.includes(el)) {
    const i = controls.indexOf(el);
    if (dir === 'right' && i < controls.length - 1) controls[i + 1].focus();
    else if (dir === 'left' && i > 0) controls[i - 1].focus();
    else if (dir === 'up') cards[railIndex].focus();
  }
}

// Player fed by a canvas stream: plays without media files or codecs.
const video = $('player');
const canvas = document.createElement('canvas');
canvas.width = 320;
canvas.height = 180;
const g = canvas.getContext('2d');
let frame = 0;
setInterval(() => {
  g.fillStyle = `hsl(${frame++ % 360} 80% 50%)`;
  g.fillRect(0, 0, 320, 180);
}, 50);
video.srcObject = canvas.captureStream(20);
const playerState = $('player-state');
video.addEventListener('play', () => (playerState.textContent = 'playing'));
video.addEventListener('pause', () => (playerState.textContent = 'paused'));

const keyActions = {
  ArrowUp: () => move('up'),
  ArrowDown: () => move('down'),
  ArrowLeft: () => move('left'),
  ArrowRight: () => move('right'),
  Escape: () => setAction('back'),
  MediaPlayPause: () => (video.paused ? video.play() : video.pause()),
  MediaPlay: () => video.play(),
  MediaPause: () => video.pause(),
  ColorF0Red: () => {
    console.error('red pressed');
    setTimeout(() => {
      throw new Error('boom');
    });
  },
  ColorF1Green: () => {
    const rail = $('rail-2');
    rail.setAttribute('aria-busy', 'false');
    $('spinner').textContent = 'Loaded';
  },
};

window.addEventListener('keydown', (e) => {
  const action = keyActions[e.key];
  if (!action) return;
  e.preventDefault();
  action();
});

// SELECT activates the focused card (Enter keydown) and buttons (native click on Enter).
track.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !cards.includes(e.target)) return;
  const selected = e.target.getAttribute('aria-selected') === 'true';
  e.target.setAttribute('aria-selected', String(!selected));
  setAction(`selected ${e.target.dataset.testid}`);
});
$('play-button').addEventListener('click', () => setAction('play clicked'));

cards[0].focus();
console.info('fixture ready');
