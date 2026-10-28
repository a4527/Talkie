"""호출 전 최대 비용 예약에 쓰는 단가표와 계산식 (USD).

실측이 아니라 보수적 가정이다. 단가 출처와 신뢰도는 PRICES의 source에 남긴다.
공급자 가격은 자주 바뀌므로 호출 전에 공식 가격 페이지로 다시 확인한다.
계획 초안: docs/proposals/AI-CANDIDATE-EVALUATION-PLAN.md
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date

from voice_eval.config import Component, SessionConfig

# 한 세션을 보수적으로 가정하는 값
TURN_SECONDS = 30  # 한 턴(사용자 발화 + AI 발화 + 여유)
AI_SPEECH_FRACTION = 0.6  # 세션 시간 중 AI가 말하는 비율의 상한
CHARS_PER_AI_SECOND = 15  # 분당 900자
LLM_SYSTEM_TOKENS = 500
LLM_USER_TOKENS_PER_TURN = 100
LLM_HISTORY_TOKENS_PER_TURN = 150
LLM_OUTPUT_TOKENS_PER_TURN = 120

# 실시간 모델 오디오 토큰 환산(OpenAI 공식 비용 문서): 사용자 1토큰/100ms, AI 1토큰/50ms
OPENAI_USER_AUDIO_TOKENS_PER_TURN = 90  # 턴당 사용자 9초
OPENAI_AI_AUDIO_TOKENS_PER_TURN = 300  # 턴당 AI 15초

GEMINI_TTS_PRICE_CHANGE = date(2027, 1, 1)


@dataclass(frozen=True)
class Price:
    value: float
    source: str


# 음성 인식: USD / 분
STT_PER_MINUTE: dict[tuple[str, str], Price] = {
    ("soniox", "default"): Price(0.002, "soniox.com 한국어 페이지 $0.12/시간(벤더 페이지)"),
    ("deepgram", "nova-3"): Price(0.0077, "2차 자료 스트리밍 $0.0077/분. 공식 확인 필요"),
    ("openai", "gpt-4o-transcribe"): Price(0.006, "OpenAI 공식 가격 페이지"),
    ("openai", "gpt-4o-mini-transcribe"): Price(0.003, "OpenAI 공식 가격 페이지"),
    ("openai", "gpt-transcribe"): Price(0.0045, "OpenAI 공식 가격 페이지"),
}

# 텍스트 모델: (입력, 출력) USD / 1M 토큰
LLM_PER_MILLION: dict[tuple[str, str], tuple[Price, Price]] = {
    ("anthropic", "claude-haiku-5-5"): (
        Price(0.10, "Anthropic 가격표(2026-10-06 캐시), 100K 이하 프롬프트"),
        Price(0.50, "Anthropic 가격표(2026-10-06 캐시), 100K 이하 프롬프트"),
    ),
    ("google", "gemini-3.5-flash-lite"): (
        Price(0.30, "Gemini API 공식 가격"),
        Price(2.50, "Gemini API 공식 가격"),
    ),
    ("google", "gemini-3.1-flash-lite"): (
        Price(0.25, "Gemini API 공식 가격"),
        Price(1.50, "Gemini API 공식 가격"),
    ),
    ("openai", "gpt-6-luna"): (
        Price(0.10, "OpenAI 공식 가격 페이지"),
        Price(0.50, "OpenAI 공식 가격 페이지"),
    ),
    ("openai", "gpt-5.6-luna"): (
        Price(0.20, "OpenAI 공식 가격 페이지"),
        Price(1.20, "OpenAI 공식 가격 페이지"),
    ),
}

# 음성 합성
GEMINI_TTS_AUDIO_TOKENS_PER_SECOND = 25  # 가정(Live Translate 문서 기준, 이 모델 적용은 미확인)
GEMINI_TTS_OUT_PER_MILLION: dict[str, tuple[float, float]] = {
    # 모델 -> (2027-01-01 이전, 이후) USD / 1M 오디오 토큰
    "gemini-3.8-flash-lite-tts": (6.0, 12.0),
    "gemini-3.8-flash-tts": (9.0, 18.0),
}
CARTESIA_PER_MILLION_CHARS = Price(47.0, "2차 자료 $20~47/1M자의 상한. 공식 가격 미확인")
OPENAI_TTS_TEXT_IN_PER_MILLION = Price(0.60, "OpenAI 공식 가격 페이지 gpt-4o-mini-tts")
OPENAI_TTS_AUDIO_OUT_PER_MILLION = Price(12.0, "OpenAI 공식 가격 페이지 gpt-4o-mini-tts")
OPENAI_TTS_AUDIO_TOKENS_PER_SECOND = 20  # 가정(Realtime 환산과 같은 1토큰/50ms, 미확인)

# 실시간 참조
GEMINI_LIVE_PER_MINUTE = (0.005, 0.018)  # (입력, 출력) Gemini 3.8 Live 공식 가격표
OPENAI_REALTIME_PER_MILLION = {
    "audio_in": 32.0,
    "text_in": 4.0,
    "audio_out": 64.0,
}  # gpt-realtime-2.1 공식 모델 페이지. 캐시 미적중(최악) 가정


class PricingError(Exception):
    """단가표에 없는 모델을 쓰려 할 때."""


@dataclass(frozen=True)
class Estimate:
    total_usd: float
    parts: dict[str, float] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)


def _turns(seconds: int) -> int:
    return max(1, math.ceil(seconds / TURN_SECONDS))


def stt_usd(comp: Component, seconds: int) -> float:
    key = (comp.provider, comp.model or "default")
    if comp.provider == "soniox":
        key = ("soniox", "default")
    try:
        price = STT_PER_MINUTE[key]
    except KeyError:
        raise PricingError(f"음성 인식 단가가 없다: {key}") from None
    return price.value * seconds / 60  # 스트리밍은 연결 시간 전체를 과금한다고 가정


def llm_usd(comp: Component, seconds: int) -> float:
    key = (comp.provider, comp.model or "")
    try:
        price_in, price_out = LLM_PER_MILLION[key]
    except KeyError:
        raise PricingError(f"텍스트 모델 단가가 없다: {key}") from None
    turns = _turns(seconds)
    tokens_in = sum(
        LLM_SYSTEM_TOKENS + LLM_USER_TOKENS_PER_TURN + k * LLM_HISTORY_TOKENS_PER_TURN
        for k in range(turns)
    )
    tokens_out = turns * LLM_OUTPUT_TOKENS_PER_TURN
    return (tokens_in * price_in.value + tokens_out * price_out.value) / 1_000_000


def tts_usd(comp: Component, seconds: int, today: date | None = None) -> float:
    today = today or date.today()
    ai_seconds = seconds * AI_SPEECH_FRACTION
    chars = ai_seconds * CHARS_PER_AI_SECOND
    if comp.provider == "gemini":
        model = comp.model or "gemini-3.8-flash-lite-tts"
        try:
            before, after = GEMINI_TTS_OUT_PER_MILLION[model]
        except KeyError:
            raise PricingError(f"Gemini 음성 합성 단가가 없다: {model}") from None
        per_million = after if today >= GEMINI_TTS_PRICE_CHANGE else before
        tokens = ai_seconds * GEMINI_TTS_AUDIO_TOKENS_PER_SECOND
        text_tokens = chars / 4
        return (tokens * per_million + text_tokens * 1.0) / 1_000_000  # 텍스트 입력은 $1/1M로 상한 처리
    if comp.provider == "cartesia":
        return chars * CARTESIA_PER_MILLION_CHARS.value / 1_000_000
    if comp.provider == "openai":
        tokens = ai_seconds * OPENAI_TTS_AUDIO_TOKENS_PER_SECOND
        text_tokens = chars / 4
        return (
            tokens * OPENAI_TTS_AUDIO_OUT_PER_MILLION.value
            + text_tokens * OPENAI_TTS_TEXT_IN_PER_MILLION.value
        ) / 1_000_000
    raise PricingError(f"음성 합성 단가가 없다: {comp.provider}")


def realtime_usd(comp: Component, seconds: int) -> float:
    if comp.provider == "gemini_live":
        per_in, per_out = GEMINI_LIVE_PER_MINUTE
        return (per_in + per_out) * seconds / 60  # 입출력 모두 연속 과금 가정
    if comp.provider == "openai_realtime":
        n = _turns(seconds)
        user, ai = OPENAI_USER_AUDIO_TOKENS_PER_TURN, OPENAI_AI_AUDIO_TOKENS_PER_TURN
        audio_in = (user + ai) * n * (n - 1) / 2 + user * n  # 매 응답에 대화 전체를 재전송
        text_in = LLM_SYSTEM_TOKENS * n
        audio_out = ai * n
        prices = OPENAI_REALTIME_PER_MILLION
        return (
            audio_in * prices["audio_in"] + text_in * prices["text_in"] + audio_out * prices["audio_out"]
        ) / 1_000_000
    raise PricingError(f"실시간 모델 단가가 없다: {comp.provider}")


def max_session_usd(cfg: SessionConfig, safety_factor: float = 1.25, today: date | None = None) -> Estimate:
    """세션 상한 시간 동안 쓸 수 있는 최대 비용을 안전 계수까지 곱해 예약용으로 계산한다."""
    seconds = cfg.session_seconds
    parts: dict[str, float] = {}
    notes: list[str] = []
    if cfg.kind == "cascade":
        assert cfg.stt and cfg.llm and cfg.tts
        parts["stt"] = stt_usd(cfg.stt, seconds)
        parts["llm"] = llm_usd(cfg.llm, seconds)
        parts["tts"] = tts_usd(cfg.tts, seconds, today)
    else:
        assert cfg.realtime
        parts["realtime"] = realtime_usd(cfg.realtime, seconds)
        if cfg.realtime.provider == "openai_realtime":
            notes.append("캐시 미적중(최악)을 가정한 값이다")
    total = sum(parts.values()) * safety_factor
    return Estimate(total_usd=total, parts={k: v * safety_factor for k, v in parts.items()}, notes=notes)
