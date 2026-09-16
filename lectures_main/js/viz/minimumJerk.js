// Fixed-duration, rest-to-rest minimum-jerk progress on [0, 1].
// Cartesian minimum jerk follows for an affine (straight) path p(s).
export function minimumJerkState(time, duration = 1) {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(time)) throw new Error('Use a finite time and positive duration.');
  const u = Math.max(0, Math.min(1, time / duration));
  return {
    u,
    s: u * u * u * (10 + u * (-15 + 6 * u)),
    velocity: 30 * u * u * (1 - u) * (1 - u) / duration,
    acceleration: 60 * u * (1 - u) * (1 - 2 * u) / duration ** 2,
    jerk: (60 - 360 * u + 360 * u * u) / duration ** 3
  };
}

export function minimumJerkTime(progress, duration = 1) {
  if (!Number.isFinite(progress) || !Number.isFinite(duration) || duration <= 0) throw new Error('Use finite progress and positive duration.');
  if (progress <= 0) return 0;
  if (progress >= 1) return duration;
  let lo = 0, hi = duration;
  for (let i = 0; i < 52; i++) {
    const mid = (lo + hi) / 2;
    if (minimumJerkState(mid, duration).s < progress) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export function minimumJerkCost(distance, duration) {
  if (!Number.isFinite(distance) || !Number.isFinite(duration) || duration <= 0) throw new Error('Use a finite distance and positive duration.');
  return 720 * distance ** 2 / duration ** 5;
}
