"""기록된 시험 결과를 구성별로 한 표로 보여 준다. 비용은 예약액이며 실제 청구액은 ledger settle로 맞춘다.

    uv run python -m voice_eval.report
"""

from __future__ import annotations

import statistics
from collections import defaultdict
from typing import Any

from voice_eval import results
from voice_eval.config import load_matrix
from voice_eval.ledger import open_ledger


def main() -> None:
    matrix = load_matrix()
    records = results.read_all()
    sessions: dict[str, list[dict[str, Any]]] = defaultdict(list)
    ratings: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        target = sessions if record.get("type") == "session" else ratings if record.get("type") == "rating" else None
        if target is not None:
            target[record["config_id"]].append(record)

    header = f"{'구성':<20}{'세션':>4}{'평균 지연(s)':>13}{'예약(원)':>9}  점수 평균"
    print(header)
    print("-" * len(header))
    for config_id in matrix.order:
        runs = sessions.get(config_id, [])
        lats = [r["latency"]["mean_s"] for r in runs if r.get("latency")]
        reserved = sum(r.get("reserved_krw", 0) for r in runs)
        rated = ratings.get(config_id, [])
        score_text = "-"
        if rated:
            merged: dict[str, list[int]] = defaultdict(list)
            for item in rated:
                for name, value in item["scores"].items():
                    merged[name].append(value)
            score_text = " ".join(f"{name}={statistics.fmean(values):.1f}" for name, values in merged.items())
        mean_lat = f"{statistics.fmean(lats):.2f}" if lats else "-"
        print(f"{config_id:<20}{len(runs):>4}{mean_lat:>13}{reserved:>9}  {score_text}")
    ledger = open_ledger()
    print(f"\n장부: 집행·예약 {ledger.committed_krw()}원 / 1라운드 한도 {ledger.round_cap_krw}원 / 총 한도 {ledger.total_cap_krw}원")


if __name__ == "__main__":
    main()
