"""하니스가 읽고 쓰는 경로. 결과와 장부는 Git에서 제외된 `.local/eval/`에만 둔다."""

from pathlib import Path

HARNESS_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = HARNESS_DIR.parents[1]
EVAL_DIR = REPO_ROOT / ".local" / "eval"
MATRIX_PATH = HARNESS_DIR / "configs" / "matrix.yaml"
LEDGER_PATH = EVAL_DIR / "ledger.json"
RESULTS_PATH = EVAL_DIR / "results.jsonl"


def ensure_eval_dir() -> Path:
    """결과 폴더를 본인만 읽을 수 있게 만든다."""
    EVAL_DIR.mkdir(parents=True, exist_ok=True)
    EVAL_DIR.chmod(0o700)
    return EVAL_DIR
