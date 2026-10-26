from datetime import date

import pytest

from voice_eval.config import load_matrix
from voice_eval.pricing import max_session_usd, tts_usd


def estimate(config_id: str, factor: float = 1.0, today: date | None = None) -> float:
    cfg = load_matrix().get(config_id)
    return max_session_usd(cfg, factor, today).total_usd


def test_openai_realtime_three_minutes_uncached_is_about_33_cents():
    # 계획서의 3분 세션 최악값(캐시 0%) 약 $0.33
    assert estimate("ref-openai-realtime") == pytest.approx(0.3317, abs=0.003)


def test_gemini_live_three_minutes_is_69_thousandths():
    assert estimate("ref-gemini-live") == pytest.approx(0.069, abs=0.001)


def test_baseline_is_far_cheaper_than_realtime_references():
    base = estimate("baseline")
    assert base < estimate("ref-gemini-live")
    assert base * 3 < estimate("ref-openai-realtime")


def test_safety_factor_scales_total():
    assert estimate("baseline", 1.25) == pytest.approx(estimate("baseline", 1.0) * 1.25)


def test_gemini_tts_price_doubles_from_2027():
    comp = load_matrix().get("baseline").tts
    before = tts_usd(comp, 180, today=date(2026, 12, 31))
    after = tts_usd(comp, 180, today=date(2027, 1, 1))
    assert after > before
