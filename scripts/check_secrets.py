#!/usr/bin/env python3
"""Reject staged secret files and recognizable credentials before commit."""

import re
import subprocess
import sys
from pathlib import PurePosixPath


BLOCKED_NAMES = {
    "id_rsa", "id_ed25519", "id_ecdsa", "id_dsa",
    "credentials", "credentials.json", "secrets.json", ".npmrc", ".pypirc",
}
BLOCKED_SUFFIXES = {".pem", ".key", ".p12", ".pfx", ".jks", ".keystore", ".tfvars"}
SECRET_PATTERNS = {
    "private key": re.compile(rb"-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----"),
    "AWS access key": re.compile(rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    "GitHub token": re.compile(rb"\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b"),
    "OpenAI key": re.compile(rb"\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b"),
    "Google API key": re.compile(rb"\bAIza[A-Za-z0-9_-]{35}\b"),
    "Slack token": re.compile(rb"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"),
}
ASSIGNMENT = re.compile(
    rb"(?im)^\s*(?:(?:export|const|let|var)\s+)?(?:[A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*|"
    rb"[\"'][A-Za-z0-9_]*(?:api[_-]?key|secret|token|password|private[_-]?key|access[_-]?key)[A-Za-z0-9_]*[\"'])"
    rb"\s*[:=]\s*[\"']?([^\s\"',#;}]+)"
)
PLACEHOLDERS = (b"example", b"sample", b"placeholder", b"your_", b"your-", b"replace", b"changeme", b"dummy", b"test")
REFERENCES = (b"os.getenv", b"os.environ", b"process.env", b"import.meta.env", b"getenv(")


def git(*args: str) -> bytes:
    return subprocess.check_output(("git", *args), stderr=subprocess.PIPE)


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


def scan(path: str, data: bytes) -> list[str]:
    findings = []
    if blocked_path(path):
        findings.append("sensitive filename")
    if b"\0" in data[:8192]:
        return findings
    for label, pattern in SECRET_PATTERNS.items():
        if pattern.search(data):
            findings.append(label)
    for match in ASSIGNMENT.finditer(data):
        value = match.group(1).lower()
        if (
            len(value) >= 8
            and not any(value.startswith(p) for p in PLACEHOLDERS + REFERENCES)
            and not re.match(rb"[a-z_][a-z0-9_]*\(", value)
        ):
            findings.append("credential assignment")
            break
    return findings


def main() -> int:
    paths = git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z")
    failures = []
    for raw_path in filter(None, paths.split(b"\0")):
        path = raw_path.decode("utf-8", "surrogateescape")
        data = git("show", f":{path}")
        for finding in scan(path, data):
            failures.append((path, finding))
    if failures:
        print("Commit blocked: inspect these staged files before committing:", file=sys.stderr)
        for path, finding in failures:
            print(f"  {path}: {finding}", file=sys.stderr)
        print("Remove the secret from the staged content; rotate any exposed credential.", file=sys.stderr)
        return 1
    print("Staged secret check passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
