"""Validate the packaged Windows binary under Wine against the Linux package.

Requires Wine on Linux. Example:
python3 scripts/verify_windows.py --wine /usr/bin/wine --benchmark-samples 1000000
All Wine state is placed in the explicitly selected temporary prefix.
"""
import argparse
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import random
import subprocess
import sys
import tempfile
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
PACKAGES = ROOT.parent / "iiwa7_ik"
sys.dont_write_bytecode = True


def wine_capture(command, **kwargs):
    # Wine's bootstrap services can inherit stdout/stderr beyond the console
    # process lifetime. Files let us wait for the requested executable without
    # waiting for those unrelated services to close inherited pipe handles.
    kwargs.pop("capture_output", None)
    with tempfile.TemporaryFile(mode="w+t") as out, tempfile.TemporaryFile(mode="w+t") as err:
        result = subprocess.run(command, stdout=out, stderr=err, **kwargs)
        out.seek(0)
        err.seek(0)
        return subprocess.CompletedProcess(result.args, result.returncode, out.read(), err.read())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wine", default="wine")
    parser.add_argument("--prefix", type=Path, default=Path(tempfile.gettempdir()) / "iiwa7-wine-validation")
    parser.add_argument("--samples", type=int, default=100)
    parser.add_argument("--benchmark-samples", type=int, default=1_000_000)
    parser.add_argument("--output", type=Path, default=ROOT / "windows_validation_results.json")
    args = parser.parse_args()
    if args.samples < 1 or args.benchmark_samples < 1:
        parser.error("sample counts must be positive")
    env = os.environ.copy()
    env.update(WINEPREFIX=str(args.prefix.resolve()), WINEARCH="win64", WINEDEBUG="-all",
               WINEDLLOVERRIDES="winemenubuilder.exe=d")
    env.pop("DISPLAY", None)
    env.pop("WAYLAND_DISPLAY", None)
    wine = Path(args.wine)
    if wine.is_absolute() and wine.with_name("wineserver").is_file():
        env["WINESERVER"] = str(wine.with_name("wineserver"))
        env["WINELOADER"] = str(wine)
        env["WINEDLLPATH"] = str(wine.parent)
    windows = PACKAGES / "iiwa7-ik-windows-x86_64/iiwa7-ik.exe"
    linux = PACKAGES / "iiwa7-ik-linux-x86_64/iiwa7-ik"

    def call(command, request=None, flags=(), *, platform="windows", success=True):
        invocation = ([args.wine, str(windows)] if platform == "windows" else [str(linux)])
        runner = wine_capture if platform == "windows" else subprocess.run
        result = runner(invocation + [command] + list(flags),
                                input=json.dumps(request) if request is not None else None,
                                env=env, text=True, capture_output=True, timeout=180)
        assert (result.returncode == 0) == success, (command, result.returncode, result.stderr)
        return json.loads(result.stdout)

    # Warm up the isolated prefix, then keep its server alive between calls.
    startup = wine_capture([args.wine, str(windows), "--version"], env=env,
                             capture_output=True, text=True, timeout=55)
    assert startup.returncode == 0, (startup.returncode, startup.stdout, startup.stderr)
    version = startup.stdout.strip()
    server = env.get("WINESERVER", "wineserver")
    keepalive = subprocess.run([server, "-p"], env=env, timeout=10)
    assert keepalive.returncode in (0, 2), "Wine server failed to start"
    example = json.loads((windows.parent / "pose.json").read_text())
    for flags, expected in [((), 8), (("--useful-only",), 4)]:
        result = call("solve-pose", example, flags)
        assert len(result["solutions"]) == expected
        if flags:
            assert all(s["within_limits"] for s in result["solutions"])
        else:
            (windows.parent / "example-output.json").write_text(json.dumps(result, indent=2) + "\n")
    # Run the identical caller with each OS's executable selection. For Windows,
    # Wine wraps only process launch; the caller sends its ordinary stdin JSON.
    for platform, package in [("linux", linux.parent), ("windows", windows.parent)]:
        spec = importlib.util.spec_from_file_location("iiwa7_example", package / "example_script.py")
        caller = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(caller)
        if platform == "windows":
            caller.os = SimpleNamespace(name="nt")
            caller.subprocess = SimpleNamespace(run=lambda command, **kwargs: wine_capture([args.wine] + command, env=env, **kwargs))
        for useful, expected in [(False, 8), (True, 4)]:
            assert len(caller.solve_ik(caller.EXAMPLE_POSE, 0.5, useful_only=useful)["solutions"]) == expected
    for request in [{"pose": [0, 0, 1, 1, 0, 0, 0]},
                    {"pose": [0, 0, 1, 0, 0, 0, 0], "q3": 0},
                    {"pose": [0, 0, 1, 1, 0, 0, 0], "q3": 0, "frame": "link6"}]:
        assert isinstance(call("solve-pose", request, success=False)["error"], str)

    rng = random.Random(654)
    matched, maximum_joint_difference = 0, 0.0
    for frame in ("iiwa_link_ee", "iiwa_link_7"):
        for _ in range(args.samples):
            q = [rng.uniform(-math.pi, math.pi) for _ in range(7)]
            target = call("fk", {"q": q, "frame": frame}, platform="linux")
            win = call("solve-pose", target)["solutions"]
            lin = call("solve-pose", target, platform="linux")["solutions"]
            assert len(win) == len(lin) == 8
            for solution in lin:
                nearest = min(max(abs(math.remainder(a-b, math.tau)) for a, b in zip(solution["q"], other["q"])) for other in win)
                assert nearest < 2e-6
                maximum_joint_difference = max(maximum_joint_difference, nearest)
                matched += 1
            assert all(s["q"][2] == q[2] for s in win)

    # Edge poses exercise the same canonical continuous families on Windows.
    for q in [[0.0]*7, [0.4, -0.7, 0.5, 1.2, -0.9, 0.0, 0.3],
              [0.2, -0.4, 0.3, math.pi, 0.5, 0.6, -0.8]]:
        target = call("fk", {"q": q})
        result = call("solve-pose", target)
        assert result["solutions"]
        for solution in result["solutions"]:
            assert solution["position_error"] < 2e-8 and solution["rotation_error"] < 2e-8
    report = {
        "passed": True,
        "validation_environment": subprocess.check_output([args.wine, "--version"], env=env, text=True).strip(),
        "native_windows_machine_tested": False,
        "version": version,
        "binary_sha256": hashlib.sha256(windows.read_bytes()).hexdigest(),
        "python_examples_identical": (windows.parent / "example_script.py").read_bytes() == (linux.parent / "example_script.py").read_bytes(),
        "python_caller_tested_for_both_operating_system_selections": True,
        "compared_poses": 2*args.samples,
        "matched_linux_branches": matched,
        "maximum_joint_difference_rad": maximum_joint_difference,
        "example_solution_counts": {"all": 8, "useful_only": 4},
        "invalid_input_cases": 3,
        "singular_pose_cases": 3,
        "benchmark_runs": [],
    }
    assert report["python_examples_identical"]
    for flags in [[], ["--within-limits"]]:
        print(f"Benchmarking Windows binary: {args.benchmark_samples} poses {flags}", flush=True)
        benchmark = call("benchmark", flags=["--samples", str(args.benchmark_samples), "--seed", "654"] + flags)
        assert benchmark["passed"]
        report["benchmark_runs"].append(benchmark)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({k: v for k, v in report.items() if k != "benchmark_runs"}, indent=2))


if __name__ == "__main__":
    main()
