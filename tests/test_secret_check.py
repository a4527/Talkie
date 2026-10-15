import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts.check_secrets import scan


class SecretCheckTests(unittest.TestCase):
    def test_sensitive_paths_and_content(self):
        self.assertIn("sensitive filename", scan(".env", b""))
        self.assertIn("sensitive filename", scan("config/id_ed25519", b""))
        self.assertIn("private key", scan("notes.txt", b"-----BEGIN " + b"PRIVATE KEY-----"))
        self.assertIn("credential assignment", scan("app.py", b'API_KEY = "realcredential123"'))
        self.assertIn("credential assignment", scan("app.js", b'const API_KEY = "realcredential123"'))
        self.assertEqual([], scan(".env.example", b"API_KEY=your_api_key"))
        self.assertEqual([], scan("app.py", b'API_KEY = os.getenv("API_KEY")'))

    def test_staged_content_is_checked(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            (root / "safe.txt").write_text("ordinary text\n")
            subprocess.run(["git", "add", "safe.txt"], cwd=root, check=True)
            script = Path(__file__).resolve().parents[1] / "scripts/check_secrets.py"
            passed = subprocess.run(["python3", str(script)], cwd=root, capture_output=True)
            self.assertEqual(0, passed.returncode, passed.stderr)

            (root / ".env").write_text("API_KEY=realcredential123\n")
            subprocess.run(["git", "add", "-f", ".env"], cwd=root, check=True)
            blocked = subprocess.run(["python3", str(script)], cwd=root, capture_output=True)
            self.assertEqual(1, blocked.returncode)
            self.assertIn(b".env: sensitive filename", blocked.stderr)

            subprocess.run(["git", "rm", "--cached", "-q", ".env"], cwd=root, check=True)
            (root / "config.js").write_text('const API_KEY = "realcredential123";\n')
            subprocess.run(["git", "add", "config.js"], cwd=root, check=True)
            blocked_code = subprocess.run(["python3", str(script)], cwd=root, capture_output=True)
            self.assertEqual(1, blocked_code.returncode)
            self.assertIn(b"config.js: credential assignment", blocked_code.stderr)


if __name__ == "__main__":
    unittest.main()
