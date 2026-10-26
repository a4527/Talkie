"""직접 듣고 정한 점수를 기록한다. 내용 없는 점수만 남긴다 (DEC-040).

    uv run python -m voice_eval.rate baseline --recognition 4 --naturalness 3 --voice 4 --latency 3 --interrupt 2

점수는 1(나쁨)~5(좋음). 메모에는 발화 내용·개인정보를 적지 않는다. 기록은 7일 후 삭제된다.
"""

from __future__ import annotations

import argparse

from voice_eval import results
from voice_eval.config import ConfigError, load_matrix

SCORES = ("recognition", "naturalness", "voice", "latency", "interrupt", "korean")
HELP = {
    "recognition": "내 말을 알아듣는가 (영어, 한국인 억양)",
    "naturalness": "AI의 말투와 교정이 자연스러운가",
    "voice": "음성 품질",
    "latency": "체감 지연 (빠를수록 높게)",
    "interrupt": "끼어들기 (말을 끊었을 때 바로 멈추고 이어지는가)",
    "korean": "한국어로 말하거나 설명받을 때 (해당될 때만)",
}


def _score(value: str) -> int:
    number = int(value)
    if not 1 <= number <= 5:
        raise argparse.ArgumentTypeError("점수는 1~5")
    return number


def main() -> None:
    parser = argparse.ArgumentParser(description="청취 평가 점수 기록")
    parser.add_argument("config_id")
    for name in SCORES:
        parser.add_argument(f"--{name}", type=_score, help=HELP[name])
    parser.add_argument("--memo", default="", help="한 줄 메모. 발화 내용과 개인정보는 적지 않는다")
    args = parser.parse_args()

    try:
        load_matrix().get(args.config_id)
    except ConfigError as error:
        raise SystemExit(f"구성 오류: {error}") from None

    scores = {name: getattr(args, name) for name in SCORES if getattr(args, name) is not None}
    if not scores:
        raise SystemExit("점수를 하나 이상 입력한다")
    results.prune()
    results.append({"type": "rating", "config_id": args.config_id, "scores": scores, "memo": args.memo[:200]})
    print(f"{args.config_id}: {scores} 기록했다")


if __name__ == "__main__":
    main()
