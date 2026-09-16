import { inverse, followPath } from './abbCrbKinematics.js';
import { calculateSlice } from './abbCrbSlice.js';
import { q4LimitCurve } from './abbCrbJointLimitCurves.js';

// Keep polynomial root solving and path continuation off the lecture's UI thread.
self.onmessage = event => {
  const { id, operation, payload } = event.data;
  try {
    let result;
    if (operation === 'inverse') result = inverse(payload.pose);
    else if (operation === 'slice') result = calculateSlice(payload, progress => self.postMessage({ id, progress }));
    else if (operation === 'q4-limit-curve') result = q4LimitCurve(payload);
    else if (operation === 'follow') result = followPath(payload.poses, payload.q);
    else if (operation === 'compare') {
      result = payload.solutions.map((solution, index) => {
        const track = followPath(payload.poses, solution.q);
        self.postMessage({ id, progress: { done: index + 1, total: payload.solutions.length } });
        return { index, ...track };
      });
    } else throw new Error('Unknown ABB CRB calculation.');
    self.postMessage({ id, result });
  } catch (error) { self.postMessage({ id, error: error.message || String(error) }); }
};
