import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

export function addLabel(landmark, text) {
  const el = document.createElement('div');
  el.className = 'label';
  el.textContent = text;
  const label = new CSS2DObject(el);
  label.position.set(0, landmark.labelHeight, 0);
  landmark.object.add(label);
  return label;
}

export function bindTimeSlider(onChange) {
  const input = document.getElementById('time');
  const label = document.getElementById('time-label');
  const apply = () => {
    const state = onChange(parseFloat(input.value));
    label.textContent = state.label;
    document.body.classList.toggle('night', state.night > 0.5);
  };
  input.addEventListener('input', apply);
  apply();
}

export function hideLoader() {
  document.getElementById('loader').classList.add('done');
}
