import pytest

from voice_eval.config import ConfigError, acknowledged_vendors, load_matrix
from voice_eval.pricing import max_session_usd


def test_matrix_loads_and_orders_nine_configs():
    matrix = load_matrix()
    assert matrix.baseline == "baseline"
    assert matrix.order[0] == "baseline"
    assert len(matrix.order) == 9
    assert set(matrix.order) == set(matrix.configs)


def test_each_variant_changes_exactly_one_component_from_baseline():
    matrix = load_matrix()
    base = matrix.get("baseline")
    for config_id, cfg in matrix.configs.items():
        if cfg.kind != "cascade" or config_id == "baseline":
            continue
        changed = [slot for slot in ("stt", "llm", "tts") if getattr(cfg, slot) != getattr(base, slot)]
        assert len(changed) == 1, f"{config_id}: {changed}"


def test_realtime_references_have_no_cascade_components():
    matrix = load_matrix()
    for config_id in ("ref-gemini-live", "ref-openai-realtime"):
        cfg = matrix.get(config_id)
        assert cfg.kind == "realtime"
        assert cfg.realtime and not (cfg.stt or cfg.llm or cfg.tts)


def test_every_config_is_priced():
    matrix = load_matrix()
    for cfg in matrix.configs.values():
        assert max_session_usd(cfg, matrix.safety_factor).total_usd > 0


def test_required_env_vars_are_names_only():
    matrix = load_matrix()
    names = set()
    for cfg in matrix.configs.values():
        names.update(cfg.required_env_vars())
    assert names == {
        "SONIOX_API_KEY",
        "ANTHROPIC_API_KEY",
        "GOOGLE_API_KEY",
        "DEEPGRAM_API_KEY",
        "OPENAI_API_KEY",
        "CARTESIA_API_KEY",
    }


def test_unconfirmed_vendors_block_until_acknowledged():
    matrix = load_matrix()
    baseline = matrix.get("baseline")
    assert baseline.unacknowledged_vendors(set()) == ["soniox", "google"]
    assert baseline.unacknowledged_vendors({"soniox", "google"}) == []
    # openai는 확인됨이라 확인 표시 없이 시작할 수 있다
    assert matrix.get("ref-openai-realtime").unacknowledged_vendors(set()) == []
    # 업체 이름은 대소문자·공백을 무시하고 읽는다
    assert acknowledged_vendors(" Google , SONIOX,") == {"google", "soniox"}
    assert acknowledged_vendors(None) == set()


def test_cartesia_and_deepgram_variants_need_acknowledgement():
    matrix = load_matrix()
    assert "cartesia" in matrix.get("tts-cartesia").unacknowledged_vendors({"soniox", "google"})
    assert "deepgram" in matrix.get("stt-deepgram").unacknowledged_vendors({"soniox", "google"})


def test_unknown_config_is_rejected():
    with pytest.raises(ConfigError):
        load_matrix().get("nope")
