import { contours } from '../../vendor/d3-contour/d3-contour.js';
import { course3RZeroCurves } from './determinantMap.js';

const PI = Math.PI;
const NS = 'http://www.w3.org/2000/svg';
const INK = '#20252b';
const IK_COLORS = ['#b33227', '#245e96', '#4a7d35', '#8b4b91', '#a67408', '#00878b'];
let nextId = 0;

function svgNode(tag, attributes = {}, text) {
  const node = document.createElementNS(NS, tag);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
  if (text != null) node.textContent = text;
  return node;
}

// Each returned segment belongs to one grid cell. Keeping those segments
// separate avoids artificial lines across the periodic ±π seam or at cusps.
// Bisection refines every endpoint against the actual determinant, rather than
// treating linearly interpolated contour vertices as exact singularities.
export function refinedZeroSegments(valueAt, samples = 192) {
  const step = 2 * PI / samples;
  const values = Array.from({ length: samples + 1 }, (_, i) =>
    Array.from({ length: samples + 1 }, (_, j) => valueAt(-PI + i * step, -PI + j * step)));
  const segments = [];
  const refine = (a, b, fa, fb) => {
    if (Math.abs(fa) < 1e-13) return a;
    if (Math.abs(fb) < 1e-13) return b;
    let lo = a, hi = b;
    for (let k = 0; k < 32; k++) {
      const mid = lo.map((x, axis) => (x + hi[axis]) / 2);
      const fm = valueAt(...mid);
      if ((fm > 0) === (fa > 0)) { lo = mid; fa = fm; } else hi = mid;
    }
    return lo.map((x, axis) => (x + hi[axis]) / 2);
  };
  for (let i = 0; i < samples; i++) for (let j = 0; j < samples; j++) {
    const points = [[i,j],[i+1,j],[i+1,j+1],[i,j+1]].map(([x,y]) => [-PI + x * step, -PI + y * step]);
    const v = [values[i][j], values[i+1][j], values[i+1][j+1], values[i][j+1]];
    const hits = [];
    for (let edge = 0; edge < 4; edge++) {
      const other = (edge + 1) % 4;
      if ((v[edge] > 0) !== (v[other] > 0)) hits.push(refine(points[edge], points[other], v[edge], v[other]));
    }
    if (hits.length === 2) segments.push(hits);
    else if (hits.length === 4) {
      const center = valueAt(-PI + (i + .5) * step, -PI + (j + .5) * step);
      if ((v[0] > 0) === (center > 0)) segments.push([hits[0],hits[3]], [hits[1],hits[2]]);
      else segments.push([hits[0],hits[1]], [hits[2],hits[3]]);
    }
  }
  return segments;
}

function color(value, limit) {
  const neutral = [248, 248, 246], end = value < 0 ? [36, 94, 150] : [184, 65, 44];
  const t = Math.min(1, Math.abs(value) / limit);
  return `rgb(${neutral.map((x, i) => Math.round(x + (end[i] - x) * t)).join(',')})`;
}

function linePath(lines, map) {
  return lines.map(line => line.map((point, i) => {
    const [x, y] = map(...point);
    return `${i ? 'L' : 'M'}${x.toFixed(3)},${y.toFixed(3)}`;
  }).join('')).join('');
}

function ticks(min, max, count = 5) {
  const rough = (max - min) / count, magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].find(x => x * magnitude >= rough) * magnitude;
  const result = [];
  for (let x = Math.ceil(min / step) * step; x <= max + step * 1e-8; x += step) result.push(Number(x.toPrecision(10)));
  return result;
}

function idealizedGeometry(p) {
  return Math.abs(p.a2 - 2) < 1e-10 && Math.abs(p.a3 - 1.5) < 1e-10
    && Math.abs(p.d2 - 1) < 1e-10 && Math.abs(p.d3) < 1e-10
    && Math.abs(p.A1 - PI / 2) < 1e-10 && Math.abs(p.A2 - PI / 2) < 1e-10;
}

export function createCuspidalityAtlas(host, helpers) {
  const { PRESETS, det3, sliceFk, solveIkSlice, factorText } = helpers;
  const id = `cusp-atlas-${++nextId}`;
  host.classList.add('cusp-lab', 'cusp-atlas', 'cusp-svg-atlas');
  host.innerHTML = `<div class="cusp-plot-row">
    <div class="cusp-plot"><h3>Joint space <span>det Jₚ [m³]</span></h3><svg data-joint role="img" aria-label="Joint-space determinant with exact singularity curves and inverse-kinematic solutions"></svg></div>
    <div class="cusp-plot"><h3>Workspace section <span>ρ ≥ 0 · rotate about z to recover the workspace</span></h3><svg data-work role="img" aria-label="Critical values in the radial-height workspace section. Click to solve inverse kinematics."></svg></div>
  </div><div class="cusp-atlas-legend"><span><i class="cusp-atlas-curve"></i>singular configurations → critical values</span><span><i class="cusp-atlas-target"></i>selected target</span><span data-coordinate></span><span data-count></span></div>
  <div class="cusp-controls"><div><div class="cusp-presets"><button data-preset="noncuspidal">a₁ = 0 m<span>intersecting axes</span></button><button data-preset="cuspidal">a₁ = 1 m<span>offset axes</span></button></div><div class="cusp-iks" data-iks></div></div>
    <div class="cusp-control-grid" data-params></div><div class="cusp-atlas-summary"><div class="cusp-formula" data-formula></div><div class="cusp-status" data-status role="status"></div></div></div>`;
  const jointSvg = host.querySelector('[data-joint]'), workSvg = host.querySelector('[data-work]');
  const paramsHost = host.querySelector('[data-params]');
  const state = { p: { ...PRESETS.cuspidal }, solutions: [], selected: -1, target: null, cache: null, map: null };
  const controlDefinitions = [['a₁','a1',0,2,.1],['a₂','a2',.4,3,.1],['a₃','a3',.4,3,.1],['d₂','d2',0,2,.1],['d₃','d3',0,1.5,.1],['α₁','A1',-180,180,5],['α₂','A2',-180,180,5],['α₃','A3',-180,180,5]];
  controlDefinitions.forEach(([label,key,min,max,step]) => {
    const row = document.createElement('label');
    row.innerHTML = `<span>${label} <small>[${key[0] === 'A' ? '°' : 'm'}]</small></span><input type="number" min="${min}" max="${max}" step="${step}" data-key="${key}" aria-label="${label} in ${key[0] === 'A' ? 'degrees' : 'metres'}">`;
    row.querySelector('input').addEventListener('change', event => {
      const input = event.target;
      if (!input.validity.valid || !Number.isFinite(input.valueAsNumber)) { syncInputs(); return; }
      state.p[key] = input.valueAsNumber * (key[0] === 'A' ? PI / 180 : 1);
      host.querySelectorAll('[data-preset]').forEach(button => button.classList.remove('active'));
      rebuild();
    });
    paramsHost.append(row);
  });
  function syncInputs() {
    paramsHost.querySelectorAll('input').forEach(input => {
      input.value = (state.p[input.dataset.key] * (input.dataset.key[0] === 'A' ? 180 / PI : 1)).toFixed(input.dataset.key[0] === 'A' ? 0 : 2);
    });
  }
  host.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => {
    state.p = { ...PRESETS[button.dataset.preset] };
    host.querySelectorAll('[data-preset]').forEach(other => {
      other.classList.toggle('active', other === button);
      other.setAttribute('aria-pressed', String(other === button));
    });
    syncInputs(); rebuild();
  }));

  function rebuild() {
    const grid = 192, field = [], valueAt = (q2,q3) => det3([0,q2,q3],state.p);
    let maxR = 0, minZ = Infinity, maxZ = -Infinity, maxDet = 0;
    for (let j = 0; j < grid; j++) for (let i = 0; i < grid; i++) {
      const q2 = -PI + (i + .5) * 2 * PI / grid, q3 = PI - (j + .5) * 2 * PI / grid;
      const value = valueAt(q2,q3), w = sliceFk([q2,q3],state.p);
      field.push(value); maxDet = Math.max(maxDet,Math.abs(value));
      maxR = Math.max(maxR,w[0]); minZ = Math.min(minZ,w[1]); maxZ = Math.max(maxZ,w[1]);
    }
    const limit = Math.max(1, Math.ceil(maxDet / 2) * 2);
    const thresholds = Array.from({ length: 33 }, (_, i) => -limit + i * 2 * limit / 32);
    const filledContours = contours().size([grid,grid]).smooth(true).thresholds(thresholds)(field);
    let jointLines = idealizedGeometry(state.p) ? course3RZeroCurves(state.p.a1, 1536) : refinedZeroSegments(valueAt);
    // The zero-offset preset has straight complete branches. Densify before
    // applying nonlinear FK; otherwise its curved workspace image is a chord.
    jointLines = jointLines.map(line => line.length === 2 && Math.hypot(line[1][0] - line[0][0],line[1][1] - line[0][1]) > .1
      ? Array.from({ length: 1537 }, (_, i) => line[0].map((x,k) => x + (line[1][k] - x) * i / 1536)) : line);
    state.cache = { grid, limit, filledContours, jointLines, criticalLines: jointLines.map(line => line.map(q => sliceFk(q,state.p))),
      rhoRange: [0, Math.max(1,maxR) * 1.06], zRange: [minZ - Math.max(.2,(maxZ-minZ)*.06), maxZ + Math.max(.2,(maxZ-minZ)*.06)] };
    host.querySelector('[data-formula]').textContent = factorText(state.p);
    selectTarget(sliceFk([-10 * PI / 180,-170 * PI / 180],state.p));
  }

  function selectTarget(point) {
    state.target = point;
    state.solutions = solveIkSlice(point,state.p);
    state.selected = -1;
    updateSolutions(); draw();
  }

  function updateSolutions() {
    const pills = host.querySelector('[data-iks]');
    pills.innerHTML = state.solutions.map((q,i) => `<button data-ik="${i}" style="--ik-color:${IK_COLORS[i % IK_COLORS.length]}" aria-pressed="${i === state.selected}" title="q₂=${q[0].toFixed(3)} rad, q₃=${q[1].toFixed(3)} rad">IK ${i+1}</button>`).join('');
    pills.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
      state.selected = state.selected === Number(button.dataset.ik) ? -1 : Number(button.dataset.ik);
      updateSolutions(); draw();
    }));
    host.querySelector('[data-count]').textContent = `${state.solutions.length} regular IK solution${state.solutions.length === 1 ? '' : 's'}`;
    host.querySelector('[data-coordinate]').textContent = `ρ = ${state.target[0].toFixed(3)} m · z = ${state.target[1].toFixed(3)} m`;
    const selected = state.solutions[state.selected];
    host.querySelector('[data-status]').textContent = selected
      ? `IK ${state.selected + 1}: q₂ = ${selected[0].toFixed(3)} rad, q₃ = ${selected[1].toFixed(3)} rad. det Jₚ = ${det3([0,...selected],state.p).toFixed(3)} m³.`
      : 'Click the workspace to solve IK. Numbered markers identify the solutions; click an IK to inspect it.';
  }

  function plotBase(svg, xr, yr, joint) {
    const width = Math.max(1,svg.clientWidth), height = Math.max(1,svg.clientHeight);
    svg.replaceChildren(); svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
    const margins = { left: 60, right: joint ? 82 : 28, top: 43, bottom: 48 };
    const scale = Math.min((width-margins.left-margins.right)/(xr[1]-xr[0]),(height-margins.top-margins.bottom)/(yr[1]-yr[0]));
    const w = Math.max(1,(xr[1]-xr[0])*scale), h = Math.max(1,(yr[1]-yr[0])*scale);
    const left = margins.left + (width-margins.left-margins.right-w)/2, top = margins.top + (height-margins.top-margins.bottom-h)/2;
    const map = (x,y) => [left+(x-xr[0])/(xr[1]-xr[0])*w,top+(yr[1]-y)/(yr[1]-yr[0])*h];
    const clipId = `${id}-${joint ? 'joint' : 'work'}-clip`;
    const defs = svgNode('defs'), clip = svgNode('clipPath',{ id:clipId });
    clip.append(svgNode('rect',{ x:left,y:top,width:w,height:h })); defs.append(clip); svg.append(defs);
    const plot = svgNode('g',{ 'clip-path':`url(#${clipId})` });
    plot.append(svgNode('rect',{ x:left,y:top,width:w,height:h,fill:joint ? color(-state.cache.limit,state.cache.limit) : '#fafbfc' }));
    svg.append(plot);
    return { width,height,left,top,w,h,map,plot,defs,xr,yr,svg };
  }

  function drawAxes(g,joint) {
    const {svg,plot,left,top,w,h,map,xr,yr} = g;
    const angles = [-PI,-PI/2,0,PI/2,PI], angleLabels = ['−π','−π/2','0','π/2','π'];
    const xt = joint ? angles : ticks(...xr,5), yt = joint ? angles : ticks(...yr,6);
    xt.forEach((value,i) => {
      const [x] = map(value,yr[0]);
      plot.append(svgNode('line',{ x1:x,x2:x,y1:top,y2:top+h,class:'cusp-atlas-grid' }));
      svg.append(svgNode('line',{ x1:x,x2:x,y1:top+h,y2:top+h+4,class:'cusp-atlas-axis' }));
      svg.append(svgNode('text',{ x,y:top+h+20,'text-anchor':'middle',class:'cusp-atlas-tick' },joint ? angleLabels[i] : String(value).replace('-','−')));
    });
    yt.forEach((value,i) => {
      const [,y] = map(xr[0],value);
      plot.append(svgNode('line',{ x1:left,x2:left+w,y1:y,y2:y,class:'cusp-atlas-grid' }));
      svg.append(svgNode('line',{ x1:left-4,x2:left,y1:y,y2:y,class:'cusp-atlas-axis' }));
      svg.append(svgNode('text',{ x:left-9,y:y+4,'text-anchor':'end',class:'cusp-atlas-tick' },joint ? angleLabels[i] : String(value).replace('-','−')));
    });
    svg.append(svgNode('rect',{ x:left,y:top,width:w,height:h,fill:'none',class:'cusp-atlas-axis' }));
    svg.append(svgNode('text',{ x:left+w/2,y:top+h+42,'text-anchor':'middle',class:'cusp-atlas-axis-label' },joint ? 'q₂ [rad]' : 'ρ [m]'));
    svg.append(svgNode('text',{ transform:`translate(${left-45},${top+h/2}) rotate(-90)`,'text-anchor':'middle',class:'cusp-atlas-axis-label' },joint ? 'q₃ [rad]' : 'z [m]'));
  }

  function draw() {
    if (!state.cache || jointSvg.clientWidth < 2 || jointSvg.clientHeight < 110) return;
    const {cache} = state;
    const j = plotBase(jointSvg,[-PI,PI],[-PI,PI],true), w = plotBase(workSvg,cache.rhoRange,cache.zRange,false);
    state.map = { fromPx: (x,y) => [w.xr[0]+(x-w.left)/w.w*(w.xr[1]-w.xr[0]),w.yr[1]-(y-w.top)/w.h*(w.yr[1]-w.yr[0])] };
    cache.filledContours.forEach(contour => {
      const d = contour.coordinates.map(polygon => polygon.map(ring => ring.map(([x,y],i) => `${i ? 'L' : 'M'}${(j.left+x/cache.grid*j.w).toFixed(2)},${(j.top+y/cache.grid*j.h).toFixed(2)}`).join('')+'Z').join('')).join('');
      j.plot.append(svgNode('path',{ d,fill:color(contour.value+cache.limit/32,cache.limit),'fill-rule':'evenodd' }));
    });
    drawAxes(j,true); drawAxes(w,false);
    [[j,cache.jointLines],[w,cache.criticalLines]].forEach(([geometry,lines]) => {
      const d = linePath(lines,geometry.map);
      geometry.plot.append(svgNode('path',{ d,class:'cusp-atlas-zero-halo' }));
      geometry.plot.append(svgNode('path',{ d,class:'cusp-atlas-zero','data-zero-curve':'' }));
    });
    const gradientId = `${id}-gradient`, gradient = svgNode('linearGradient',{ id:gradientId,x1:'0%',y1:'100%',x2:'0%',y2:'0%' });
    [-1,0,1].forEach(value => gradient.append(svgNode('stop',{ offset:`${(value+1)*50}%`,'stop-color':color(value*cache.limit,cache.limit) })));
    j.defs.append(gradient);
    const bx = j.left+j.w+24, bh = Math.max(40,j.h-16), by = j.top+8;
    jointSvg.append(svgNode('rect',{ x:bx,y:by,width:12,height:bh,fill:`url(#${gradientId})`,stroke:'#adb4bd','stroke-width':.7 }));
    [-1,0,1].forEach(value => jointSvg.append(svgNode('text',{ x:bx+18,y:by+(1-value)/2*bh+4,class:'cusp-atlas-tick' },`${value>0?'+':''}${value*cache.limit}`.replace('-','−'))));
    const [tx,ty] = w.map(...state.target);
    w.plot.append(svgNode('path',{ d:`M${w.left},${ty}H${w.left+w.w}M${tx},${w.top}V${w.top+w.h}`,class:'cusp-atlas-crosshair' }));
    const target = svgNode('g',{ transform:`translate(${tx},${ty})`,'data-target':'' });
    target.append(svgNode('circle',{ r:7,fill:'white',stroke:INK,'stroke-width':2 }),svgNode('circle',{ r:2.5,fill:INK })); w.plot.append(target);
    state.solutions.forEach((q,i) => {
      const [x,y] = j.map(...q), selected = i === state.selected;
      const group = svgNode('g',{ transform:`translate(${x},${y})`,'data-ik-point':i,class:'cusp-atlas-ik-point',tabindex:0,role:'button','aria-label':`IK ${i+1}: q2 ${q[0].toFixed(3)}, q3 ${q[1].toFixed(3)} radians` });
      if (selected) group.append(svgNode('circle',{ r:15,fill:'none',stroke:INK,'stroke-width':1.5 }));
      group.append(svgNode('circle',{ r:10,fill:IK_COLORS[i%IK_COLORS.length],stroke:'white','stroke-width':2 }),svgNode('text',{ y:3.7,'text-anchor':'middle',fill:'white','font-size':10,'font-weight':800 },i+1));
      const select = () => { state.selected = state.selected === i ? -1 : i; updateSolutions(); draw(); };
      group.addEventListener('click',select); group.addEventListener('keydown',event => { if(event.key==='Enter'||event.key===' ') { event.preventDefault(); event.stopPropagation(); select(); } });
      j.plot.append(group);
    });
    const hit = svgNode('rect',{ x:w.left,y:w.top,width:w.w,height:w.h,fill:'transparent',class:'cusp-atlas-hit',tabindex:0,role:'group','aria-label':'Workspace target. Click or use arrow keys to move the target; hold Shift for finer steps.' });
    hit.addEventListener('pointerdown',event => {
      hit.focus({preventScroll:true});
      const point = new DOMPoint(event.clientX,event.clientY).matrixTransform(workSvg.getScreenCTM().inverse());
      const target = state.map.fromPx(point.x,point.y);
      selectTarget([Math.max(0,target[0]),target[1]]);
    });
    hit.addEventListener('keydown',event => {
      const direction = {ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,1],ArrowDown:[0,-1]}[event.key];
      if (!direction) return;
      event.preventDefault(); event.stopPropagation();
      const step = (event.shiftKey ? .002 : .02) * (w.yr[1]-w.yr[0]);
      selectTarget(state.target.map((v,i) => Math.max(i ? w.yr[0] : 0,Math.min(i ? w.yr[1] : w.xr[1],v+direction[i]*step))));
      workSvg.querySelector('.cusp-atlas-hit').focus({preventScroll:true});
    });
    workSvg.append(hit);
  }

  const observer = new ResizeObserver(draw); observer.observe(jointSvg); observer.observe(workSvg);
  syncInputs();
  host.querySelector('[data-preset="cuspidal"]').classList.add('active');
  host.querySelector('[data-preset="cuspidal"]').setAttribute('aria-pressed','true');
  rebuild();
  return { state,rebuild,draw,dispose() { observer.disconnect(); } };
}
