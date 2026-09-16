import { minimumJerkState, minimumJerkCost } from './minimumJerk.js';

const NS = 'http://www.w3.org/2000/svg';
function node(tag, attributes, text) {
  const element = document.createElementNS(NS, tag);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  if (text !== undefined) element.textContent = text;
  return element;
}

function chart(svg, samples, key, title, unit, duration, time) {
  const width = Math.max(240, svg.clientWidth), height = Math.max(140, svg.clientHeight);
  const left = 54, right = width - 16, top = 31, bottom = height - 33;
  const values = samples.map(sample => sample[key]);
  const min = Math.min(0, ...values), max = Math.max(...values), pad = Math.max(.001, (max - min) * .12);
  const low = min - pad, high = max + pad;
  const x = t => left + t / duration * (right - left), y = v => bottom - (v - low) / (high - low) * (bottom - top);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.replaceChildren();
  svg.append(node('text', {x:12, y:17, class:'l7-svg-label'}, `${title} [${unit}]`));
  for (let k = 0; k <= 4; k++) {
    const t = k * duration / 4, value = min + k * (max - min) / 4;
    svg.append(node('line', {x1:x(t), x2:x(t), y1:top, y2:bottom, stroke:'#e0e4e7'}));
    svg.append(node('text', {x:x(t), y:bottom+16, 'text-anchor':'middle', class:'l7-svg-tick'}, +t.toFixed(2)));
    svg.append(node('line', {x1:left, x2:right, y1:y(value), y2:y(value), stroke:'#e0e4e7'}));
    svg.append(node('text', {x:left-7, y:y(value)+3, 'text-anchor':'end', class:'l7-svg-tick'}, +value.toPrecision(3)));
  }
  svg.append(node('rect', {x:left, y:top, width:right-left, height:bottom-top, fill:'none', stroke:'#7b858c'}));
  svg.append(node('path', {d:samples.map((v,i)=>`${i?'L':'M'}${x(v.time)},${y(v[key])}`).join(''), fill:'none', stroke:'#bf2028', 'stroke-width':2.3}));
  svg.append(node('line', {x1:x(time), x2:x(time), y1:top, y2:bottom, stroke:'#25353f', 'stroke-dasharray':'4 3'}));
  svg.append(node('text', {x:(left+right)/2, y:height-3, 'text-anchor':'middle', class:'l7-svg-label'}, 'Time t [s]'));
}

export function initMinimumJerkLecture() {
  document.querySelectorAll('[data-jerk-lab]').forEach(createLab);
}

function createLab(host) {
  host.classList.add('l7-jerk-lab');
  host.innerHTML = `<div class="l7-controls l7-jerk-controls"><label>Duration T <input data-duration type="range" min="1" max="8" step=".25" value="3"><output data-duration-value></output></label><label>Distance L <input data-distance type="range" min=".2" max="2" step=".1" value="1"><output data-distance-value></output></label><button data-play class="primary">Play</button><button data-reset>Reset</button></div><div class="l7-jerk-path"><svg data-path role="img" aria-label="Tool moving along a prescribed straight segment"></svg></div><div class="l7-jerk-plots">${['position','velocity','acceleration','jerk'].map(key=>`<div class="l7-plot"><svg data-curve="${key}" role="img" aria-label="${key} over time"></svg></div>`).join('')}</div><div class="l7-controls l7-jerk-footer"><input data-time type="range" min="0" max="1000" value="0" aria-label="Trajectory time"><output data-readout></output></div>`;
  let duration = 3, distance = 1, time = 0, playing = false, epoch = 0, raf = 0;
  const path = host.querySelector('[data-path]');
  function draw() {
    const state = minimumJerkState(time, duration);
    const samples = Array.from({length:181}, (_, i) => {
      const t = duration * i / 180, sample = minimumJerkState(t, duration);
      return {time:t, position:distance*sample.s, velocity:distance*sample.velocity, acceleration:distance*sample.acceleration, jerk:distance*sample.jerk};
    });
    const labels = {position:['Position','m'],velocity:['Velocity','m/s'],acceleration:['Acceleration','m/s²'],jerk:['Jerk','m/s³']};
    host.querySelectorAll('[data-curve]').forEach(svg => chart(svg, samples, svg.dataset.curve, ...labels[svg.dataset.curve], duration, time));
    const w = Math.max(260, path.clientWidth), h = Math.max(66, path.clientHeight), left = 70, right = w-70, y = h*.48;
    path.setAttribute('viewBox', `0 0 ${w} ${h}`); path.replaceChildren();
    path.append(node('line', {x1:left,x2:right,y1:y,y2:y,stroke:'#8c989f','stroke-width':3}));
    path.append(node('line', {x1:left,x2:left+state.s*(right-left),y1:y,y2:y,stroke:'#bf2028','stroke-width':3}));
    path.append(node('circle', {cx:left+state.s*(right-left),cy:y,r:8,fill:'#202d36',stroke:'white','stroke-width':2}));
    path.append(node('text',{x:left,y:h-7,'text-anchor':'middle',class:'l7-svg-label'},'Start · 0 m'));
    path.append(node('text',{x:right,y:h-7,'text-anchor':'middle',class:'l7-svg-label'},`End · ${distance.toFixed(1)} m`));
    host.querySelector('[data-duration-value]').textContent = `${duration.toFixed(2)} s`;
    host.querySelector('[data-distance-value]').textContent = `${distance.toFixed(1)} m`;
    host.querySelector('[data-time]').value = time / duration * 1000;
    host.querySelector('[data-play]').textContent = playing ? 'Pause' : time >= duration ? 'Replay' : 'Play';
    host.querySelector('[data-readout]').textContent = `t = ${time.toFixed(2)} s · x = ${(distance*state.s).toFixed(3)} m · ∫jerk² dt = ${minimumJerkCost(distance,duration).toPrecision(4)} m²/s⁵`;
    host.dataset.time = time; host.dataset.duration = duration; host.dataset.progress = state.s; host.dataset.playing = playing;
  }
  function stop() { playing = false; cancelAnimationFrame(raf); raf = 0; }
  function tick(now) {
    if (!playing) return;
    time = Math.max(0, Math.min(duration, (now-epoch)/1000));
    if (time >= duration) stop();
    draw(); if (playing) raf = requestAnimationFrame(tick);
  }
  host.querySelector('[data-play]').addEventListener('click', () => {
    if (playing) { stop(); draw(); return; }
    if (time >= duration) time = 0;
    playing = true; epoch = performance.now()-time*1000; draw(); raf = requestAnimationFrame(tick);
  });
  host.querySelector('[data-reset]').addEventListener('click', () => {stop();time=0;draw();});
  host.querySelector('[data-time]').addEventListener('input', e => {stop();time=duration*Number(e.target.value)/1000;draw();});
  for (const key of ['duration','distance']) host.querySelector(`[data-${key}]`).addEventListener('input', e => {
    stop();time=0;if(key==='duration')duration=Number(e.target.value);else distance=Number(e.target.value);draw();
  });
  window.addEventListener('hashchange',()=>{if(!host.closest('.slide')?.classList.contains('active')){stop();draw();}});
  new ResizeObserver(draw).observe(host); draw();
}
