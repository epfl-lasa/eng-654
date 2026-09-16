import { contours } from '../../vendor/d3-contour/d3-contour.js';

const PI = Math.PI;
const LIMIT = 14; // Common physical scale: both cases lie in [−14, +14] m³.
const GRID = 240;
const SVG_NS = 'http://www.w3.org/2000/svg';
let mapId = 0;

// c₂c₃ − (2c₂ + a₁)s₃ = 0. Parameterizing the roots explicitly
// preserves the crossing lines at a₁ = 0, where marching squares is ambiguous.
export function course3RZeroCurves(a1, samples = 1024) {
  if (a1 === 0) {
    const q3 = Math.atan(.5);
    return [
      [[-PI / 2, -PI], [-PI / 2, PI]],
      [[PI / 2, -PI], [PI / 2, PI]],
      [[-PI, q3], [PI, q3]],
      [[-PI, q3 - PI], [PI, q3 - PI]]
    ];
  }
  const lines = [];
  for (let branch = -1; branch <= 1; branch++) {
    let line = [];
    for (let i = 0; i <= samples; i++) {
      const q2 = -PI + 2 * PI * i / samples;
      const c2 = Math.cos(q2);
      const q3 = Math.atan2(c2, 2 * c2 + a1) + branch * PI;
      if (q3 >= -PI - 1e-12 && q3 <= PI + 1e-12) {
        line.push([q2, Math.max(-PI, Math.min(PI, q3))]);
      } else if (line.length) {
        if (line.length > 1) lines.push(line);
        line = [];
      }
    }
    if (line.length > 1) lines.push(line);
  }
  return lines;
}

function element(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  if (text != null) node.textContent = text;
  return node;
}

function color(value) {
  const neutral = [248, 248, 246];
  const end = value < 0 ? [36, 94, 150] : [184, 65, 44];
  const t = Math.min(1, Math.abs(value) / LIMIT);
  return `rgb(${neutral.map((v, i) => Math.round(v + (end[i] - v) * t)).join(',')})`;
}

const clampAngle = (q) => Math.max(-PI, Math.min(PI, q));
const signedValue = (v, digits = 4) => `${v < -1e-10 ? '−' : '+'}${Math.abs(v).toFixed(digits)}`;

export function createDeterminantMap(host, determinantAt) {
  const id = `sing-map-${++mapId}`;
  host.classList.add('sing-lab', 'sing-map-lab');
  host.innerHTML = `<div class="sing-stage sing-map-stage"></div>
    <aside class="sing-panel sing-map-panel">
      <h3>Read the singularity set</h3>
      <div class="sing-map-cases" role="group" aria-label="D–H geometry">
        <button type="button" data-a1="1" aria-pressed="true">a₁ = 1 m<span>offset axes</span></button>
        <button type="button" data-a1="0" aria-pressed="false">a₁ = 0 m<span>intersecting axes</span></button>
      </div>
      <div class="sing-map-controls">
        <label><span>q₂</span><input type="range" data-angle="q2" min="${-PI}" max="${PI}" step="0.001" aria-label="Joint angle q2 in radians"><output></output></label>
        <label><span>q₃</span><input type="range" data-angle="q3" min="${-PI}" max="${PI}" step="0.001" aria-label="Joint angle q3 in radians"><output></output></label>
      </div>
      <div class="sing-metric"><span>det ⁰Jₜ,ᵥ <small>[m³]</small></span><strong data-det></strong></div>
      <p class="sing-map-coordinate" data-coordinate></p>
      <div class="sing-map-legend"><span class="sing-map-zero-key"></span><strong>det ⁰Jₜ,ᵥ = 0</strong><span>Exact singularity curve</span></div>
      <div class="sing-map-equation"><strong>Zero-set equation</strong><span data-zero-equation></span></div>
      <button type="button" data-snap>Place the point on det ⁰Jₜ,ᵥ = 0</button>
      <p class="sing-status" role="status" aria-live="polite"></p>
      <p class="sing-map-help">Click or drag in the plot. Arrow keys move the focused point; Shift gives finer steps. Both cases use the same color scale. Angles are in radians.</p>
    </aside>`;

  const stage = host.querySelector('.sing-map-stage');
  const svg = element('svg', { role: 'img', 'aria-labelledby': `${id}-title ${id}-description` });
  stage.append(svg);
  const state = { q2: -25 * PI / 180, q3: 80 * PI / 180, a1: 1 };
  const cache = new Map();
  let geometry, cursor, crosshair, pointTitle, hitArea;
  let width = 0, height = 0;

  function dataForCase() {
    if (cache.has(state.a1)) return cache.get(state.a1);
    const values = new Float64Array(GRID * GRID);
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        values[row * GRID + col] = determinantAt(
          -PI + (col + .5) * 2 * PI / GRID,
          PI - (row + .5) * 2 * PI / GRID,
          state.a1
        );
      }
    }
    const thresholds = Array.from({ length: 41 }, (_, i) => -LIMIT + i * .7);
    const data = contours().size([GRID, GRID]).thresholds(thresholds)(values);
    cache.set(state.a1, data);
    return data;
  }

  function renderPlot() {
    width = stage.clientWidth;
    height = stage.clientHeight;
    if (width < 10 || height < 10) return;
    // Equal angular scales preserve the geometry in joint space.
    const side = Math.max(80, Math.min(width - 180, height - 115));
    geometry = { left: Math.max(57, (width - side - 45) / 2), top: Math.max(35, (height - side - 36) / 2), side };
    const { left, top } = geometry;
    const right = left + side, bottom = top + side;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.replaceChildren();
    svg.append(element('title', { id: `${id}-title` }, `3R determinant map: a₁ = ${state.a1} m`));
    svg.append(element('desc', { id: `${id}-description` }, 'q2 and q3 range from minus pi to pi radians. Blue means a negative determinant, orange a positive determinant. Black curves give det Jp exactly zero. Use the joint-angle sliders or arrow keys on the plot to inspect values.'));

    const defs = element('defs');
    const clip = element('clipPath', { id: `${id}-clip` });
    clip.append(element('rect', { x: left, y: top, width: side, height: side }));
    const gradient = element('linearGradient', { id: `${id}-gradient`, x1: 0, x2: 0, y1: 1, y2: 0 });
    [-LIMIT, 0, LIMIT].forEach(v => gradient.append(element('stop', { offset: (v + LIMIT) / (2 * LIMIT), 'stop-color': color(v) })));
    defs.append(clip, gradient);
    svg.append(defs);
    svg.append(element('text', { x: left, y: top - 17, class: 'sing-map-caption' }, 'Joint-space slice · q₁ arbitrary'));

    const plot = element('g', { 'clip-path': `url(#${id}-clip)` });
    plot.append(element('rect', { x: left, y: top, width: side, height: side, fill: color(-LIMIT) }));
    dataForCase().forEach(contour => {
      const path = contour.coordinates.map(polygon => polygon.map(ring =>
        ring.map(([x, y], i) => `${i ? 'L' : 'M'}${(left + x / GRID * side).toFixed(2)},${(top + y / GRID * side).toFixed(2)}`).join('') + 'Z'
      ).join('')).join('');
      plot.append(element('path', { d: path, fill: color(contour.value + .35), 'fill-rule': 'evenodd' }));
    });

    const ticks = [-PI, -PI / 2, 0, PI / 2, PI];
    const labels = ['−π', '−π/2', '0', 'π/2', 'π'];
    ticks.forEach((q, i) => {
      const x = toX(q), y = toY(q);
      if (i > 0 && i < ticks.length - 1) {
        plot.append(element('line', { x1: x, x2: x, y1: top, y2: bottom, class: 'sing-map-grid' }));
        plot.append(element('line', { x1: left, x2: right, y1: y, y2: y, class: 'sing-map-grid' }));
      }
      svg.append(element('line', { x1: x, x2: x, y1: bottom, y2: bottom + 5, class: 'sing-map-axis' }));
      svg.append(element('text', { x, y: bottom + 23, 'text-anchor': 'middle', class: 'sing-map-tick' }, labels[i]));
      svg.append(element('line', { x1: left - 5, x2: left, y1: y, y2: y, class: 'sing-map-axis' }));
      svg.append(element('text', { x: left - 12, y: y + 4, 'text-anchor': 'end', class: 'sing-map-tick' }, labels[i]));
    });

    course3RZeroCurves(state.a1).forEach(line => {
      const d = line.map(([q2, q3], i) => `${i ? 'L' : 'M'}${toX(q2).toFixed(3)},${toY(q3).toFixed(3)}`).join('');
      plot.append(element('path', { d, class: 'sing-map-zero-halo' }));
      plot.append(element('path', { d, class: 'sing-map-zero', 'data-zero-curve': '' }));
    });
    crosshair = element('path', { class: 'sing-map-crosshair' });
    cursor = element('g', { class: 'sing-map-cursor' });
    pointTitle = element('title');
    cursor.append(pointTitle, element('circle', { r: 8 }), element('circle', { r: 2.5, class: 'sing-map-cursor-dot' }));
    plot.append(crosshair, cursor);
    svg.append(plot);
    svg.append(element('rect', { x: left, y: top, width: side, height: side, fill: 'none', class: 'sing-map-axis' }));
    svg.append(element('text', { x: left + side / 2, y: bottom + 48, 'text-anchor': 'middle', class: 'sing-map-axis-label' }, 'q₂ [rad]'));
    svg.append(element('text', { transform: `translate(${left - 52},${top + side / 2}) rotate(-90)`, 'text-anchor': 'middle', class: 'sing-map-axis-label' }, 'q₃ [rad]'));

    const barX = right + 28, barY = top + 24, barHeight = side - 48;
    svg.append(element('text', { x: barX - 2, y: top + 3, class: 'sing-map-color-label' }, 'det ⁰Jₜ,ᵥ [m³]'));
    svg.append(element('rect', { x: barX, y: barY, width: 16, height: barHeight, fill: `url(#${id}-gradient)`, stroke: '#bdc3cb', 'stroke-width': .7 }));
    [-14, -7, 0, 7, 14].forEach(value => {
      const y = barY + (LIMIT - value) / (2 * LIMIT) * barHeight;
      svg.append(element('line', { x1: barX + 16, x2: barX + 21, y1: y, y2: y, class: 'sing-map-axis' }));
      svg.append(element('text', { x: barX + 25, y: y + 4, class: 'sing-map-tick' }, value > 0 ? `+${value}` : String(value).replace('-', '−')));
    });

    hitArea = element('rect', { x: left, y: top, width: side, height: side, fill: 'transparent', tabindex: 0, role: 'group', 'aria-label': 'Selected configuration. Use arrow keys to change q2 and q3; hold Shift for fine steps.', class: 'sing-map-hit' });
    svg.append(hitArea);
    let dragging = false;
    hitArea.addEventListener('pointerdown', event => {
      dragging = true;
      hitArea.focus({ preventScroll: true });
      hitArea.setPointerCapture(event.pointerId);
      selectPoint(event);
    });
    hitArea.addEventListener('pointermove', event => { if (dragging) selectPoint(event); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(name => hitArea.addEventListener(name, () => { dragging = false; }));
    hitArea.addEventListener('keydown', event => {
      const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
      if (!steps[event.key]) return;
      event.preventDefault();
      event.stopPropagation();
      const [dx, dy] = steps[event.key], step = event.shiftKey ? .005 : .05;
      state.q2 = clampAngle(state.q2 + dx * step);
      state.q3 = clampAngle(state.q3 + dy * step);
      updatePoint();
    });
    updatePoint();
  }

  function toX(q) { return geometry.left + (q + PI) / (2 * PI) * geometry.side; }
  function toY(q) { return geometry.top + (PI - q) / (2 * PI) * geometry.side; }
  function selectPoint(event) {
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
    state.q2 = clampAngle((point.x - geometry.left) / geometry.side * 2 * PI - PI);
    state.q3 = clampAngle(PI - (point.y - geometry.top) / geometry.side * 2 * PI);
    updatePoint();
  }

  function updatePoint() {
    if (!geometry) return;
    const x = toX(state.q2), y = toY(state.q3), value = determinantAt(state.q2, state.q3, state.a1);
    const onCurve = Math.abs(value) < 1e-9;
    cursor.setAttribute('transform', `translate(${x},${y})`);
    crosshair.setAttribute('d', `M${geometry.left},${y}H${geometry.left + geometry.side}M${x},${geometry.top}V${geometry.top + geometry.side}`);
    const description = `q₂ = ${state.q2.toFixed(3)} rad; q₃ = ${state.q3.toFixed(3)} rad; det ⁰Jₜ,ᵥ = ${onCurve ? '0' : signedValue(value)} m³`;
    pointTitle.textContent = description;
    hitArea.setAttribute('aria-label', `${description}. Use arrow keys to move; Shift gives finer steps.`);
    host.querySelector('[data-det]').textContent = onCurve ? '0.0000' : signedValue(value);
    host.querySelector('.sing-metric').classList.toggle('near', onCurve);
    host.querySelector('[data-coordinate]').textContent = `q₂ = ${state.q2.toFixed(3)} rad · q₃ = ${state.q3.toFixed(3)} rad`;
    host.querySelector('[data-zero-equation]').textContent = state.a1 ? 'c₂(c₃ − 2s₃) − s₃ = 0' : 'c₂(c₃ − 2s₃) = 0';
    host.querySelector('.sing-status').textContent = onCurve
      ? 'On the singularity curve: rank ⁰Jₜ,ᵥ < 3. At least one Cartesian velocity direction is lost.'
      : `${value < 0 ? 'Negative' : 'Positive'} determinant: rank ⁰Jₜ,ᵥ = 3 here. Reach a black curve to see rank loss.`;
    host.querySelectorAll('[data-angle]').forEach(input => {
      input.value = state[input.dataset.angle];
      input.nextElementSibling.value = `${state[input.dataset.angle].toFixed(2)} rad`;
      input.setAttribute('aria-valuetext', `${state[input.dataset.angle].toFixed(3)} radians`);
    });
    host.querySelectorAll('[data-a1]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.a1) === state.a1)));
  }

  host.querySelectorAll('[data-angle]').forEach(input => input.addEventListener('input', () => {
    state[input.dataset.angle] = Number(input.value);
    updatePoint();
  }));
  host.querySelectorAll('[data-a1]').forEach(button => button.addEventListener('click', () => {
    state.a1 = Number(button.dataset.a1);
    renderPlot();
  }));
  host.querySelector('[data-snap]').addEventListener('click', () => {
    const base = state.a1 ? Math.atan2(Math.cos(state.q2), 2 * Math.cos(state.q2) + state.a1) : Math.atan(.5);
    const roots = [-1, 0, 1].map(k => base + k * PI).filter(q => q >= -PI && q <= PI);
    state.q3 = roots.reduce((best, q) => Math.abs(q - state.q3) < Math.abs(best - state.q3) ? q : best);
    updatePoint();
  });
  const observer = new ResizeObserver(() => {
    if (stage.clientWidth !== width || stage.clientHeight !== height) renderPlot();
  });
  observer.observe(stage);
  renderPlot();
  return { dispose() { observer.disconnect(); } };
}
