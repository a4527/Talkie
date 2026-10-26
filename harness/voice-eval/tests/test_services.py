"""가짜 키로 모든 구성 요소가 만들어지는지 확인한다. 네트워크 호출은 하지 않는다."""

import pytest

from voice_eval.config import ConfigError, load_matrix
from voice_eval.services import build_llm, build_realtime, build_stt, build_tts

FAKE_KEYS = (
    "SONIOX_API_KEY",
    "DEEPGRAM_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_API_KEY",
    "CARTESIA_API_KEY",
)


@pytest.fixture(autouse=True)
def fake_keys(monkeypatch):
    for name in FAKE_KEYS:
        monkeypatch.setenv(name, "test-not-a-real-key")
    monkeypatch.delenv("CARTESIA_VOICE_ID", raising=False)


def test_every_component_builds():
    matrix = load_matrix()
    for cfg in matrix.configs.values():
        if cfg.kind == "cascade":
            assert build_stt(cfg.stt) is not None
            assert build_llm(cfg.llm) is not None
            assert build_tts(cfg.tts) is not None
        else:
            assert build_realtime(cfg.realtime) is not None


def test_missing_key_reports_variable_name_only(monkeypatch):
    monkeypatch.setenv("SONIOX_API_KEY", "")
    cfg = load_matrix().get("baseline")
    with pytest.raises(ConfigError) as error:
        build_stt(cfg.stt)
    assert "SONIOX_API_KEY" in str(error.value)
    assert "test-not-a-real-key" not in str(error.value)


def test_gemini_tts_uses_the_gemini_api_backend_with_api_key():
    tts = build_tts(load_matrix().get("baseline").tts)
    assert getattr(tts, "_use_genai", None) is True
