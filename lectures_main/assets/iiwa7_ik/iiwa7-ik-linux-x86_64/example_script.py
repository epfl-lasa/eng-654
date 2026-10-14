"""Call the Rust iiwa7 IK executable using Python's standard library.

Keep this file alongside iiwa7-ik (Linux) or iiwa7-ik.exe
(Windows). Use --useful-only to keep URDF hard-limit-valid configurations.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess

# FK of [0.4, -0.7, 0.5, 1.8, -0.9, 0.8, 0.3] at iiwa_link_ee.
EXAMPLE_POSE = [
    -0.3664404775042923, -0.4762924875117099, 0.34911314922081393,
    -0.5127319024430761, -0.4812309966767833, 0.5445534784622869,
    -0.4571479335501771,
]


def solve_ik(pose, q3, *, useful_only=False, frame="iiwa_link_ee", binary=None):
    """Return all branches for pose=[px,py,pz,qw,qx,qy,qz] and q3 in radians."""
    if binary is None:
        binary_name = "iiwa7-ik.exe" if os.name == "nt" else "iiwa7-ik"
        binary = Path(__file__).resolve().parent / binary_name
    request = {
        "pose": list(pose),
        "q3": q3,
        "frame": frame,
        "respect_limits": useful_only,
    }
    result = subprocess.run(
        [str(Path(binary).resolve()), "solve-pose"],
        input=json.dumps(request, allow_nan=False),
        capture_output=True,
        text=True,
    )
    if not result.stdout.strip():
        raise RuntimeError(f"Solver produced no JSON (exit {result.returncode}): {result.stderr}")
    report = json.loads(result.stdout)
    if result.returncode != 0:
        raise RuntimeError(report.get("error", result.stderr))
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pose", nargs=7, type=float, default=EXAMPLE_POSE,
                        metavar=("PX", "PY", "PZ", "QW", "QX", "QY", "QZ"))
    parser.add_argument("--q3", type=float, default=0.5, help="third joint angle in radians")
    parser.add_argument("--useful-only", action="store_true", help="keep only configurations within URDF hard limits")
    parser.add_argument("--frame", choices=("iiwa_link_ee", "iiwa_link_7"), default="iiwa_link_ee")
    parser.add_argument("--binary", type=Path, help="override the executable path")
    args = parser.parse_args()
    report = solve_ik(args.pose, args.q3, useful_only=args.useful_only,
                      frame=args.frame, binary=args.binary)
    print(f"Found {len(report['solutions'])} IK solutions for q3={args.q3} rad")
    for index, solution in enumerate(report["solutions"], start=1):
        angles = ", ".join(f"{q:.10f}" for q in solution["q"])
        print(f"IK {index} ({solution['branch']}): [{angles}]")
        print(f"  Within joint limits: {solution['within_limits']}")
        print(f"  FK errors: {solution['position_error']:.3e} m, {solution['rotation_error']:.3e} rad")
        if solution["free_parameters"]:
            print(f"  Continuous family: {solution['free_parameters']}")


if __name__ == "__main__":
    main()
