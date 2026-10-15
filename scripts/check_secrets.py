#!/usr/bin/env python3
"""Reject sensitive filenames in the Git index; Gitleaks scans their content."""

import subprocess
import sys
from pathlib import PurePosixPath


BLOCKED_NAMES = {
    "id_rsa", "id_ed25519", "id_ecdsa", "id_dsa",
    "credentials", "credentials.json", "secrets.json", ".npmrc", ".pypirc",
}
BLOCKED_SUFFIXES = {".pem", ".key", ".p12", ".pfx", ".jks", ".keystore", ".tfvars"}


def blocked_path(path: str) -> bool:
    name = PurePosixPath(path).name.lower()
    if name == ".env.example" or (name.startswith(".env.") and name.endswith(".example")):
        return False
    return (
        name == ".env" or name.startswith(".env.")
        or name in BLOCKED_NAMES or name.endswith("service-account.json")
        or ("credential" in name and name.endswith(".json"))
        or PurePosixPath(name).suffix in BLOCKED_SUFFIXES
    )


def main() -> int:
    if len(sys.argv) > 2 or (len(sys.argv) == 2 and sys.argv[1] != "--tracked"):
        print("Usage: check_secrets.py [--tracked]", file=sys.stderr)
        return 2
    tracked = len(sys.argv) == 2
    command = ("git", "ls-files", "--cached", "-z") if tracked else (
        "git", "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"
    )
    paths = subprocess.check_output(
        command,
        stderr=subprocess.PIPE,
    )
    failures = []
    for raw in filter(None, paths.split(b"\0")):
        path = raw.decode("utf-8", "surrogateescape")
        if blocked_path(path):
            failures.append(path)
    if failures:
        print("Commit blocked: sensitive filename staged:", file=sys.stderr)
        for path in failures:
            print(f"  {path}", file=sys.stderr)
        return 1
    print("Tracked filename check passed." if tracked else "Staged filename check passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
