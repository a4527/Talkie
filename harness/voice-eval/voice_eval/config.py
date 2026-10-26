"""configs/matrix.yaml 로더와 검증. 키 값은 다루지 않고 환경변수 이름만 다룬다."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from voice_eval.paths import MATRIX_PATH

COMPONENT_KEYS = ("stt", "llm", "tts", "realtime")

KNOWN_PROVIDERS: dict[str, set[str]] = {
    "stt": {"soniox", "deepgram", "openai"},
    "llm": {"anthropic", "google", "openai"},
    "tts": {"gemini", "cartesia", "openai"},
    "realtime": {"gemini_live", "openai_realtime"},
}

# 공급자 -> 읽는 환경변수 이름. 값은 .env에서만 읽는다.
PROVIDER_ENV: dict[str, str] = {
    "soniox": "SONIOX_API_KEY",
    "deepgram": "DEEPGRAM_API_KEY",
    "openai": "OPENAI_API_KEY",
    "openai_realtime": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "google": "GOOGLE_API_KEY",
    "gemini": "GOOGLE_API_KEY",
    "gemini_live": "GOOGLE_API_KEY",
    "cartesia": "CARTESIA_API_KEY",
}


# 공급자 -> 학습 정책 확인 대상(업체)
VENDOR_OF: dict[str, str] = {
    "soniox": "soniox",
    "deepgram": "deepgram",
    "openai": "openai",
    "openai_realtime": "openai",
    "anthropic": "anthropic",
    "google": "google",
    "gemini": "google",
    "gemini_live": "google",
    "cartesia": "cartesia",
}

# DEC-052: 학습 금지를 확인한 업체만 시험한다. 확인된 것은 "confirmed", 나머지는 사용자가 직접
# 확인했다고 VOICE_EVAL_ACK에 적어야 시작한다. 근거는 docs/proposals/ai-candidate-evaluation-plan.md.
VENDOR_POLICY: dict[str, tuple[str, str]] = {
    "openai": ("confirmed", "서비스 계약 4.2와 데이터 문서. 데이터 공유 옵션을 켜지 않는다"),
    "anthropic": ("confirmed", "상업용 API는 기본적으로 학습에 쓰지 않는다. Development Partner Program에 참여하지 않는다"),
    "google": ("conditional", "Cloud Billing이 활성화된 유료 프로젝트의 키여야 학습에 쓰이지 않는다. 로깅 데이터 세트 공유와 참여자 등급을 쓰지 않는다"),
    "soniox": ("unconfirmed", "벤더 페이지의 주장만 확인했다. DPA의 보관·학습 조항을 직접 확인한다"),
    "deepgram": ("unconfirmed", "모델 개선 프로그램 기본 비참여는 2차 자료다. 공식 문서로 확인한다"),
    "cartesia": ("unconfirmed", "기본 학습·보관 조건을 확인하지 못했다. Trust Center와 개인정보 정책으로 확인한다"),
}


class ConfigError(Exception):
    """구성 파일이 잘못되었을 때."""


@dataclass(frozen=True)
class Component:
    provider: str
    params: dict[str, Any] = field(default_factory=dict)

    @property
    def model(self) -> str | None:
        return self.params.get("model")


@dataclass(frozen=True)
class SessionConfig:
    id: str
    kind: str  # "cascade" | "realtime"
    description: str
    stt: Component | None
    llm: Component | None
    tts: Component | None
    realtime: Component | None
    session_seconds: int

    def components(self) -> dict[str, Component]:
        parts = {"stt": self.stt, "llm": self.llm, "tts": self.tts, "realtime": self.realtime}
        return {name: comp for name, comp in parts.items() if comp is not None}

    def vendors(self) -> list[str]:
        names: list[str] = []
        for comp in self.components().values():
            vendor = VENDOR_OF[comp.provider]
            if vendor not in names:
                names.append(vendor)
        return names

    def unacknowledged_vendors(self, acked: set[str]) -> list[str]:
        """확인 완료(confirmed)가 아니면서 사용자가 확인했다고 적지 않은 업체."""
        return [
            vendor
            for vendor in self.vendors()
            if VENDOR_POLICY[vendor][0] != "confirmed" and vendor not in acked
        ]

    def required_env_vars(self) -> list[str]:
        names: list[str] = []
        for comp in self.components().values():
            name = PROVIDER_ENV[comp.provider]
            if name not in names:
                names.append(name)
        return names


@dataclass(frozen=True)
class Matrix:
    configs: dict[str, SessionConfig]
    order: list[str]
    baseline: str
    session_seconds: int
    round_cap_krw: int
    total_cap_krw: int
    krw_per_usd: float
    safety_factor: float

    def get(self, config_id: str) -> SessionConfig:
        try:
            return self.configs[config_id]
        except KeyError:
            known = ", ".join(self.order)
            raise ConfigError(f"알 수 없는 구성 '{config_id}'. 사용 가능: {known}") from None


def acknowledged_vendors(raw: str | None) -> set[str]:
    """VOICE_EVAL_ACK(쉼표 목록)를 업체 이름 집합으로 바꾼다."""
    return {item.strip().lower() for item in (raw or "").split(",") if item.strip()}


def _component(raw: Any, slot: str, config_id: str) -> Component:
    if not isinstance(raw, dict) or "provider" not in raw:
        raise ConfigError(f"{config_id}.{slot}에는 provider가 필요하다")
    params = {key: value for key, value in raw.items() if key != "provider"}
    provider = str(raw["provider"])
    if provider not in KNOWN_PROVIDERS[slot]:
        allowed = ", ".join(sorted(KNOWN_PROVIDERS[slot]))
        raise ConfigError(f"{config_id}.{slot}: 알 수 없는 provider '{provider}' (허용: {allowed})")
    return Component(provider=provider, params=params)


def _resolve(config_id: str, raw_configs: dict[str, Any], seen: tuple[str, ...] = ()) -> dict[str, Any]:
    """base를 따라가며 요소별로 덮어쓴 원본 딕셔너리를 만든다. 요소는 통째로 교체한다."""
    if config_id in seen:
        raise ConfigError(f"base 순환 참조: {' -> '.join((*seen, config_id))}")
    raw = raw_configs.get(config_id)
    if raw is None:
        raise ConfigError(f"구성 '{config_id}'가 없다")
    merged: dict[str, Any] = {}
    if "base" in raw:
        merged.update(_resolve(str(raw["base"]), raw_configs, (*seen, config_id)))
    for key, value in raw.items():
        if key != "base":
            merged[key] = value
    return merged


def load_matrix(path: Path = MATRIX_PATH) -> Matrix:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    limits = data.get("limits", {})
    session_seconds = int(limits.get("session_seconds", 180))
    raw_configs: dict[str, Any] = data.get("configs", {})
    order: list[str] = list(data.get("order", list(raw_configs)))

    configs: dict[str, SessionConfig] = {}
    for config_id in raw_configs:
        merged = _resolve(config_id, raw_configs)
        kind = merged.get("kind")
        if kind not in ("cascade", "realtime"):
            raise ConfigError(f"{config_id}: kind는 cascade 또는 realtime이어야 한다")
        parts: dict[str, Component | None] = {
            slot: (_component(merged[slot], slot, config_id) if slot in merged else None)
            for slot in COMPONENT_KEYS
        }
        needed = ("stt", "llm", "tts") if kind == "cascade" else ("realtime",)
        missing = [slot for slot in needed if parts[slot] is None]
        if missing:
            raise ConfigError(f"{config_id}: {', '.join(missing)} 정의가 필요하다")
        extra = [slot for slot in COMPONENT_KEYS if slot not in needed and parts[slot] is not None]
        if extra:
            raise ConfigError(f"{config_id}: {kind} 구성에 {', '.join(extra)}는 쓸 수 없다")
        configs[config_id] = SessionConfig(
            id=config_id,
            kind=kind,
            description=str(merged.get("description", "")),
            stt=parts["stt"],
            llm=parts["llm"],
            tts=parts["tts"],
            realtime=parts["realtime"],
            session_seconds=int(merged.get("session_seconds", session_seconds)),
        )

    unknown = [config_id for config_id in order if config_id not in configs]
    if unknown:
        raise ConfigError(f"order에 정의되지 않은 구성: {', '.join(unknown)}")
    baseline = str(data.get("baseline", order[0]))
    if baseline not in configs:
        raise ConfigError(f"baseline '{baseline}'가 구성에 없다")

    return Matrix(
        configs=configs,
        order=order,
        baseline=baseline,
        session_seconds=session_seconds,
        round_cap_krw=int(limits.get("round_cap_krw", 5000)),
        total_cap_krw=int(limits.get("total_cap_krw", 30000)),
        krw_per_usd=float(limits.get("krw_per_usd", 1400)),
        safety_factor=float(limits.get("safety_factor", 1.25)),
    )
