import * as THREE from 'three';
import { loadAbbIrbVisuals } from './abbIrbVisuals.js';
import {
  ABB_JOINT_LIMITS, abbDHKinematics, abbUrdfTransforms,
  abbJacobian, abbWorldJacobian, abbPreferredJacobian, abbFactors,
  abbDeterminant, abbPreset, determinant, numericRank
} from './abbIrbKinematics.js';

const DEG = Math.PI / 180;

/** Interactive counterpart of the ABB world-O5 -> D-H-frame-3 derivation. */
export async function setupAbbIrbLab(kit, helpers) {
  const { addRange, makeSelect, matrixText, signed, sphere, addTextLabel,
    clearGroup, addAxisLine, addArrow, COLORS } = helpers;
  const { panel, world } = kit;
  const state = { q: abbPreset(), i: 0, j: 5, k: 0, preset: 'regular' };
  kit.host.classList.add('sing-factor-lab', 'abb-irb-lab');
  panel.innerHTML = `<h3>ABB IRB 4600 · three singularity factors</h3>
    <div class="sing-case-buttons sing-factor-cases" role="group" aria-label="Isolated ABB singularity presets">
      <button type="button" data-case="regular">Regular</button>
      <button type="button" data-case="F">F = 0 · elbow</button>
      <button type="button" data-case="G">G = 0 · shoulder</button>
      <button type="button" data-case="wrist">sin q₅ = 0 · wrist</button>
    </div>
    <div class="sing-factor-values">
      <div class="sing-metric" data-factor="F"><span>F = a₃s₃ + d₄c₃ [m]</span><strong></strong></div>
      <div class="sing-metric" data-factor="G"><span>G(q₂,q₃) [m]</span><strong></strong></div>
      <div class="sing-metric" data-factor="wrist"><span>sin q₅ [1]</span><strong></strong></div>
    </div>
    <div class="sing-formula sing-factor" data-product aria-live="polite"></div>
    <p class="sing-status" aria-live="polite">Loading the seven ABB mesh links…</p>
    <div class="sing-controls" aria-label="ABB joint angles in degrees"></div>
    <div class="abb-frame-buttons" role="group" aria-label="Jacobian representation">
      <button type="button" data-basis="world">World frame at O5</button>
      <button type="button" data-basis="preferred">Use frame 3 at O5</button>
    </div>
    <div class="sing-formula l5-matrix" data-matrix></div>
    <details class="sing-factor-details" data-representation>
      <summary>Change the point and frame; inspect a column</summary>
      <div class="sing-selects"></div>
      <p data-point-note></p>
      <div class="sing-formula l5-matrix" data-world-matrix></div>
      <p>The same absolute terminal-body twist is re-expressed. A rigid point shift and a proper rotation preserve the full 6 × 6 determinant.</p>
    </details>
    <details class="sing-factor-details">
      <summary>ABB dimensions and the zero configuration</summary>
      <p>Metres: d₁ = 0.495, a₁ = 0.175, a₂ = 1.095, a₃ = 0.175, d₄ = 1.270, d₆ = 0.135. The model and sliders use the URDF joint angles; the D–H table uses θ₂ = q₂ − π/2.</p>
      <button type="button" data-home>All joint angles = 0°</button>
    </details>`;

  const controls = panel.querySelector('.sing-controls');
  const sliders = state.q.map((q, k) => addRange(controls, `q${k + 1}`,
    Number((ABB_JOINT_LIMITS[k][0] / DEG).toFixed(9)), Number((ABB_JOINT_LIMITS[k][1] / DEG).toFixed(9)), .01, q / DEG,
    (value) => { state.q[k] = value * DEG; state.preset = 'custom'; update(); }));
  const selects = panel.querySelector('.sing-selects');
  const frameOptions = Array.from({ length: 7 }, (_, i) => [String(i), i === 0 ? 'Frame 0 · world' : `D–H frame ${i}`]);
  const pointOptions = Array.from({ length: 7 }, (_, j) => [String(j), j === 5 ? 'D–H O5 · wrist' : j === 6 ? 'D–H O6 · flange' : `D–H O${j}`]);
  selects.append(
    makeSelect('Express in frame i', frameOptions, 0, (value) => { state.i = +value; update(); }),
    makeSelect('D–H reference Oⱼ', pointOptions, 5, (value) => { state.j = +value; update(); }),
    makeSelect('Joint column k', Array.from({ length: 6 }, (_, k) => [String(k + 1), `J${k + 1}`]), 1,
      (value) => { state.k = +value - 1; update(); })
  );
  const representation = panel.querySelector('[data-representation]');
  const dynamic = new THREE.Group();
  dynamic.name = 'ABB Jacobian geometry in world coordinates';
  world.add(dynamic);
  let visuals;

  function syncSliders() {
    sliders.forEach((input, k) => {
      input.value = state.q[k] / DEG;
      input.nextElementSibling.value = `${(state.q[k] / DEG).toFixed(2)}°`;
    });
  }

  panel.querySelector('.sing-case-buttons').addEventListener('click', (event) => {
    const preset = event.target.closest('button[data-case]')?.dataset.case;
    if (!preset) return;
    state.q = abbPreset(preset); state.preset = preset;
    syncSliders(); update();
  });
  panel.querySelector('[data-home]').addEventListener('click', () => {
    state.q = Array(6).fill(0); state.preset = 'home'; syncSliders(); update();
  });
  panel.querySelectorAll('[data-basis]').forEach((button) => button.addEventListener('click', () => {
    state.i = button.dataset.basis === 'preferred' ? 3 : 0; state.j = 5;
    const [basis, point] = selects.querySelectorAll('select');
    basis.value = state.i; point.value = state.j;
    update();
  }));
  representation.addEventListener('toggle', update);

  // The supplied CAD is around 2.5 m tall, considerably smaller than the old
  // generic teaching arm. Target is in Three's y-up display coordinates.
  kit.camera.position.set(4.3, 3.0, 4.6);
  kit.controls.target.set(.45, 1.15, 0);
  kit.controls.update();
  // The course's default lights suit dark links. Tone mapping retains detail
  // on the light ABB paint without changing any other scene.
  kit.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  kit.renderer.toneMappingExposure = .85;

  function label(position, text, color = 0x151515, scale = .36) {
    return addTextLabel(dynamic, position, text, color).scale.multiplyScalar(scale);
  }

  function annotationOffset(right, up) {
    return new THREE.Vector3(right, up, 0).applyQuaternion(kit.camera.quaternion)
      .applyQuaternion(world.quaternion.clone().invert());
  }

  function update() {
    clearGroup(dynamic);
    const kin = abbDHKinematics(state.q);
    visuals?.update(abbUrdfTransforms(state.q));
    const J = abbJacobian(state.q, { point: state.j, basis: state.i });
    const J0 = abbWorldJacobian(state.q);
    const J3 = abbPreferredJacobian(state.q);
    const A = J3.slice(0, 3).map((row) => row.slice(0, 3));
    const W = J3.slice(3).map((row) => row.slice(3));
    const rank = numericRank(J), armRank = numericRank(A), wristRank = numericRank(W);
    const factors = abbFactors(state.q);
    const zeros = Object.keys(factors).filter((key) => Math.abs(factors[key]) < 1e-7);
    const product = abbDeterminant(state.q), direct = determinant(J), referenceDet = determinant(J0);
    for (const [key, value] of Object.entries(factors)) {
      const metric = panel.querySelector(`[data-factor="${key}"]`);
      metric.querySelector('strong').textContent = signed(value, 5);
      metric.classList.toggle('near', Math.abs(value) < 1e-7);
    }
    panel.querySelectorAll('[data-case]').forEach((button) => {
      const selected = button.dataset.case === state.preset;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('active', selected);
    });
    panel.querySelectorAll('[data-basis]').forEach((button) => {
      const selected = state.j === 5 && state.i === (button.dataset.basis === 'preferred' ? 3 : 0);
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('active', selected);
    });
    panel.querySelector('[data-product]').textContent =
      `det ⁰J₅ (world) = ${signed(referenceDet, 6)} m³\n` +
      `det ${superscript(state.i)}J${subscript(state.j)} (chosen) = ${signed(direct, 6)} m³\n` +
      `−a₂ F G sin q₅  = ${signed(product, 6)} m³\n` +
      `rank J: ${rank}/6 · arm: ${armRank}/3 · wrist: ${wristRank}/3`;
    panel.querySelector('[data-product]').dataset.rank = rank;
    panel.querySelector('[data-product]').dataset.determinant = direct;
    panel.querySelector('[data-matrix]').textContent =
      `${superscript(state.i)}J${subscript(state.j)} · at D–H O${subscript(state.j)}, expressed in ${state.i === 0 ? 'world frame 0' : `D–H frame ${state.i}`}\n${matrixText(J, 3)}`;
    panel.querySelector('[data-world-matrix]').textContent = `Reference ⁰J₅ · world, wrist centre\n${matrixText(J0, 3)}`;
    panel.querySelector('[data-point-note]').textContent =
      'D–H frames are the assigned frames in the table; the CAD uses its original URDF link frames. ' +
      (state.j < 5
        ? `O${state.j} is a reference location for the terminal body's velocity field. This is not the material-point Jacobian of upstream link ${state.j}.`
        : `O${state.j} is ${state.j === 5 ? 'the common wrist centre' : 'the flange point'}; the frame selection only changes the axes used to report its absolute velocity.`);

    const message = zeros.length > 1
      ? 'Several factors vanish. Their losses can overlap; the computed rank counts the remaining independent task motions.'
      : zeros[0] === 'F'
        ? 'Elbow: columns 2 and 3 give parallel wrist-centre velocities. One translation is unavailable; all three wrist rotations remain.'
        : zeros[0] === 'G'
          ? 'Shoulder: O₅ lies on joint 1’s axis, so its linear column vanishes. The arm supplies only two independent translations.'
          : zeros[0] === 'wrist'
            ? 'Wrist: axes 4 and 6 coincide, so their full columns are dependent. One pure rotation at fixed O₅ is unavailable.'
            : 'Regular: three arm translations and three wrist rotations give six independent instantaneous motions. Change the frame to expose the zeros in J.';
    panel.querySelector('.sing-status').textContent = message;
    kit.hud.textContent = `ABB · world geometry · rank ${rank}/6`;

    const wrist = new THREE.Vector3(...kin.wrist);
    const points = kin.points.map((point) => new THREE.Vector3(...point));
    const axes = kin.axes.map((axis) => new THREE.Vector3(...axis));
    dynamic.add(sphere(wrist, .036, 0x222222));
    label(wrist.clone().add(annotationOffset(-.48, .22)), 'O5 · wrist centre', 0x151515, .4);
    if (zeros.includes('wrist')) {
      [3, 4, 5].forEach((k) => {
        const length = k === 3 ? 1.5 : k === 5 ? .95 : 1.15;
        addAxisLine(dynamic, wrist, axes[k], length, COLORS[k]);
        addArrow(dynamic, wrist, axes[k], length / 2, COLORS[k]);
        label(wrist.clone().addScaledVector(axes[k], length * .58), `axis ${k + 1}`, COLORS[k]);
      });
      if (armRank === 3 && wristRank === 2) {
        const missing = axes[3].clone().cross(axes[4]).normalize();
        addArrow(dynamic, wrist, missing, .65, 0xb31127);
        label(wrist.clone().addScaledVector(missing, .78), 'lost pure rotation', 0xb31127);
      }
    } else {
      const columns = [0, 1, 2].map((k) => new THREE.Vector3(J0[0][k], J0[1][k], J0[2][k]));
      columns.forEach((column, k) => {
        if (column.length() < 1e-7) return;
        addArrow(dynamic, wrist, column, .29, COLORS[k]);
        label(wrist.clone().addScaledVector(column, .33).add(new THREE.Vector3(0, 0, (1 - k) * .085)), `⁰J₅,ᵥ,${subscript(k + 1)}`, COLORS[k], .3);
      });
      if (armRank === 2) {
        const normals = [columns[0].clone().cross(columns[1]), columns[0].clone().cross(columns[2]), columns[1].clone().cross(columns[2])];
        const missing = normals.sort((a, b) => b.lengthSq() - a.lengthSq())[0].normalize();
        addArrow(dynamic, wrist, missing, .65, 0xb31127);
        label(wrist.clone().addScaledVector(missing, .78).add(annotationOffset(.1, .3)), 'lost translation', 0xb31127);
      }
      if (zeros.includes('G')) addAxisLine(dynamic, points[0], axes[0], 4, COLORS[0]);
    }
    if (representation.open) {
      const point = new THREE.Vector3(...kin.frames[state.j].slice(0, 3).map((row) => row[3]));
      const pk = points[state.k], axis = axes[state.k], lever = point.clone().sub(pk);
      addAxisLine(dynamic, pk, axis, 1.3, COLORS[state.k]);
      addArrow(dynamic, pk, lever, 1, 0xd79b00);
      addArrow(dynamic, point, axis.clone().cross(lever), .3, COLORS[state.k]);
      dynamic.add(sphere(point, .04, COLORS[state.k]));
      label(pk.clone().addScaledVector(axis, .76), `joint ${state.k + 1} axis`, COLORS[state.k]);
      if (state.j !== 5) label(point.clone().add(new THREE.Vector3(0, 0, .16)), `reference O${state.j}`);
    }
    kit.render();
  }

  update();
  visuals = await loadAbbIrbVisuals(world);
  kit.sceneControls.registerStlRoot(visuals.group);
  // This scene uses COLLADA CAD meshes; the shared control predates this format.
  const opacityLabel = kit.host.querySelector('.course-3d-opacity > span');
  if (opacityLabel) opacityLabel.textContent = 'Mesh opacity';
  update();
  const disposeWorld = kit.dispose.bind(kit);
  kit.dispose = () => {
    kit.sceneControls.unregisterStlRoot(visuals.group);
    visuals.dispose(); clearGroup(dynamic); dynamic.removeFromParent(); disposeWorld();
  };
  return { update, getState: () => ({ ...state, q: state.q.slice() }) };
}

function superscript(value) { return [...String(value)].map((digit) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+digit]).join(''); }
function subscript(value) { return [...String(value)].map((digit) => '₀₁₂₃₄₅₆₇₈₉'[+digit]).join(''); }
