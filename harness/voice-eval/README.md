# Talkie 음성 후보 시험 하니스

제품 코드(`app/`)와 분리된 시험 전용 도구다. 음성 인식, 텍스트 모델, 음성 합성을 설정으로 바꿔 가며 직접 말하고 들어 비교하고, Gemini Live와 OpenAI Realtime을 참조로 시험한다. 근거와 후보는 [후보 평가 계획](../../docs/proposals/ai-candidate-evaluation-plan.md)(DEC-050·053·054), 키·결제는 [PROVIDERS.md](PROVIDERS.md)를 따른다.

시험 범위는 합성 대화와 **개발자 본인 음성**뿐이다. 실제 사용자 음성과 개인정보는 넣지 않는다(DEC-016, DEC-052).

## 준비

- Python 3.11~3.13과 [uv](https://docs.astral.sh/uv/)가 필요하다.
- 설치: `cd harness/voice-eval && uv sync`
- `.env.example`을 `.env`로 복사해 키를 채운다. 어떤 키가 필요한지와 발급·결제 절차는 [PROVIDERS.md](PROVIDERS.md)를 본다.

### 환경별 실행 위치

| 환경 | 하니스 실행 | 마이크 |
| --- | --- | --- |
| Windows + WSL2 | WSL2에서 실행 | Windows 브라우저에서 `http://localhost:7860/client`를 열어 브라우저 마이크를 쓴다. 열리지 않으면 `--host 0.0.0.0`으로 실행하고 WSL2 주소를 쓴다 |
| Mac | Mac에서 직접 실행(`brew install uv` 등) | Chrome에서 같은 주소를 열고 macOS의 마이크 권한을 허용한다. Safari는 WebRTC 동작이 다를 수 있어 권장하지 않는다 |

브라우저는 `localhost`에서는 HTTPS 없이 마이크를 허용한다. 키(`.env`)와 결과(`.local/eval/`)는 기기마다 따로 있다.

## 구성

`uv run bot.py --list`로 비용이 낮은 순서의 구성을 본다. 정의는 [configs/matrix.yaml](configs/matrix.yaml)이며 요소를 통째로 교체한다.

| 구성 | 종류 | 바꾼 요소 |
| --- | --- | --- |
| baseline | cascade | Soniox + Claude Haiku 5.5 + Gemini TTS (기본) |
| stt-deepgram, stt-openai | cascade | 음성 인식만 교체 |
| llm-gemini, llm-openai | cascade | 텍스트 모델만 교체 |
| tts-cartesia, tts-openai | cascade | 음성 합성만 교체 |
| ref-gemini-live, ref-openai-realtime | realtime | 참조(한 번씩) |

한 구성에서 한 요소만 바뀌는지는 테스트가 확인한다. 새 모델을 추가하려면 `matrix.yaml`에 구성을 넣고 [voice_eval/pricing.py](voice_eval/pricing.py)에 단가를 넣는다. 단가가 없으면 시작하지 않는다.

## 시험 절차

1. `uv run bot.py --config baseline --check` — 키 존재 여부(값은 출력하지 않음), 학습 정책 상태, 세션 최대 비용, 남은 한도를 보여 주고 부족하면 비정상 종료한다.
2. 확인되지 않은 업체는 직접 확인한 뒤 `.env`의 `VOICE_EVAL_ACK`에 적는다. 확인하지 않은 업체가 들어 있으면 세션이 시작되지 않는다(DEC-052).
3. `uv run bot.py --config baseline` — 시작 후 브라우저에서 `http://localhost:7860/client`를 열고 Connect를 누르고 마이크를 허용한 뒤 말한다. 세션은 최대 180초(3분)에서 자동 종료한다. 구성당 같은 시나리오로 2회 진행한다.
4. 들은 뒤 점수를 남긴다. 1(나쁨)~5(좋음)이며 메모에는 발화 내용과 개인정보를 적지 않는다.

   ```
   uv run python -m voice_eval.rate baseline --recognition 4 --naturalness 3 --voice 4 --latency 3 --interrupt 2
   ```

5. 구성별 결과를 비교한다: `uv run python -m voice_eval.report`
6. 순서는 `--list`의 위에서 아래다. 성능 기준은 정하지 않고 모두 들은 뒤 정한다(DEC-054).

## 비용 장부

세션을 시작하기 전에 최대 비용(단가표 × 안전 계수)을 계산해 장부에 예약하고, 1라운드 한도(기본 5,000원, `matrix.yaml` 또는 `VOICE_EVAL_SPEND_CAP_KRW`)나 총 한도(3만 원, DEC-016)를 넘으면 시작하지 않는다. 예약은 실제 청구액이 아니므로 시험 후 공급자 콘솔의 청구액을 보고 맞춘다.

```
uv run python -m voice_eval.ledger show
uv run python -m voice_eval.ledger settle <항목 번호> <실제 원화 금액>
```

장부는 내용 없는 금액만 담으며 날짜로 초기화하지 않는다. 단가는 계획서의 추정이므로 호출 전에 공식 가격 페이지로 다시 확인한다.

## 기록과 로그

- 결과는 `.local/eval/results.jsonl`(Git 제외, 본인만 읽기)에 점수, 지연, 사용량, 예약 비용만 남기고 **발화 내용과 전사문은 저장하지 않는다**(DEC-040). 실행할 때마다 7일이 지난 기록을 삭제한다(DEC-037).
- 콘솔 로그는 이 하니스의 메시지만 INFO로 보이고 Pipecat 등 나머지는 WARNING 이상만 보이게 해 발화 내용이 출력되지 않게 했다.
- 시험 결과의 요약은 사용자가 그날의 worklog에 기록한다. 하니스는 문서를 쓰지 않는다.

## 테스트

`uv run pytest` — 구성 검증, 단가 계산, 장부 한도, 기록 삭제, 모든 구성 요소가 가짜 키로 만들어지는지 확인한다. 네트워크 호출과 유료 호출은 하지 않는다.

## 구조

| 파일 | 역할 |
| --- | --- |
| `bot.py` | Pipecat 러너 진입점. `--config`, `--list`, `--check` |
| `configs/matrix.yaml` | 구성 매트릭스와 한도 |
| `voice_eval/config.py` | 구성 로더·검증, 업체별 학습 정책 상태 |
| `voice_eval/services.py` | 구성 요소를 Pipecat 서비스로 조립 |
| `voice_eval/session.py` | 한 세션의 비용 예약, 파이프라인, 지연·사용량 기록 |
| `voice_eval/pricing.py` | 단가표와 최대 비용 계산 |
| `voice_eval/ledger.py`, `results.py`, `rate.py`, `report.py` | 장부, 기록, 점수, 요약 |

사용 중인 Pipecat은 1.14.0이다. 파이프라인 구성은 설치본의 공식 CLI 템플릿(`bot_cascade`, `bot_realtime`)을 따랐다.
