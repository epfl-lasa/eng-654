"""Independent XML/FK validation of the Rust source geometry and executable.

Standard library only. Run from any directory after cargo build --release.
"""
import argparse
import ast
import json
import math
from pathlib import Path
import random
import re
import subprocess
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]


def mm(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(len(b)))
             for j in range(len(b[0]))] for i in range(len(a))]


def urdf_fk(joints, q, frame):
    t = [[float(i == j) for j in range(4)] for i in range(4)]
    for index, (xyz, rpy) in enumerate(joints[:8 if frame == "iiwa_link_ee" else 7]):
        roll, pitch, yaw = rpy
        cr, sr, cp, sp, cy, sy = (math.cos(roll), math.sin(roll), math.cos(pitch),
                                math.sin(pitch), math.cos(yaw), math.sin(yaw))
        origin = [[cy*cp, cy*sp*sr-sy*cr, cy*sp*cr+sy*sr, xyz[0]],
                  [sy*cp, sy*sp*sr+cy*cr, sy*sp*cr-cy*sr, xyz[1]],
                  [-sp, cp*sr, cp*cr, xyz[2]], [0, 0, 0, 1]]
        angle = q[index] if index < 7 else 0.0
        c, s = math.cos(angle), math.sin(angle)
        t = mm(mm(t, origin), [[c, -s, 0, 0], [s, c, 0, 0],
                              [0, 0, 1, 0], [0, 0, 0, 1]])
    return t


def quaternion_matrix(pose):
    w, x, y, z = pose[3:]
    length = math.hypot(w, x, y, z)
    w, x, y, z = (v / length for v in (w, x, y, z))
    return [[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
            [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
            [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]]


def invoke(binary, command, request):
    result = subprocess.run([str(binary), command], input=json.dumps(request),
                            text=True, capture_output=True, check=True)
    return json.loads(result.stdout)


def source_array(path, constant):
    match = re.search(r"pub const " + constant + r":.*?=\s*(\[.*?\]);",
                      path.read_text(), re.S)
    if match is None:
        raise AssertionError(f"Missing constant {constant}")
    return ast.literal_eval(match.group(1))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, default=ROOT / "target/release/iiwa7-ik")
    parser.add_argument("--samples", type=int, default=512)
    args = parser.parse_args()
    if args.samples <= 0:
        parser.error("--samples must be positive")
    urdf = ROOT.parent / "models/iiwa7/iiwa7.urdf"
    xml = ET.parse(urdf).getroot()
    joints, limits = [], []
    for name in [f"iiwa_joint_{i}" for i in range(1, 8)] + ["iiwa_joint_ee"]:
        joint = xml.find(f"joint[@name='{name}']")
        assert joint is not None and joint.get("type") == ("fixed" if name.endswith("ee") else "revolute")
        if not name.endswith("ee"):
            assert joint.find("axis").get("xyz").split() == ["0", "0", "1"]
        origin = joint.find("origin")
        joints.append(tuple([float(v) for v in origin.get(key).split()] for key in ("xyz", "rpy")))
        if name != "iiwa_joint_ee":
            lower, upper = (float(joint.find("limit").get(k)) for k in ("lower", "upper"))
            assert lower == -upper
            limits.append(upper)
    assert [j[0] for j in joints[:7]] == source_array(ROOT / "src/benchmark.rs", "URDF_XYZ")
    assert [j[1] for j in joints[:7]] == source_array(ROOT / "src/benchmark.rs", "URDF_RPY")
    assert joints[7] == ([0.0, 0.0, 0.045], [0.0, 0.0, 0.0])
    assert limits == source_array(ROOT / "src/lib.rs", "LIMITS")
    rng = random.Random(654)
    max_matrix_error, max_position_error, solutions = 0.0, 0.0, 0
    for frame in ("iiwa_link_ee", "iiwa_link_7"):
        for _ in range(args.samples):
            q = [rng.uniform(-math.pi, math.pi) for _ in range(7)]
            reference = urdf_fk(joints, q, frame)
            request = invoke(args.binary, "fk", {"q": q, "frame": frame})
            rotation = quaternion_matrix(request["pose"])
            pe = math.dist([row[3] for row in reference[:3]], request["pose"][:3])
            me = max(abs(reference[i][j]-rotation[i][j]) for i in range(3) for j in range(3))
            assert pe < 1e-14 and me < 1e-14, (q, pe, me)
            report = invoke(args.binary, "solve-pose", request)
            assert len(report["solutions"]) == 8, (q, report)
            assert any(max(abs(math.remainder(a-b, math.tau)) for a, b in zip(s["q"], q)) < 2e-6
                       for s in report["solutions"])
            for solution in report["solutions"]:
                actual = urdf_fk(joints, solution["q"], frame)
                pe = math.dist([row[3] for row in actual[:3]], [row[3] for row in reference[:3]])
                me = max(abs(actual[i][j]-reference[i][j]) for i in range(3) for j in range(3))
                assert pe < 2e-8 and me < 2e-8
                assert solution["q"][2] == q[2]
                expected_limits = all(abs(v) <= limit+1e-12 for v, limit in zip(solution["q"], limits))
                assert solution["within_limits"] == expected_limits
                max_position_error = max(max_position_error, pe)
                max_matrix_error = max(max_matrix_error, me)
                solutions += 1
    print(json.dumps({"passed": True, "poses": 2*args.samples, "solutions": solutions,
                      "geometry_matches_urdf": True, "limits_match_urdf": True,
                      "max_position_error_m": max_position_error,
                      "max_rotation_matrix_element_error": max_matrix_error}, indent=2))


if __name__ == "__main__":
    main()
