"""Pipecat 개발 러너 진입점.

    uv run bot.py --config baseline            # 브라우저 화면: http://localhost:7860/client
    uv run bot.py --config baseline --check    # 키 존재·예상 최대 비용·남은 한도만 확인하고 종료
    uv run bot.py --list                       # 구성 목록(비용이 낮은 순)

`--config`는 Pipecat 러너 인자와 함께 쓴다. 나머지 인자(--port, --host 등)는 Pipecat 러너가 처리한다.
"""

from __future__ import annotations

import argparse
import math
import os
import sys

from dotenv import load_dotenv
from loguru import logger

load_dotenv(override=True)

from voice_eval import results  # noqa: E402
from voice_eval.config import (  # noqa: E402
    VENDOR_POLICY,
    ConfigError,
    Matrix,
    SessionConfig,
    acknowledged_vendors,
    load_matrix,
)
from voice_eval.ledger import LedgerError, open_ledger  # noqa: E402
from voice_eval.pricing import PricingError, max_session_usd  # noqa: E402
from voice_eval.session import run_session  # noqa: E402

CONFIG_ENV = "VOICE_EVAL_CONFIG"
ACK_ENV = "VOICE_EVAL_ACK"


def _configure_logging() -> None:
    """발화·전사 내용이 로그에 남지 않도록 우리 모듈만 INFO, 나머지(Pipecat 등)는 WARNING 이상만 출력한다."""
    logger.remove()

    def only_own_info(record) -> bool:
        own = record["name"] in ("__main__", "bot") or record["name"].startswith("voice_eval")
        return record["level"].no >= (20 if own else 30)

    logger.add(sys.stderr, level="DEBUG", filter=only_own_info, format="{time:HH:mm:ss} | {level: <7} | {message}")


def _unacknowledged(cfg: SessionConfig) -> list[str]:
    return cfg.unacknowledged_vendors(acknowledged_vendors(os.environ.get(ACK_ENV)))


def _selected() -> tuple[Matrix, SessionConfig]:
    matrix = load_matrix()
    config_id = os.environ.get(CONFIG_ENV, "").strip() or matrix.baseline
    return matrix, matrix.get(config_id)


def check(matrix: Matrix, cfg: SessionConfig) -> int:
    """키 값은 출력하지 않고 존재 여부와 예상 비용만 보여 준다."""
    print(f"구성: {cfg.id} ({cfg.kind}) - {cfg.description}")
    for slot, comp in cfg.components().items():
        model = f" / {comp.model}" if comp.model else ""
        print(f"  {slot}: {comp.provider}{model}")
    ok = True
    for name in cfg.required_env_vars():
        present = bool(os.environ.get(name, "").strip())
        ok = ok and present
        print(f"  키 {name}: {'있음' if present else '없음'}")
    blocked = _unacknowledged(cfg)
    for vendor in cfg.vendors():
        status, note = VENDOR_POLICY[vendor]
        mark = "확인됨" if status == "confirmed" else ("조건부" if status == "conditional" else "미확인")
        print(f"  학습 정책 {vendor}: {mark} - {note}")
    if blocked:
        ok = False
        print(f"  직접 확인 후 .env의 {ACK_ENV}에 추가해야 시작한다: {', '.join(blocked)}")
    try:
        estimate = max_session_usd(cfg, matrix.safety_factor)
    except PricingError as error:
        print(f"  단가표 오류: {error}")
        return 1
    krw = max(1, math.ceil(estimate.total_usd * matrix.krw_per_usd))
    ledger = open_ledger()
    print(f"  세션 상한 {cfg.session_seconds}초 최대 비용(안전계수 {matrix.safety_factor}): ${estimate.total_usd:.3f} (약 {krw}원)")
    for note in estimate.notes:
        print(f"  주의: {note}")
    print(f"  집행·예약 {ledger.committed_krw()}원, 1라운드 한도 {ledger.round_cap_krw}원, 남음 {ledger.remaining_krw()}원")
    if krw > ledger.remaining_krw():
        print("  남은 한도가 부족해 이 구성은 시작하지 않는다")
        return 1
    return 0 if ok else 1


async def run_bot(transport, runner_args) -> None:
    matrix, cfg = _selected()
    blocked = _unacknowledged(cfg)
    if blocked:
        # DEC-052: 학습 금지를 확인하지 않은 업체에는 음성을 보내지 않는다.
        logger.error(f"시작하지 않는다. 학습 정책을 직접 확인한 뒤 {ACK_ENV}에 추가: {', '.join(blocked)}")
        return
    ledger = open_ledger()
    try:
        await run_session(transport, runner_args, cfg, matrix, ledger)
    except LedgerError:
        # 한도 초과는 이미 로그로 남겼다. 호출 없이 종료한다.
        return


async def bot(runner_args) -> None:
    """Pipecat 러너가 세션마다 호출한다."""
    from pipecat.runner.utils import create_transport
    from pipecat.transports.base_transport import TransportParams

    transport_params = {
        "webrtc": lambda: TransportParams(audio_in_enabled=True, audio_out_enabled=True),
    }
    transport = await create_transport(runner_args, transport_params)
    await run_bot(transport, runner_args)


def _cli() -> None:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--config", default=None)
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--check", action="store_true")
    own, rest = parser.parse_known_args()

    try:
        matrix = load_matrix()
        if own.list:
            for config_id in matrix.order:
                cfg = matrix.get(config_id)
                print(f"{config_id:<20} {cfg.kind:<9} {cfg.description}")
            return
        if own.config:
            matrix.get(own.config)  # 존재 확인
            os.environ[CONFIG_ENV] = own.config
        matrix, cfg = _selected()
    except ConfigError as error:
        print(f"구성 오류: {error}", file=sys.stderr)
        raise SystemExit(2) from None

    _configure_logging()
    removed = results.prune()
    if removed:
        logger.info(f"7일이 지난 시험 기록 {removed}줄을 삭제했다")

    if own.check:
        raise SystemExit(check(matrix, cfg))

    logger.info(f"구성 '{cfg.id}'로 시작한다. 브라우저에서 http://localhost:7860/client 를 연다")
    sys.argv = [sys.argv[0], *rest]
    from pipecat.runner.run import main

    main()


if __name__ == "__main__":
    _cli()
