import { ABB_PARAMETERS, ABB_JOINT_LIMITS, abbUrdfTransforms, abbFactors, abbDeterminant } from './abbIrbKinematics.js';

// ABB IRB 4600-40/2.55. Radians, metres, nested row-major matrices.
// A target gives the world wrist centre O5 and the world-from-tool0 (default)
// or world-from-flange rotation. These are the source model's tool frames.
export { ABB_PARAMETERS, ABB_JOINT_LIMITS };
const PI = Math.PI, EPS = 1e-10;
const wrap = value => Math.atan2(Math.sin(value), Math.cos(value));
const clamp = value => Math.max(-1, Math.min(1, value));
const transpose = matrix => matrix[0].map((_, column) => matrix.map(row => row[column]));
const multiply = (a, b) => a.map(row => b[0].map((_, column) =>
  row.reduce((sum, value, index) => sum + value * b[index][column], 0)));
const rotationOf = matrix => matrix.slice(0, 3).map(row => row.slice(0, 3));
const positionOf = matrix => matrix.slice(0, 3).map(row => row[3]);
const distance = (a, b) => Math.hypot(...a.map((value, index) => value - b[index]));
const rz = q => [[Math.cos(q), -Math.sin(q), 0], [Math.sin(q), Math.cos(q), 0], [0, 0, 1]];
const ry = q => [[Math.cos(q), 0, Math.sin(q)], [0, 1, 0], [-Math.sin(q), 0, Math.cos(q)]];
const frameRotation = (rotation, frame) => {
  if (frame !== 'tool0' && frame !== 'flange') throw new RangeError('ABB IK frame must be tool0 or flange.');
  return frame === 'tool0' ? multiply(rotation, ry(-PI / 2)) : rotation;
};

export const ABB_DOWNWARD_TOOL_ROTATION = Object.freeze([
  Object.freeze([1, 0, 0]), Object.freeze([0, -1, 0]), Object.freeze([0, 0, -1])
]);

// G is a signed radial coordinate, so both shoulders must be considered.
// L = hypot(a3,d4), beta = atan2(d4,a3) turn the offset forearm into a 2R arm:
// [G-a1, z-d1] = a2 [sin q2, cos q2] + L [sin(q2+q3+beta), cos(q2+q3+beta)].
export function solveAbbArm(wrist, parameters = ABB_PARAMETERS) {
  const p = { ...ABB_PARAMETERS, ...parameters };
  if (!Array.isArray(wrist) || wrist.length !== 3 || wrist.some(value => !Number.isFinite(value))) return [];
  const [x, y, z] = wrist, radial = Math.hypot(x, y), height = z - p.d1;
  const L = Math.hypot(p.a3, p.d4), beta = Math.atan2(p.d4, p.a3), results = [];
  if (p.a2 <= 0 || L <= 0) return results;
  for (const shoulder of radial < EPS ? [0] : [1, -1]) {
    const G = shoulder * radial, horizontal = G - p.a1;
    const cosine = (horizontal ** 2 + height ** 2 - p.a2 ** 2 - L ** 2) / (2 * p.a2 * L);
    if (Math.abs(cosine) > 1 + EPS) continue;
    const angle = Math.acos(clamp(cosine));
    const elbows = Math.abs(Math.sin(angle)) < EPS ? [0] : [1, -1];
    for (const elbow of elbows) {
      const theta = elbow === -1 ? -angle : angle;
      const q1 = shoulder === 0 ? 0 : wrap(Math.atan2(y, x) + (shoulder < 0 ? PI : 0));
      const q2 = wrap(Math.atan2(horizontal, height) - Math.atan2(L * Math.sin(theta), p.a2 + L * Math.cos(theta)));
      const q3 = wrap(theta - beta);
      results.push({ q: [q1, q2, q3], shoulder, elbow, singular: shoulder === 0 || elbow === 0 });
    }
  }
  return results;
}

// The source model has wrist axes x,y,x. After removing Rz(q1)Ry(q2+q3),
// M = Rx(q4)Ry(q5)Rx(q6); its two regular decompositions have opposite sin(q5).
// At a wrist singularity return one representative of the continuous family.
export function solveAbbWrist(qArm, rotation, { frame = 'tool0' } = {}) {
  const flangeRotation = frameRotation(rotation, frame);
  const armRotation = multiply(rz(qArm[0]), ry(qArm[1] + qArm[2]));
  const M = multiply(transpose(armRotation), flangeRotation);
  const cosine = clamp(M[0][0]), sineMagnitude = Math.hypot(M[1][0], M[2][0]);
  const angle = Math.atan2(sineMagnitude, cosine);
  if (sineMagnitude < EPS) {
    return [{ q: [0, cosine > 0 ? 0 : PI, Math.atan2((cosine > 0 ? 1 : -1) * M[2][1], M[1][1])], wrist: 0, singular: true }];
  }
  return [1, -1].map(wrist => {
    const q5 = wrist * angle, sine = Math.sin(q5);
    return { q: [Math.atan2(M[1][0] / sine, -M[2][0] / sine), q5,
      Math.atan2(M[0][1] / sine, M[0][2] / sine)], wrist, singular: false };
  });
}

export function abbIkTargetFromQ(q, { frame = 'tool0', parameters = ABB_PARAMETERS } = {}) {
  if (frame !== 'tool0' && frame !== 'flange') throw new RangeError('ABB IK frame must be tool0 or flange.');
  const transforms = abbUrdfTransforms(q, parameters);
  return { wrist: positionOf(transforms.link_5), rotation: rotationOf(transforms[frame]),
    position: positionOf(transforms[frame]), frame };
}

// Enumerate mathematical IK branches; joint limits are reported, never used to
// erase branches from the global IK distribution. No collision model is applied.
export function solveAbbIk({ wrist, rotation, frame = 'tool0' }, parameters = ABB_PARAMETERS) {
  const p = { ...ABB_PARAMETERS, ...parameters }, flangeRotation = frameRotation(rotation, frame);
  const expectedPosition = wrist.map((value, index) => value + p.d6 * flangeRotation[index][0]);
  const results = [];
  for (const arm of solveAbbArm(wrist, p)) {
    for (const orientation of solveAbbWrist(arm.q, rotation, { frame })) {
      const q = [...arm.q, ...orientation.q], transforms = abbUrdfTransforms(q, p);
      const actualRotation = rotationOf(transforms[frame]), factors = abbFactors(q, p);
      const positionError = distance(positionOf(transforms[frame]), expectedPosition);
      const wristError = distance(positionOf(transforms.link_5), wrist);
      const rotationError = distance(actualRotation.flat(), rotation.flat());
      if (Math.max(positionError, wristError, rotationError) > 1e-8) continue;
      results.push({ q, shoulder: arm.shoulder, elbow: arm.elbow, wrist: orientation.wrist,
        signs: [arm.shoulder, arm.elbow, orientation.wrist], factors,
        determinant: abbDeterminant(q, p), singular: arm.singular || orientation.singular,
        positionError, wristError, rotationError,
        withinLimits: q.every((value, index) => value >= ABB_JOINT_LIMITS[index][0] - EPS && value <= ABB_JOINT_LIMITS[index][1] + EPS)
      });
    }
  }
  return results;
}

const exampleTarget = Object.freeze({ wrist: Object.freeze([1.2, 0, 1.5]),
  rotation: ABB_DOWNWARD_TOOL_ROTATION, frame: 'tool0' });
const exampleSolutions = solveAbbIk(exampleTarget);
export const ABB_IK_EXAMPLE = Object.freeze({ target: exampleTarget,
  q: Object.freeze(exampleSolutions.find(row => row.withinLimits)?.q.slice() || exampleSolutions[0].q.slice()),
  solutions: Object.freeze(exampleSolutions)
});
