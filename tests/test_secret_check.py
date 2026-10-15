import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts.check_secrets import blocked_path


class SecretCheckTests(unittest.TestCase):
    def test_sensitive_paths(self):
        self.assertTrue(blocked_path(".env"))
        self.assertTrue(blocked_path("config/id_ed25519"))
        self.assertTrue(blocked_path("config/service-account.json"))
        self.assertFalse(blocked_path(".env.example"))
        self.assertFalse(blocked_path("app.py"))

    def test_staged_sensitive_path_is_blocked(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            (root / "safe.txt").write_text("ordinary text\n")
            subprocess.run(["git", "add", "safe.txt"], cwd=root, check=True)
            script = Path(__file__).resolve().parents[1] / "scripts/check_secrets.py"
            passed = subprocess.run(["python3", str(script)], cwd=root, capture_output=True)
            self.assertEqual(0, passed.returncode, passed.stderr)

            (root / ".env").write_text("local data\n")
            subprocess.run(["git", "add", "-f", ".env"], cwd=root, check=True)
            blocked = subprocess.run(["python3", str(script)], cwd=root, capture_output=True)
            self.assertEqual(1, blocked.returncode)
            self.assertIn(b".env", blocked.stderr)
            tracked = subprocess.run(["python3", str(script), "--tracked"], cwd=root, capture_output=True)
            self.assertEqual(1, tracked.returncode)


if __name__ == "__main__":
    unittest.main()
