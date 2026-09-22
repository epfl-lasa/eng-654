"""Check which Exercise 01 materials reach the Pages artifact at each stage."""

import json
from pathlib import Path
import tempfile
import unittest

from stage_site import ANSWER_FILE, FEEDBACK_FILES, RELEASE_CONFIG, SOLUTIONS, stage_site


class SiteStagingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="eng654-release-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "source"
        self.source.mkdir()
        self.public_files = {
            "index.html",
            "assets/projects/project_21.pdf",
            "lectures_main/exercises/exercise_01.html",
            "lectures_main/js/exercises/exercise-01-answers.js",
            "lectures_main/js/exercises/exercise-01-numbers.js",
            "lectures_main/js/exercises/exercise-01-visual-origins.js",
            "lectures_main/js/exercises/exercise-01-checker.js",
            "lectures_main/js/exercises/exercise-01-slide-checks.js",
            "lectures_main/assets/models/iiwa7/iiwa7.urdf",
            RELEASE_CONFIG.as_posix(),
        }
        private_files = {
            ".git/config",
            ".github/workflows/pages.yml",
            "tests/private.json",
            "lectures_main/tests/reference.json",
            "lectures_main/assets/recordings/eng654_lec00.mp4",
            "lectures_main/assets/recordings/kgmp_intro.m4a",
            f"{SOLUTIONS}/README.md",
            f"{SOLUTIONS}/exercise_02.html",
            f"{SOLUTIONS}/exercise_02_answers.json",
            f"{SOLUTIONS}/js/exercise-01-checker.js",
            f"{SOLUTIONS}/{ANSWER_FILE}",
            *(f"{SOLUTIONS}/{name}" for name in FEEDBACK_FILES),
        }
        for relative in self.public_files | private_files:
            path = self.source / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(relative, encoding="utf-8")

    def configure(self, stage):
        (self.source / RELEASE_CONFIG).write_text(
            json.dumps({"stage": stage}), encoding="utf-8"
        )

    def test_all_three_release_stages(self):
        for stage in ("exercise", "feedback", "answers"):
            with self.subTest(stage=stage):
                self.configure(stage)
                destination = self.root / stage
                self.assertEqual(stage_site(self.source, destination), stage)
                expected = set(self.public_files)
                if stage != "exercise":
                    expected.update(f"{SOLUTIONS}/{name}" for name in FEEDBACK_FILES)
                if stage == "answers":
                    expected.add(f"{SOLUTIONS}/{ANSWER_FILE}")
                actual = {
                    path.relative_to(destination).as_posix()
                    for path in destination.rglob("*")
                    if path.is_file()
                }
                self.assertEqual(actual, expected)
                for relative in expected:
                    self.assertEqual(
                        (destination / relative).read_bytes(),
                        (self.source / relative).read_bytes(),
                    )

    def test_invalid_stage_fails_before_copying(self):
        self.configure("answer")
        destination = self.root / "public"
        with self.assertRaisesRegex(ValueError, "Release stage"):
            stage_site(self.source, destination)
        self.assertFalse(destination.exists())

    def test_missing_released_file_fails_before_copying(self):
        self.configure("answers")
        (self.source / SOLUTIONS / ANSWER_FILE).unlink()
        destination = self.root / "public"
        with self.assertRaisesRegex(ValueError, "Missing required release file"):
            stage_site(self.source, destination)
        self.assertFalse(destination.exists())

    def test_rejects_stale_output_from_another_stage(self):
        self.configure("answers")
        destination = self.root / "public"
        stage_site(self.source, destination)
        self.configure("exercise")
        with self.assertRaisesRegex(ValueError, "new or empty"):
            stage_site(self.source, destination)

    def test_rejects_destination_inside_source(self):
        self.configure("exercise")
        with self.assertRaisesRegex(ValueError, "outside the source tree"):
            stage_site(self.source, self.source / "public")


if __name__ == "__main__":
    unittest.main()
