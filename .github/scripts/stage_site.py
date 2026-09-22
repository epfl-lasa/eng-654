#!/usr/bin/env python3
"""Stage the static site using the configured Exercise 01 release stage."""

import argparse
import json
from pathlib import Path
import shutil


RELEASE_CONFIG = Path("lectures_main/exercise_01_release.json")
SOLUTIONS = Path("lectures_main/solutions")
FEEDBACK_FILES = (
    "exercise_01.html",
    "js/exercise-01-verification.js",
)
ANSWER_FILE = "exercise_01_answers.json"
STAGES = ("exercise", "feedback", "answers")


def stage_site(source: Path, destination: Path) -> str:
    """Copy the site into a new/empty directory; reject invalid release settings."""
    source = source.resolve()
    destination = destination.resolve()
    if source == destination or source in destination.parents:
        raise ValueError("The staging destination must be outside the source tree.")
    config = json.loads((source / RELEASE_CONFIG).read_text(encoding="utf-8"))
    stage = config.get("stage") if isinstance(config, dict) else None
    if stage not in STAGES:
        raise ValueError(f"Release stage must be one of {', '.join(STAGES)}.")

    release_files = list(FEEDBACK_FILES) if stage != "exercise" else []
    if stage == "answers":
        release_files.append(ANSWER_FILE)
    for relative in release_files:
        if not (source / SOLUTIONS / relative).is_file():
            raise ValueError(f"Missing required release file: {SOLUTIONS / relative}")

    if destination.exists() and (
        not destination.is_dir() or any(destination.iterdir())
    ):
        raise ValueError("The staging destination must be new or empty.")

    def excluded(directory: str, names: list[str]) -> set[str]:
        ignored = {".git", ".github", "tests"}.intersection(names)
        if Path(directory) == source / "lectures_main":
            ignored.add("solutions")
        if Path(directory) == source / "lectures_main/assets":
            ignored.add("recordings")
        return ignored

    shutil.copytree(
        source,
        destination,
        ignore=excluded,
        symlinks=True,
        dirs_exist_ok=True,
    )
    # Release only these Exercise 01 files; keep other instructor material private.
    for relative in release_files:
        output = destination / SOLUTIONS / relative
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source / SOLUTIONS / relative, output)
    return stage


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path("."))
    parser.add_argument("--destination", type=Path, required=True)
    args = parser.parse_args()
    try:
        stage = stage_site(args.source, args.destination)
    except (OSError, ValueError) as error:
        parser.exit(1, f"Site staging failed: {error}\n")
    print(f"Staged Exercise 01 release '{stage}' in {args.destination.resolve()}")


if __name__ == "__main__":
    main()
