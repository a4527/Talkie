import json
import stat
from datetime import datetime, timedelta, timezone

import pytest

from voice_eval import results
from voice_eval.ledger import Ledger, LedgerError


def test_reserve_within_cap_and_block_over_cap(tmp_path):
    ledger = Ledger(tmp_path / "ledger.json", round_cap_krw=1000, total_cap_krw=30000)
    first = ledger.reserve("baseline", 600)
    assert first == 1
    assert ledger.spent_krw() == 600
    with pytest.raises(LedgerError):
        ledger.reserve("llm-openai", 500)
    assert ledger.spent_krw() == 600  # 거절된 예약은 장부에 남지 않는다


def test_total_cap_applies_even_if_round_cap_is_larger(tmp_path):
    ledger = Ledger(tmp_path / "ledger.json", round_cap_krw=50000, total_cap_krw=1000)
    ledger.reserve("a", 900)
    with pytest.raises(LedgerError):
        ledger.reserve("b", 200)


def test_settle_replaces_reservation_with_actual(tmp_path):
    ledger = Ledger(tmp_path / "ledger.json", round_cap_krw=1000)
    entry = ledger.reserve("baseline", 800)
    ledger.settle(entry, 120)
    assert ledger.spent_krw() == 120
    assert Ledger(tmp_path / "ledger.json", round_cap_krw=1000).spent_krw() == 120  # 다시 읽어도 유지


def test_ledger_file_is_private_and_has_no_content_fields(tmp_path):
    path = tmp_path / "ledger.json"
    Ledger(path, round_cap_krw=1000).reserve("baseline", 100)
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    keys = set(json.loads(path.read_text())["entries"][0])
    assert keys == {"id", "ts", "config_id", "reserved_krw", "status", "actual_krw"}


def test_zero_or_negative_reservation_rejected(tmp_path):
    with pytest.raises(LedgerError):
        Ledger(tmp_path / "ledger.json").reserve("x", 0)


def test_results_prune_removes_only_expired_lines(tmp_path):
    path = tmp_path / "results.jsonl"
    now = datetime(2026, 10, 26, tzinfo=timezone.utc)
    old = (now - timedelta(days=8)).isoformat()
    fresh = (now - timedelta(days=6)).isoformat()
    path.write_text(
        json.dumps({"ts": old, "type": "session"}) + "\n"
        + json.dumps({"ts": fresh, "type": "session"}) + "\n"
        + "not json\n",
        encoding="utf-8",
    )
    removed = results.prune(7, path=path, now=now)
    assert removed == 2  # 8일 지난 줄과 읽을 수 없는 줄
    remaining = results.read_all(path)
    assert [r["ts"] for r in remaining] == [fresh]
