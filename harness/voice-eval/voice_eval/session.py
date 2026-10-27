"""한 번의 시험 세션: 비용 예약 → 파이프라인 구성 → 실행 → 내용 없는 결과 기록.

발화 내용과 전사문은 기록하지 않는다. 로그에도 남기지 않도록 Pipecat 기본 로그 레벨을 낮춘다.
"""

from __future__ import annotations

import asyncio
import math
import statistics
import time
import uuid
from typing import Any

from loguru import logger

from voice_eval import results
from voice_eval.config import Matrix, SessionConfig
from voice_eval.ledger import Ledger, LedgerError
from voice_eval.pricing import max_session_usd
from voice_eval.prompts import KICKOFF, SYSTEM_PROMPT
from voice_eval.services import build_llm, build_realtime, build_stt, build_tts


def _summarize(values: list[float]) -> dict[str, float | int] | None:
    if not values:
        return None
    ordered = sorted(values)
    return {
        "count": len(ordered),
        "mean_s": round(statistics.fmean(ordered), 3),
        "p50_s": round(statistics.median(ordered), 3),
        "max_s": round(ordered[-1], 3),
    }


def reserve_for(cfg: SessionConfig, matrix: Matrix, ledger: Ledger) -> tuple[int, int]:
    """세션 최대 비용을 계산해 장부에 예약한다. (항목 ID, 예약 원화)를 돌려준다."""
    estimate = max_session_usd(cfg, matrix.safety_factor)
    krw = max(1, math.ceil(estimate.total_usd * matrix.krw_per_usd))
    return ledger.reserve(cfg.id, krw), krw


async def run_session(transport: Any, runner_args: Any, cfg: SessionConfig, matrix: Matrix, ledger: Ledger) -> None:
    from pipecat.audio.vad.silero import SileroVADAnalyzer
    from pipecat.frames.frames import LLMRunFrame, MetricsFrame
    from pipecat.metrics.metrics import LLMUsageMetricsData, STTUsageMetricsData, TTSUsageMetricsData
    from pipecat.observers.base_observer import BaseObserver, FramePushed
    from pipecat.observers.user_bot_latency_observer import UserBotLatencyObserver
    from pipecat.pipeline.pipeline import Pipeline
    from pipecat.pipeline.worker import PipelineParams, PipelineWorker
    from pipecat.processors.aggregators.llm_context import LLMContext
    from pipecat.processors.aggregators.llm_response_universal import (
        LLMContextAggregatorPair,
        LLMUserAggregatorParams,
    )
    from pipecat.workers.runner import WorkerRunner

    try:
        entry_id, reserved_krw = reserve_for(cfg, matrix, ledger)
    except LedgerError as error:
        logger.error(f"세션을 시작하지 않는다: {error}")
        raise

    session_id = uuid.uuid4().hex[:8]
    logger.info(f"[{cfg.id}] 세션 {session_id} 시작, 장부 항목 #{entry_id}, 예약 {reserved_krw}원, 최대 {cfg.session_seconds}초")

    class UsageObserver(BaseObserver):
        """MetricsFrame의 사용량만 합산한다. 내용은 보지 않는다."""

        def __init__(self) -> None:
            super().__init__(observe_every_push=False)
            self.llm_prompt = 0
            self.llm_completion = 0
            self.llm_cached = 0
            self.tts_chars = 0
            self.stt_seconds = 0.0

        async def on_push_frame(self, data: FramePushed) -> None:
            frame = data.frame
            if not isinstance(frame, MetricsFrame):
                return
            for item in frame.data:
                if isinstance(item, LLMUsageMetricsData):
                    self.llm_prompt += item.value.prompt_tokens or 0
                    self.llm_completion += item.value.completion_tokens or 0
                    self.llm_cached += item.value.cache_read_input_tokens or 0
                elif isinstance(item, TTSUsageMetricsData):
                    self.tts_chars += item.value or 0
                elif isinstance(item, STTUsageMetricsData):
                    self.stt_seconds += getattr(item.value, "audio_seconds", 0.0) or 0.0

    if cfg.kind == "cascade":
        assert cfg.stt and cfg.llm and cfg.tts
        stt = build_stt(cfg.stt)
        llm = build_llm(cfg.llm)
        tts = build_tts(cfg.tts)
    else:
        assert cfg.realtime
        llm = build_realtime(cfg.realtime)

    context = LLMContext()
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer()),
    )
    if cfg.kind == "cascade":
        stages = [transport.input(), stt, user_aggregator, llm, tts, transport.output(), assistant_aggregator]
    else:
        stages = [transport.input(), user_aggregator, llm, transport.output(), assistant_aggregator]

    latency_observer = UserBotLatencyObserver()
    usage = UsageObserver()
    latencies: list[float] = []

    @latency_observer.event_handler("on_latency_measured")
    async def on_latency_measured(_observer: Any, latency_seconds: float) -> None:
        latencies.append(float(latency_seconds))

    worker = PipelineWorker(
        Pipeline(stages),
        params=PipelineParams(enable_metrics=True, enable_usage_metrics=True),
        observers=[latency_observer, usage],
    )
    runner = WorkerRunner(handle_sigint=runner_args.handle_sigint)
    await runner.add_workers(worker)

    started = {"at": 0.0}
    cap_task: dict[str, asyncio.Task[None]] = {}

    async def stop_after_cap() -> None:
        await asyncio.sleep(cfg.session_seconds)
        logger.warning(f"[{cfg.id}] 세션 상한 {cfg.session_seconds}초에 도달해 종료한다")
        await runner.cancel()

    @transport.event_handler("on_client_connected")
    async def on_client_connected(_transport: Any, _client: Any) -> None:
        started["at"] = time.monotonic()
        cap_task["task"] = asyncio.create_task(stop_after_cap())
        context.add_message({"role": "developer", "content": KICKOFF})
        await worker.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(_transport: Any, _client: Any) -> None:
        await runner.cancel()

    try:
        await runner.run()
    finally:
        task = cap_task.get("task")
        if task:
            task.cancel()
        duration = round(time.monotonic() - started["at"], 1) if started["at"] else 0.0
        results.append(
            {
                "type": "session",
                "config_id": cfg.id,
                "session_id": session_id,
                "ledger_entry_id": entry_id,
                "duration_s": duration,
                "reserved_krw": reserved_krw,
                "latency": _summarize(latencies),
                "usage": {
                    "llm_prompt_tokens": usage.llm_prompt,
                    "llm_completion_tokens": usage.llm_completion,
                    "llm_cached_tokens": usage.llm_cached,
                    "tts_characters": usage.tts_chars,
                    "stt_audio_seconds": round(usage.stt_seconds, 1),
                },
            }
        )
        logger.info(f"[{cfg.id}] 세션 {session_id} 종료, {duration}초, 지연 {_summarize(latencies)}")


__all__ = ["run_session", "reserve_for", "SYSTEM_PROMPT"]
