export function initRobot2R() {
  document.querySelectorAll('[data-robot2r]').forEach(container => {
    createRobot2R(container);
  });
}

function createRobot2R(container) {
  const q1Initial = Number(container.dataset.q1 ?? 45);
  const q2Initial = Number(container.dataset.q2 ?? 60);
  const showTrace = container.dataset.trace !== 'false';
  let traceMode = container.dataset.traceMode === 'persistent' ? 'persistent' : 'fading';

  container.classList.add('robot2r-interactive');
  container.innerHTML = `
    <svg class="robot-svg" viewBox="-300 -250 600 500" aria-label="2R planar robot animation">
      <defs>
        <marker id="arrow-red-${uniqueId(container)}" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
          <path d="M0,0 L0,6 L9,3 z" fill="#ff0000"></path>
        </marker>
        <marker id="arrow-green-${uniqueId(container)}" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
          <path d="M0,0 L0,6 L9,3 z" fill="#82B366"></path>
        </marker>
      </defs>

      <line x1="-240" y1="0" x2="240" y2="0" class="world-axis"></line>
      <line x1="0" y1="-205" x2="0" y2="205" class="world-axis"></line>

      <line x1="0" y1="0" x2="80" y2="0" class="axis-x" marker-end="url(#arrow-red-${uniqueId(container)})"></line>
      <line x1="0" y1="0" x2="0" y2="-80" class="axis-y" marker-end="url(#arrow-green-${uniqueId(container)})"></line>
      <text x="88" y="7" class="frame-label">x₀</text>
      <text x="8" y="-88" class="frame-label">y₀</text>

      <polyline class="ee-path"></polyline>
      <line class="robot-link link1"></line>
      <line class="robot-link link2"></line>
      <circle class="robot-joint joint1" r="15"></circle>
      <circle class="robot-joint joint2" r="15"></circle>
      <circle class="robot-ee ee" r="11"></circle>
      <text class="joint-value q1-value"></text>
      <text class="joint-value q2-value"></text>
    </svg>

    <div class="robot-controls">
      <div class="slider-row">
        <label>q₁</label>
        <input class="q1-slider" type="range" min="-180" max="180" value="${q1Initial}" step="0.01" aria-label="q₁ angle">
        <div class="angle-input">
          <input class="q1-input" type="number" min="-180" max="180" value="${q1Initial}" step="0.01" aria-label="q₁ angle in degrees">
          <span aria-hidden="true">°</span>
        </div>
      </div>
      <div class="slider-row">
        <label>q₂</label>
        <input class="q2-slider" type="range" min="-180" max="180" value="${q2Initial}" step="0.01" aria-label="q₂ angle">
        <div class="angle-input">
          <input class="q2-input" type="number" min="-180" max="180" value="${q2Initial}" step="0.01" aria-label="q₂ angle in degrees">
          <span aria-hidden="true">°</span>
        </div>
      </div>
      <div class="control-buttons">
        <button type="button" class="control-button reset-robot">Reset</button>
        <button type="button" class="control-button clear-path">Clear path</button>
        <button type="button" class="control-button toggle-path-mode"></button>
      </div>
    </div>
  `;

  const svg = container.querySelector('svg');
  const link1 = svg.querySelector('.link1');
  const link2 = svg.querySelector('.link2');
  const joint1 = svg.querySelector('.joint1');
  const joint2 = svg.querySelector('.joint2');
  const ee = svg.querySelector('.ee');
  const eePath = svg.querySelector('.ee-path');
  const q1Value = svg.querySelector('.q1-value');
  const q2Value = svg.querySelector('.q2-value');

  const q1Slider = container.querySelector('.q1-slider');
  const q2Slider = container.querySelector('.q2-slider');
  const q1Input = container.querySelector('.q1-input');
  const q2Input = container.querySelector('.q2-input');
  const clearPathButton = container.querySelector('.clear-path');
  const resetButton = container.querySelector('.reset-robot');
  const pathModeButton = container.querySelector('.toggle-path-mode');

  const L1 = Number(container.dataset.l1 ?? 160);
  const L2 = Number(container.dataset.l2 ?? 130);
  const requestedFadingPathLength = Number(container.dataset.fadingPathLength ?? 250);
  const fadingPathLength = Number.isFinite(requestedFadingPathLength)
    ? Math.max(1, Math.round(requestedFadingPathLength))
    : 250;
  const requestedSmoothTime = Number(container.dataset.smoothTime ?? 0.12);
  const smoothTime = Number.isFinite(requestedSmoothTime)
    ? Math.max(0.04, requestedSmoothTime)
    : 0.12;
  const pathPoints = [];
  let currentQ1 = degToRad(q1Initial);
  let currentQ2 = degToRad(q2Initial);
  let targetQ1 = currentQ1;
  let targetQ2 = currentQ2;
  let velocityQ1 = 0;
  let velocityQ2 = 0;
  let animationFrame = null;
  let previousFrameTime = null;

  function svgY(y) { return -y; } // 2D teaching plane is y-up; SVG y is down.
  function degToRad(degrees) { return degrees * Math.PI / 180; }

  function forwardKinematics(q1, q2) {
    const x0 = 0;
    const y0 = 0;
    const x1 = L1 * Math.cos(q1);
    const y1 = L1 * Math.sin(q1);
    const x2 = x1 + L2 * Math.cos(q1 + q2);
    const y2 = y1 + L2 * Math.sin(q1 + q2);
    return { x0, y0, x1, y1, x2, y2 };
  }

  function formatDegrees(value) {
    return Number(value.toFixed(1)).toString();
  }

  function formatInputDegrees(value) {
    return Number(value.toFixed(2)).toString();
  }

  function updatePathModeButton() {
    const keepAll = traceMode === 'persistent';
    pathModeButton.textContent = keepAll ? 'Path: keep all' : 'Path: fading';
    pathModeButton.setAttribute('aria-pressed', keepAll ? 'true' : 'false');
  }

  function updateTrace(x, y) {
    if (!showTrace) return;

    const previousPoint = pathPoints.at(-1);
    if (previousPoint && Math.hypot(x - previousPoint.x, y - previousPoint.y) < 0.5) return;

    pathPoints.push({ x, y });
    if (traceMode === 'fading' && pathPoints.length > fadingPathLength) {
      pathPoints.splice(0, pathPoints.length - fadingPathLength);
    }
    eePath.setAttribute('points', pathPoints.map(point => `${point.x},${point.y}`).join(' '));
  }

  function drawRobot(q1, q2) {
    const p = forwardKinematics(q1, q2);

    link1.setAttribute('x1', p.x0);
    link1.setAttribute('y1', svgY(p.y0));
    link1.setAttribute('x2', p.x1);
    link1.setAttribute('y2', svgY(p.y1));

    link2.setAttribute('x1', p.x1);
    link2.setAttribute('y1', svgY(p.y1));
    link2.setAttribute('x2', p.x2);
    link2.setAttribute('y2', svgY(p.y2));

    joint1.setAttribute('cx', p.x0);
    joint1.setAttribute('cy', svgY(p.y0));
    joint2.setAttribute('cx', p.x1);
    joint2.setAttribute('cy', svgY(p.y1));
    ee.setAttribute('cx', p.x2);
    ee.setAttribute('cy', svgY(p.y2));

    q1Value.setAttribute('x', p.x0 + 25);
    q1Value.setAttribute('y', svgY(p.y0) + 35);
    q1Value.textContent = `q₁ = ${formatDegrees(q1 * 180 / Math.PI)}°`;

    q2Value.setAttribute('x', p.x1 + 20);
    q2Value.setAttribute('y', svgY(p.y1) - 20);
    q2Value.textContent = `q₂ = ${formatDegrees(q2 * 180 / Math.PI)}°`;

    updateTrace(p.x2, svgY(p.y2));
  }

  function smoothDamp(current, target, velocity, elapsed) {
    const omega = 2 / smoothTime;
    const scaledTime = omega * elapsed;
    const decay = 1 / (
      1 + scaledTime + 0.48 * scaledTime ** 2 + 0.235 * scaledTime ** 3
    );
    const displacement = current - target;
    const impulse = (velocity + omega * displacement) * elapsed;

    return {
      value: target + (displacement + impulse) * decay,
      velocity: (velocity - omega * impulse) * decay
    };
  }

  function animateRobot(time) {
    const elapsed = previousFrameTime === null
      ? 1 / 60
      : Math.min((time - previousFrameTime) / 1000, 0.05);
    previousFrameTime = time;

    // Retaining velocity prevents sharp path corners when a slider changes abruptly.
    const q1Motion = smoothDamp(currentQ1, targetQ1, velocityQ1, elapsed);
    const q2Motion = smoothDamp(currentQ2, targetQ2, velocityQ2, elapsed);
    currentQ1 = q1Motion.value;
    currentQ2 = q2Motion.value;
    velocityQ1 = q1Motion.velocity;
    velocityQ2 = q2Motion.velocity;

    const positionError = Math.max(
      Math.abs(targetQ1 - currentQ1),
      Math.abs(targetQ2 - currentQ2)
    );
    const speed = Math.max(Math.abs(velocityQ1), Math.abs(velocityQ2));
    const settled = positionError < 0.0001 && speed < 0.001;
    if (settled) {
      currentQ1 = targetQ1;
      currentQ2 = targetQ2;
      velocityQ1 = 0;
      velocityQ2 = 0;
    }

    drawRobot(currentQ1, currentQ2);

    if (settled) {
      animationFrame = null;
      previousFrameTime = null;
    } else {
      animationFrame = requestAnimationFrame(animateRobot);
    }
  }

  function setRobotTargets(q1Deg, q2Deg) {
    targetQ1 = degToRad(q1Deg);
    targetQ2 = degToRad(q2Deg);

    if (animationFrame === null) {
      animationFrame = requestAnimationFrame(animateRobot);
    }
  }

  function updateFromSliders() {
    const q1Deg = Number(q1Slider.value);
    const q2Deg = Number(q2Slider.value);
    q1Input.value = formatInputDegrees(q1Deg);
    q2Input.value = formatInputDegrees(q2Deg);
    setRobotTargets(q1Deg, q2Deg);
  }

  function updateFromNumberInput(input, slider) {
    if (!Number.isFinite(input.valueAsNumber)) return;

    const degrees = Math.max(-180, Math.min(180, input.valueAsNumber));
    slider.value = degrees;
    setRobotTargets(Number(q1Slider.value), Number(q2Slider.value));
  }

  function normalizeNumberInput(input, slider) {
    if (Number.isFinite(input.valueAsNumber)) {
      const degrees = Math.max(-180, Math.min(180, input.valueAsNumber));
      input.value = formatInputDegrees(degrees);
      slider.value = degrees;
    } else {
      input.value = formatInputDegrees(Number(slider.value));
    }
    setRobotTargets(Number(q1Slider.value), Number(q2Slider.value));
  }

  q1Slider.addEventListener('input', updateFromSliders);
  q2Slider.addEventListener('input', updateFromSliders);
  q1Input.addEventListener('input', () => updateFromNumberInput(q1Input, q1Slider));
  q2Input.addEventListener('input', () => updateFromNumberInput(q2Input, q2Slider));
  q1Input.addEventListener('change', () => normalizeNumberInput(q1Input, q1Slider));
  q2Input.addEventListener('change', () => normalizeNumberInput(q2Input, q2Slider));

  clearPathButton.addEventListener('click', () => {
    pathPoints.length = 0;
    eePath.setAttribute('points', '');
  });

  resetButton.addEventListener('click', () => {
    q1Slider.value = q1Initial;
    q2Slider.value = q2Initial;
    updateFromSliders();
  });

  pathModeButton.addEventListener('click', () => {
    traceMode = traceMode === 'fading' ? 'persistent' : 'fading';
    container.dataset.traceMode = traceMode;
    if (traceMode === 'fading' && pathPoints.length > fadingPathLength) {
      pathPoints.splice(0, pathPoints.length - fadingPathLength);
      eePath.setAttribute('points', pathPoints.map(point => `${point.x},${point.y}`).join(' '));
    }
    updatePathModeButton();
  });

  updatePathModeButton();
  updateFromSliders();
}

function uniqueId(el) {
  if (!el.dataset.uid) el.dataset.uid = Math.random().toString(36).slice(2, 8);
  return el.dataset.uid;
}
