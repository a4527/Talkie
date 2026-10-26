"""시험 결과 기록. 발화 내용·음성·전사문은 저장하지 않고 점수·지연·사용량·비용만 남긴다 (DEC-040).

기록은 `.local/eval/results.jsonl`에 두며 진단 로그와 같은 7일 수명을 적용한다 (DEC-037).
시작 시 오래된 기록을 삭제한다. 예산 장부(ledger)는 별도이며 이 정리 대상이 아니다.
"""

from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from voice_eval.paths import RESULTS_PATH, ensure_eval_dir

RETENTION_DAYS = 7


def _now() -> datetime:
    return datetime.now(timezone.utc)


def append(record: dict[str, Any], path: Path = RESULTS_PATH) -> None:
    """한 줄 JSON을 추가한다. 호출 전에 내용(발화·전사)이 섞이지 않았는지는 호출자가 책임진다."""
    ensure_eval_dir()
    line = json.dumps({"ts": _now().isoformat(timespec="seconds"), **record}, ensure_ascii=False)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    with os.fdopen(fd, "a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def read_all(path: Path = RESULTS_PATH) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    records: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            records.append(json.loads(line))
    return records


def prune(days: int = RETENTION_DAYS, path: Path = RESULTS_PATH, now: datetime | None = None) -> int:
    """기록 시각부터 `days`일이 지난 줄을 삭제하고 삭제한 줄 수를 돌려준다."""
    if not path.exists():
        return 0
    cutoff = (now or _now()) - timedelta(days=days)
    kept: list[str] = []
    removed = 0
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            ts = datetime.fromisoformat(json.loads(line)["ts"])
        except (ValueError, KeyError, json.JSONDecodeError):
            removed += 1  # 읽을 수 없는 줄도 남기지 않는다
            continue
        if ts >= cutoff:
            kept.append(line)
        else:
            removed += 1
    if removed:
        fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".results-")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write("".join(item + "\n" for item in kept))
            os.chmod(tmp, 0o600)
            os.replace(tmp, path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise
    return removed
