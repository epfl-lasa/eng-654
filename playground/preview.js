/* A small dependency-free pose viewer. All coordinates use column vectors. */
(function (global) {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const WIDTH = 350;
  const HEIGHT = 250;
  const DEFAULT_CAMERA = { azimuth: 0.82, elevation: 0.53, zoom: 1, panX: 0, panY: 0 };
  const CONTROLS_HELP = "Drag to orbit; right-drag or Shift-drag to pan; scroll to zoom. On touch screens, use one finger to orbit and two fingers to pan or pinch. Arrow keys orbit, Shift + arrows pan, +/− zoom, and Home resets.";

  function svgElement(tag, attributes, value) {
    const element = document.createElementNS(NS, tag);
    Object.entries(attributes || {}).forEach(([key, item]) => element.setAttribute(key, String(item)));
    if (value !== undefined) element.textContent = value;
    return element;
  }

  function numericPose(matrix) {
    if (!Array.isArray(matrix)) return null;
    const identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    let rotation = identity;
    let translation = [0, 0, 0];
    if (matrix.length === 4 && matrix.every(row => Array.isArray(row) && row.length === 4)) {
      rotation = matrix.slice(0, 3).map(row => row.slice(0, 3));
      translation = matrix.slice(0, 3).map(row => row[3]);
    } else if (matrix.length === 3 && matrix.every(row => Array.isArray(row) && row.length === 3)) {
      rotation = matrix.map(row => row.slice());
    } else if (matrix.length === 3 && matrix.every(row => Array.isArray(row) && row.length === 1)) {
      translation = matrix.map(row => row[0]);
    } else if (matrix.length === 3 && matrix.every(value => typeof value === "number")) {
      translation = matrix.slice();
    } else {
      return null;
    }
    return [...rotation.flat(), ...translation].every(Number.isFinite) ? { rotation, translation } : null;
  }

  function create(container) {
    container.classList.add("frame-preview");
    const svg = svgElement("svg", {
      viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
      role: "img",
      "aria-label": `Numeric pose preview. ${CONTROLS_HELP}`,
      title: CONTROLS_HELP,
      tabindex: "0",
    });
    const caption = document.createElement("div");
    caption.className = "preview-caption";
    const captionText = document.createElement("span");
    captionText.textContent = "Drag: orbit · scroll: zoom";
    const key = document.createElement("span");
    key.className = "preview-key";
    key.textContent = "Output frame";
    const reset = document.createElement("button");
    reset.type = "button";
    reset.textContent = "Reset";
    reset.className = "preview-reset";
    reset.title = "Reset the camera view";
    reset.setAttribute("aria-label", "Reset pose preview camera");
    caption.append(captionText, key, reset);
    container.append(svg, caption);

    let pose = null;
    let camera = { ...DEFAULT_CAMERA };
    const pointers = new Map();
    let disposed = false;

    function render() {
      if (disposed) return;
      svg.replaceChildren();
      const translation = pose ? pose.translation : [0, 0, 0];
      // Scale both frames together so translations remain legible at any size.
      const extent = Math.max(1, Math.hypot(...translation) * 0.7);
      const axisLength = extent * 0.72;
      const center = translation.map(value => value * 0.43);
      const az = camera.azimuth;
      const el = camera.elevation;
      const scale = 79 * camera.zoom / extent;
      function project(point) {
        const x = point[0] - center[0];
        const y = point[1] - center[1];
        const z = point[2] - center[2];
        return [
          WIDTH / 2 + camera.panX + (Math.cos(az) * x - Math.sin(az) * y) * scale,
          HEIGHT * 0.56 + camera.panY + (Math.sin(el) * (Math.sin(az) * x + Math.cos(az) * y) - Math.cos(el) * z) * scale,
        ];
      }
      function line(a, b, color, width, attributes) {
        const start = project(a);
        const end = project(b);
        svg.append(svgElement("line", { x1: start[0], y1: start[1], x2: end[0], y2: end[1], stroke: color, "stroke-width": width, ...attributes }));
        return { start, end };
      }
      function label(position, text, color, dx = 0, dy = 0, size = 11) {
        const point = project(position);
        svg.append(svgElement("text", { x: point[0] + dx, y: point[1] + dy, fill: color, "font-size": size, "font-family": "Helvetica Neue, Arial, sans-serif", "text-anchor": "middle", "paint-order": "stroke", stroke: "#fafafa", "stroke-width": 3, "stroke-linejoin": "round" }, text));
      }
      function arrow(origin, end, color, width) {
        const segment = line(origin, end, color, width);
        const dx = segment.end[0] - segment.start[0];
        const dy = segment.end[1] - segment.start[1];
        const length = Math.hypot(dx, dy);
        if (length < 5) return;
        const ux = dx / length;
        const uy = dy / length;
        const tip = segment.end;
        const size = 5;
        const left = [tip[0] - ux * size - uy * size * 0.45, tip[1] - uy * size + ux * size * 0.45];
        const right = [tip[0] - ux * size + uy * size * 0.45, tip[1] - uy * size - ux * size * 0.45];
        svg.append(svgElement("polygon", { points: [tip, left, right].map(point => point.join(",")).join(" "), fill: color }));
      }

      // The reference grid lies in the base x-y plane.
      const gridSize = extent * 1.2;
      for (let index = -3; index <= 3; index += 1) {
        const offset = index * gridSize / 3;
        line([-gridSize, offset, 0], [gridSize, offset, 0], "#e6e6e6", 0.8);
        line([offset, -gridSize, 0], [offset, gridSize, 0], "#e6e6e6", 0.8);
      }

      const origin = [0, 0, 0];
      const axisNames = ["x", "y", "z"];
      axisNames.forEach((name, axis) => {
        const end = [0, 0, 0];
        end[axis] = axisLength * 1.2;
        arrow(origin, end, "#888888", 1.25);
        const textPoint = end.map(value => value * 1.13);
        label(textPoint, `${name}₀`, "#777777", 0, 3, 10);
      });
      const screenOrigin = project(origin);
      svg.append(svgElement("circle", { cx: screenOrigin[0], cy: screenOrigin[1], r: 2.5, fill: "#555555" }));
      label(origin, "O", "#666666", -9, 13, 9);

      if (!pose) {
        captionText.textContent = "Set symbol values for a numeric preview";
        key.hidden = true;
        return;
      }
      captionText.textContent = "Drag: orbit · scroll: zoom";
      key.hidden = false;
      if (Math.hypot(...translation) > 1e-9) {
        line(origin, translation, "#a0a0a0", 1, { "stroke-dasharray": "3 3" });
        line(translation, [translation[0], translation[1], 0], "#b5b5b5", 0.8, { "stroke-dasharray": "2 3" });
      }
      // Matrix columns are the transformed frame's axes in the base frame.
      axisNames.forEach((name, axis) => {
        const direction = pose.rotation.map(row => row[axis]);
        const end = translation.map((value, coordinate) => value + axisLength * direction[coordinate]);
        arrow(translation, end, "#ff0000", 1.9);
        const textPoint = translation.map((value, coordinate) => value + axisLength * 1.16 * direction[coordinate]);
        label(textPoint, name, "#ff0000", 0, 3, 11);
      });
      const point = project(translation);
      svg.append(svgElement("circle", { cx: point[0], cy: point[1], r: 3, fill: "#ff0000", stroke: "white", "stroke-width": 1 }));
      if (Math.hypot(...translation) > 1e-9) label(translation, "p", "#ff0000", 9, 13, 10);
    }

    function onPointerDown(event) {
      if (event.button > 2 || (event.pointerType !== "touch" && pointers.size)) return;
      const mode = event.button === 1 ? "zoom" : event.button === 2 || event.shiftKey || event.ctrlKey || event.metaKey ? "pan" : "orbit";
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, mode });
      svg.setPointerCapture(event.pointerId);
      svg.focus({ preventScroll: true });
      event.preventDefault();
    }
    function changeZoom(factor) { camera.zoom = Math.max(0.15, Math.min(12, camera.zoom * factor)); }
    function screenScale() {
      const rect = svg.getBoundingClientRect();
      return { x: WIDTH / Math.max(1, rect.width), y: HEIGHT / Math.max(1, rect.height) };
    }
    function touchPair() {
      const [a, b] = [...pointers.values()];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) };
    }
    function onPointerMove(event) {
      const pointer = pointers.get(event.pointerId);
      if (!pointer) return;
      if (!svg.hasPointerCapture(event.pointerId)) { onPointerUp(event); return; }
      const previousPair = pointers.size > 1 ? touchPair() : null;
      const scale = screenScale();
      const dx = (event.clientX - pointer.x) * scale.x;
      const dy = (event.clientY - pointer.y) * scale.y;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      if (previousPair) {
        const nextPair = touchPair();
        camera.panX += (nextPair.x - previousPair.x) * scale.x;
        camera.panY += (nextPair.y - previousPair.y) * scale.y;
        if (previousPair.distance > 1) changeZoom(nextPair.distance / previousPair.distance);
      } else if (pointer.mode === "pan") {
        camera.panX += dx;
        camera.panY += dy;
      } else if (pointer.mode === "zoom") {
        changeZoom(Math.exp(-dy * 0.01));
      } else {
        camera.azimuth += dx * 0.011;
        camera.elevation = Math.max(-1.35, Math.min(1.35, camera.elevation + dy * 0.009));
      }
      event.preventDefault();
      render();
    }
    function onPointerUp(event) {
      if (!pointers.delete(event.pointerId)) return;
      if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    }
    function cancelPointers() {
      [...pointers.keys()].forEach(pointerId => onPointerUp({ pointerId }));
    }
    function onWheel(event) {
      event.preventDefault();
      event.stopPropagation();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? HEIGHT : 1;
      changeZoom(Math.exp(-Math.max(-1000, Math.min(1000, event.deltaY * unit)) * 0.0015));
      render();
    }
    function onKeyDown(event) {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-", "_", "Home", "0"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Home" || event.key === "0") { onReset(); return; }
      if (event.key === "+" || event.key === "=") changeZoom(1.15);
      if (event.key === "-" || event.key === "_") changeZoom(1 / 1.15);
      if (event.shiftKey) {
        if (event.key === "ArrowLeft") camera.panX -= 12;
        if (event.key === "ArrowRight") camera.panX += 12;
        if (event.key === "ArrowUp") camera.panY -= 12;
        if (event.key === "ArrowDown") camera.panY += 12;
      } else {
        if (event.key === "ArrowLeft") camera.azimuth -= 0.12;
        if (event.key === "ArrowRight") camera.azimuth += 0.12;
        if (event.key === "ArrowUp") camera.elevation = Math.max(-1.35, camera.elevation - 0.1);
        if (event.key === "ArrowDown") camera.elevation = Math.min(1.35, camera.elevation + 0.1);
      }
      render();
    }
    function onReset() { cancelPointers(); camera = { ...DEFAULT_CAMERA }; render(); }
    function onContextMenu(event) { event.preventDefault(); }
    svg.addEventListener("pointerdown", onPointerDown);
    svg.addEventListener("pointermove", onPointerMove);
    svg.addEventListener("pointerup", onPointerUp);
    svg.addEventListener("pointercancel", onPointerUp);
    svg.addEventListener("lostpointercapture", onPointerUp);
    svg.addEventListener("wheel", onWheel, { passive: false });
    svg.addEventListener("keydown", onKeyDown);
    svg.addEventListener("dblclick", onReset);
    svg.addEventListener("contextmenu", onContextMenu);
    reset.addEventListener("click", onReset);
    global.addEventListener?.("blur", cancelPointers);
    render();

    return {
      update(matrix) { pose = numericPose(matrix); render(); },
      dispose() {
        disposed = true;
        cancelPointers();
        svg.removeEventListener("pointerdown", onPointerDown);
        svg.removeEventListener("pointermove", onPointerMove);
        svg.removeEventListener("pointerup", onPointerUp);
        svg.removeEventListener("pointercancel", onPointerUp);
        svg.removeEventListener("lostpointercapture", onPointerUp);
        svg.removeEventListener("wheel", onWheel);
        svg.removeEventListener("keydown", onKeyDown);
        svg.removeEventListener("dblclick", onReset);
        svg.removeEventListener("contextmenu", onContextMenu);
        reset.removeEventListener("click", onReset);
        global.removeEventListener?.("blur", cancelPointers);
        svg.remove();
        caption.remove();
      },
    };
  }

  global.KinematicsPreview = { create };
})(typeof window !== "undefined" ? window : globalThis);
