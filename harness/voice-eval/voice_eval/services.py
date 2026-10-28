"""구성 요소 정의(Component)를 Pipecat 서비스 객체로 만든다. 키는 환경변수에서만 읽는다.

공급자 모듈은 쓸 때 불러온다. 서비스 클래스와 Settings 사용법은 설치된 Pipecat 1.14 기준이다.
"""

from __future__ import annotations

import os
from typing import Any

from voice_eval.config import PROVIDER_ENV, Component, ConfigError
from voice_eval.prompts import SYSTEM_PROMPT

DEFAULT_CARTESIA_VOICE = "86e30c1d-714b-4074-a1f2-1cb6b552fb49"  # Pipecat 템플릿의 예시 목소리


def _key(provider: str) -> str:
    """공급자의 API 키를 읽는다. 없으면 값이 아니라 변수 이름만 알리는 예외를 던진다."""
    name = PROVIDER_ENV[provider]
    value = os.environ.get(name, "").strip()
    if not value:
        raise ConfigError(f"환경변수 {name}가 비어 있다 (.env 확인, docs/harness/voice-eval/PROVIDERS.md 참고)")
    return value


def build_stt(comp: Component) -> Any:
    from pipecat.transcriptions.language import Language

    api_key = _key(comp.provider)
    if comp.provider == "soniox":
        from pipecat.services.soniox.stt import SonioxSTTService

        return SonioxSTTService(
            api_key=api_key,
            settings=SonioxSTTService.Settings(language_hints=[Language.EN, Language.KO]),
        )
    if comp.provider == "deepgram":
        from pipecat.services.deepgram.stt import DeepgramSTTService

        return DeepgramSTTService(
            api_key=api_key,
            settings=DeepgramSTTService.Settings(
                model=comp.model or "nova-3",
                language=comp.params.get("language", "multi"),
            ),
        )
    if comp.provider == "openai":
        from pipecat.services.openai.stt import OpenAISTTService

        return OpenAISTTService(
            api_key=api_key,
            # 영어 고정(Language.EN 기본값)을 풀어 한국어 발화도 받는다.
            settings=OpenAISTTService.Settings(model=comp.model or "gpt-4o-transcribe", language=None),
        )
    raise ConfigError(f"지원하지 않는 음성 인식 공급자: {comp.provider}")


def build_llm(comp: Component, system_prompt: str = SYSTEM_PROMPT) -> Any:
    api_key = _key(comp.provider)
    model = comp.model
    if not model:
        raise ConfigError(f"텍스트 모델 구성에는 model이 필요하다: {comp.provider}")
    if comp.provider == "anthropic":
        from pipecat.services.anthropic.llm import AnthropicLLMService

        return AnthropicLLMService(
            api_key=api_key,
            settings=AnthropicLLMService.Settings(model=model, system_instruction=system_prompt),
        )
    if comp.provider == "google":
        from pipecat.services.google.llm import GoogleLLMService

        return GoogleLLMService(
            api_key=api_key,
            settings=GoogleLLMService.Settings(model=model, system_instruction=system_prompt),
        )
    if comp.provider == "openai":
        from pipecat.services.openai.llm import OpenAILLMService

        return OpenAILLMService(
            api_key=api_key,
            settings=OpenAILLMService.Settings(model=model, system_instruction=system_prompt),
        )
    raise ConfigError(f"지원하지 않는 텍스트 모델 공급자: {comp.provider}")


def build_tts(comp: Component) -> Any:
    api_key = _key(comp.provider)
    if comp.provider == "gemini":
        from pipecat.services.google.tts import GeminiTTSService

        # api_key를 넘기면 Cloud TTS가 아니라 Gemini API(AI Studio 키) 백엔드를 쓴다.
        return GeminiTTSService(
            api_key=api_key,
            settings=GeminiTTSService.Settings(
                model=comp.model or "gemini-3.8-flash-lite-tts",
                voice=comp.params.get("voice", "Kore"),
            ),
        )
    if comp.provider == "cartesia":
        from pipecat.services.cartesia.tts import CartesiaTTSService

        voice = os.environ.get("CARTESIA_VOICE_ID", "").strip() or comp.params.get("voice") or DEFAULT_CARTESIA_VOICE
        return CartesiaTTSService(api_key=api_key, settings=CartesiaTTSService.Settings(voice=voice))
    if comp.provider == "openai":
        from pipecat.services.openai.tts import OpenAITTSService

        return OpenAITTSService(
            api_key=api_key,
            settings=OpenAITTSService.Settings(
                model=comp.model or "gpt-4o-mini-tts",
                voice=comp.params.get("voice", "alloy"),
            ),
        )
    raise ConfigError(f"지원하지 않는 음성 합성 공급자: {comp.provider}")


def build_realtime(comp: Component, system_prompt: str = SYSTEM_PROMPT) -> Any:
    api_key = _key(comp.provider)
    if comp.provider == "gemini_live":
        from pipecat.services.google.gemini_live.llm import GeminiLiveLLMService

        return GeminiLiveLLMService(
            api_key=api_key,
            settings=GeminiLiveLLMService.Settings(
                model=comp.model,
                voice=comp.params.get("voice", "Kore"),
                system_instruction=system_prompt,
            ),
        )
    if comp.provider == "openai_realtime":
        from pipecat.services.openai.realtime.events import (
            AudioConfiguration,
            AudioInput,
            InputAudioNoiseReduction,
            InputAudioTranscription,
            SemanticTurnDetection,
            SessionProperties,
        )
        from pipecat.services.openai.realtime.llm import OpenAIRealtimeLLMService

        session_properties = SessionProperties(
            audio=AudioConfiguration(
                input=AudioInput(
                    transcription=InputAudioTranscription(),
                    turn_detection=SemanticTurnDetection(),
                    noise_reduction=InputAudioNoiseReduction(type="near_field"),
                )
            ),
        )
        return OpenAIRealtimeLLMService(
            api_key=api_key,
            settings=OpenAIRealtimeLLMService.Settings(
                model=comp.model,
                session_properties=session_properties,
                system_instruction=system_prompt,
            ),
        )
    raise ConfigError(f"지원하지 않는 실시간 공급자: {comp.provider}")
