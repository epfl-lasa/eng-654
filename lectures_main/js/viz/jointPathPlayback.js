// Playback owns its animation-frame lifetime independently of path planning.
// Reset and replay render immediately, including when the last run just ended.
export function createJointPathPlayback({
  onFrame, onState, canPlay, duration,
  isVisible = () => true,
  requestFrame = callback => requestAnimationFrame(callback),
  cancelFrame = id => cancelAnimationFrame(id)
}) {
  let progress = 0, playing = false, frame = null, generation = 0;
  const publish = () => onState({ progress, playing });
  function pause() {
    generation += 1;
    if (frame !== null) cancelFrame(frame);
    frame = null;
    playing = false;
    publish();
  }
  function reset() {
    pause();
    progress = 0;
    if (canPlay()) onFrame(progress);
    publish();
  }
  function play() {
    if (playing || !canPlay() || !isVisible()) return;
    pause();
    if (progress >= 1) progress = 0;
    // Show the start again before asking the browser for the first new frame.
    onFrame(progress);
    playing = true;
    publish();
    const run = generation, from = progress, milliseconds = Math.max(1, duration());
    let started = null;
    const step = timestamp => {
      if (run !== generation || !playing) return;
      frame = null;
      if (!canPlay() || !isVisible()) { pause(); return; }
      // RAF timestamps define this run's clock. No mixing with a click-time
      // performance.now() that may fall after the current frame's timestamp.
      started ??= timestamp;
      progress = Math.max(from, Math.min(1, from + (timestamp - started) / milliseconds));
      onFrame(progress);
      if (progress >= 1) pause();
      else { publish(); frame = requestFrame(step); }
    };
    frame = requestFrame(step);
  }
  return { play, pause, reset };
}
