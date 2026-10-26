import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// Clickable label floating above a landmark.
export function createLabel(text, onClick) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'label';
  el.textContent = text;
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  // Keep pointer presses on a label from starting an orbit drag.
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  return { el, object: new CSS2DObject(el) };
}

const card = document.getElementById('card');

// Shows the landmark card. `actions`: [{ label, pressed?, onClick(button) }].
export function showCard(landmark, { actions = [], onClose }) {
  card.innerHTML = '';
  const close = document.createElement('button');
  close.className = 'close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '×';
  close.addEventListener('click', onClose);

  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'Landmark';

  const title = document.createElement('h2');
  title.textContent = landmark.name;

  const stats = document.createElement('div');
  stats.className = 'stats';
  for (const [value, caption] of landmark.stats) {
    const tile = document.createElement('div');
    tile.className = 'stat';
    const strong = document.createElement('strong');
    strong.textContent = value;
    const span = document.createElement('span');
    span.textContent = caption;
    tile.append(strong, span);
    stats.append(tile);
  }

  const text = document.createElement('p');
  text.className = 'text';
  text.textContent = landmark.text;

  card.append(close, eyebrow, title, stats, text);

  if (actions.length) {
    const row = document.createElement('div');
    row.className = 'actions';
    for (const a of actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn${a.primary ? ' accent' : ''}`;
      b.textContent = a.label;
      if (a.pressed != null) b.setAttribute('aria-pressed', String(a.pressed));
      b.addEventListener('click', () => a.onClick(b));
      row.append(b);
    }
    card.append(row);
  }

  card.hidden = false;
  requestAnimationFrame(() => card.classList.add('open'));
}

export function hideCard() {
  card.classList.remove('open');
  setTimeout(() => {
    if (!card.classList.contains('open')) card.hidden = true;
  }, 350);
}

export function bindTimeSlider(onChange) {
  const input = document.getElementById('time');
  const label = document.getElementById('time-label');
  const tagline = document.getElementById('tagline');
  const apply = () => {
    const state = onChange(parseFloat(input.value));
    label.textContent = state.label;
    tagline.textContent = `Downtown & the waterfront ${state.phrase}`;
  };
  input.addEventListener('input', apply);
  apply();
}

export function setCoords(lat, lon) {
  document.getElementById('coords').textContent =
    `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'} · ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`;
}

export function setLoaderText(text) {
  document.getElementById('loader-text').textContent = text;
}

export function hideLoader() {
  document.getElementById('loader').classList.add('done');
}
