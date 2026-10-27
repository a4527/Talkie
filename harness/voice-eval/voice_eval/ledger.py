"""예산 장부. 호출 전에 최대 비용을 예약하고 한도를 넘으면 시작하지 않는다 (DEC-016).

내용 없는 금액 기록만 남기며 날짜로 초기화하지 않는다(총 한도는 최초 비교 전체에 적용).
실제 청구액은 공급자 콘솔에서 확인해 `settle`로 맞춘다.

    uv run python -m voice_eval.ledger show
    uv run python -m voice_eval.ledger settle <entry_id> <실제 원화 금액>
"""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

from voice_eval.config import load_matrix
from voice_eval.paths import LEDGER_PATH, ensure_eval_dir


class LedgerError(Exception):
    """한도를 넘거나 장부가 잘못되었을 때."""


@dataclass
class LedgerEntry:
    entry_id: int
    reserved_at: str
    config_id: str
    reserved_krw: int
    status: str  # "reserved" | "settled"
    actual_krw: int | None = None

    @property
    def counted_krw(self) -> int:
        return self.actual_krw if self.status == "settled" and self.actual_krw is not None else self.reserved_krw


class Ledger:
    def __init__(self, path: Path = LEDGER_PATH, round_cap_krw: int = 5000, total_cap_krw: int = 30000):
        self.path = path
        self.round_cap_krw = round_cap_krw
        self.total_cap_krw = total_cap_krw
        self.entries: list[LedgerEntry] = self._load()

    def _load(self) -> list[LedgerEntry]:
        if not self.path.exists():
            return []
        raw = json.loads(self.path.read_text(encoding="utf-8"))
        entries = []
        for item in raw.get("entries", []):
            item = dict(item)
            if "entry_id" not in item:
                item["entry_id"] = item.pop("id")
            if "reserved_at" not in item:
                item["reserved_at"] = item.pop("ts")
            entries.append(LedgerEntry(**item))
        return entries

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps({"entries": [asdict(e) for e in self.entries]}, ensure_ascii=False, indent=2)
        fd, tmp = tempfile.mkstemp(dir=self.path.parent, prefix=".ledger-")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(payload)
            os.chmod(tmp, 0o600)
            os.replace(tmp, self.path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise

    def committed_krw(self) -> int:
        return sum(e.counted_krw for e in self.entries)

    def remaining_krw(self) -> int:
        return min(self.round_cap_krw, self.total_cap_krw) - self.committed_krw()

    def reserve(self, config_id: str, krw: int) -> int:
        """최대 비용을 예약한다. 라운드 한도나 총 한도를 넘으면 예약하지 않고 예외를 던진다."""
        if krw <= 0:
            raise LedgerError("예약 금액은 0보다 커야 한다")
        committed = self.committed_krw()
        if committed + krw > self.round_cap_krw:
            raise LedgerError(
                f"1라운드 한도 초과: 집행·예약 {committed}원 + 이번 최대 {krw}원 > {self.round_cap_krw}원"
            )
        if committed + krw > self.total_cap_krw:
            raise LedgerError(
                f"총 한도 초과: 집행·예약 {committed}원 + 이번 최대 {krw}원 > {self.total_cap_krw}원"
            )
        entry = LedgerEntry(
            entry_id=max((e.entry_id for e in self.entries), default=0) + 1,
            reserved_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            config_id=config_id,
            reserved_krw=krw,
            status="reserved",
        )
        self.entries.append(entry)
        self._save()
        return entry.entry_id

    def settle(self, entry_id: int, actual_krw: int) -> None:
        for entry in self.entries:
            if entry.entry_id == entry_id:
                entry.status = "settled"
                entry.actual_krw = actual_krw
                self._save()
                return
        raise LedgerError(f"장부에 항목 {entry_id}가 없다")


def open_ledger() -> Ledger:
    import os as _os

    matrix = load_matrix()
    override = _os.environ.get("VOICE_EVAL_SPEND_CAP_KRW", "").strip()
    round_cap = int(override) if override else matrix.round_cap_krw
    ensure_eval_dir()
    return Ledger(round_cap_krw=round_cap, total_cap_krw=matrix.total_cap_krw)


def _main() -> None:
    parser = argparse.ArgumentParser(description="시험 예산 장부")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("show", help="집행·예약 내역과 남은 한도")
    settle = sub.add_parser("settle", help="실제 청구액으로 항목을 확정")
    settle.add_argument("entry_id", type=int)
    settle.add_argument("actual_krw", type=int)
    args = parser.parse_args()

    ledger = open_ledger()
    if args.command == "show":
        for entry in ledger.entries:
            actual = "-" if entry.actual_krw is None else f"{entry.actual_krw}원"
            print(f"#{entry.entry_id} {entry.reserved_at} {entry.config_id:<20} 예약 {entry.reserved_krw:>6}원 {entry.status:<8} 실제 {actual}")
        print(f"집행·예약 합계 {ledger.committed_krw()}원 / 1라운드 한도 {ledger.round_cap_krw}원 / 총 한도 {ledger.total_cap_krw}원 (남음 {ledger.remaining_krw()}원)")
    else:
        ledger.settle(args.entry_id, args.actual_krw)
        print(f"항목 {args.entry_id}를 {args.actual_krw}원으로 확정했다. 합계 {ledger.committed_krw()}원")


if __name__ == "__main__":
    _main()
