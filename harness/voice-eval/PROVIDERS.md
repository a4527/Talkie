# 공급자별 키 발급·결제·하니스 적용

이 문서는 시험 하니스가 쓰는 공급자 6곳의 가입, 키 발급, 결제와 지출 한도, 데이터 설정, `.env` 적용 방법의 기준이다. 환경변수 이름과 확인 절차는 여기에만 둔다. 실행 방법은 [README](README.md)를 따른다.

작성일: 2026-10-26. 조사는 공식 문서·페이지를 우선했고 화면 메뉴 이름은 바뀔 수 있다. 확인하지 못한 항목은 **미확인**으로 표시했으니 가입 화면과 공식 가격 페이지에서 직접 확인한다. 가격과 정책은 [후보 평가 계획](../../docs/proposals/ai-candidate-evaluation-plan.md)을 따른다.

## 공통 원칙

- **키는 `.env`에만 둔다.** 대화, 문서, 이슈, 로그, 스크린샷에 붙여 넣지 않는다. `.env`는 Git에서 제외되고 커밋 전 검사에 걸린다. 키가 노출되면 즉시 폐기하고 새로 발급한다.
- **하니스 전용 키를 만든다.** 가능하면 전용 프로젝트나 워크스페이스에 만료일을 붙여 발급한다.
- **선불 크레딧과 자동 충전 끄기를 우선한다.** 시험 총 상한은 3만 원(DEC-016), 1라운드 제안 한도는 5,000원이다. 하니스의 예산 장부가 호출 전에 막지만 공급자 콘솔의 한도도 따로 건다.
- **음성은 합성 대화와 본인 음성만** 보낸다. 실제 사용자 음성은 보내지 않는다(DEC-016, DEC-052).
- **학습 금지를 확인한 업체만 시험한다**(DEC-052). 확인 상태는 아래 표와 `uv run bot.py --config <구성> --check`가 보여 준다. 확인됨이 아닌 업체는 직접 확인한 뒤 `.env`의 `VOICE_EVAL_ACK`에 적어야 시작한다.
- 만 18세 이상 전용 서비스(DEC-051)라는 공급자 약관 조건은 제품 가입 단계의 문제이며 시험 하니스에는 영향이 없다.

## 한눈에 보기

| 공급자 | 환경변수 | 쓰는 구성 | 결제 방식 | 학습 정책 상태(하니스) | `VOICE_EVAL_ACK` |
| --- | --- | --- | --- | --- | --- |
| OpenAI | `OPENAI_API_KEY` | stt-openai, llm-openai, tts-openai, ref-openai-realtime | 선불 크레딧(최소 $5) 또는 카드 | 확인됨 | 불필요 |
| Anthropic | `ANTHROPIC_API_KEY` | baseline(텍스트 모델) 전체 cascade | 크레딧 구매 또는 자동 충전 | 확인됨 | 불필요 |
| Google(Gemini API) | `GOOGLE_API_KEY` | baseline(음성 합성), llm-gemini, ref-gemini-live | 선불(최소 $5) 또는 후불 | 조건부(유료 프로젝트여야 함) | `google` |
| Soniox | `SONIOX_API_KEY` | baseline(음성 인식) 전체 cascade | **미확인**(콘솔 확인) | 미확인 | `soniox` |
| Deepgram | `DEEPGRAM_API_KEY` | stt-deepgram | 가입 시 $200 크레딧, 카드 불필요 | 미확인 | `deepgram` |
| Cartesia | `CARTESIA_API_KEY`, 선택 `CARTESIA_VOICE_ID` | tts-cartesia | 무료 플랜(20K 크레딧) 또는 월 $5 플랜 | 미확인 | `cartesia` |

기본 조합(baseline)에는 Soniox, Anthropic, Google 키가 필요하다. 교체 시험까지 하려면 나머지 세 곳이 더 필요하고, 계정을 줄이려면 Deepgram과 Cartesia를 빼면 `stt-deepgram`, `tts-cartesia` 구성만 시험하지 못한다.

## Google AI Studio (Gemini API)

1. https://aistudio.google.com 에 Google 계정으로 로그인한다.
2. API keys 화면에서 키를 만든다. 키는 프로젝트에 속하며 결제 설정도 프로젝트 단위다.
3. 같은 화면이나 Projects 화면의 **Set up billing**에서 Cloud Billing 계정을 만들거나 연결하고 결제수단을 등록한다. 신규 계정은 선불(Prepay)이 기본이며 최소 $5를 충전한다. 선불이면 잔액이 양수일 때만 요청을 받는다.
4. **자동 충전(auto-reload)은 켜지 않는다.** 그러면 최대 지출이 충전액으로 제한된다. 후불로 바꾸면 계정 등급별 자동 상한이 적용되며(2차 자료의 Tier 1 상한 $250), 예산 알림은 Google Cloud 콘솔의 Billing → Budgets & alerts에서 설정한다(세부 절차는 **미확인**, 공식 문서 확인).
5. 결제를 활성화한 프로젝트의 모든 사용은 약관상 "유료 서비스"로 취급되어 프롬프트와 응답을 제품 개선에 쓰지 않는다. 결제 없이 무료 한도만 쓰는 키는 학습과 사람 검토 대상이 될 수 있으므로 **쓰지 않는다.** 이 키가 유료 프로젝트의 것임을 확인한 뒤 `VOICE_EVAL_ACK`에 `google`을 적는다.
6. 데이터 설정: 로그·데이터 세트 공유를 켜지 않고 Gemini API 참여자 등급(Contributor tier)에 가입하지 않는다. 악용 감시 로그는 55일 보관되며 DEC-025 상한을 넘는다. 이 시험은 DEC-052의 합성·본인 음성 유예에 해당한다.
7. `.env`: `GOOGLE_API_KEY=<키>`.
8. 하니스는 Gemini 음성 합성을 항상 API 키로 연결한다(Pipecat이 `api_key`를 받으면 Cloud Text-to-Speech가 아니라 Gemini API 백엔드를 쓴다).

## OpenAI

1. https://platform.openai.com 에서 가입하고 조직을 만든다. ChatGPT 구독과 API는 결제가 분리돼 있다.
2. Billing에서 결제수단을 등록하고 선불 크레딧을 산다(최소 $5, 기본 $10). 선불카드는 쓸 수 없다. 크레딧은 1년 후 만료되고 환불되지 않는다.
3. **자동 충전을 끈다.** 설정 단계에서 기본으로 켜져 있을 수 있다.
4. 시험 전용 프로젝트(예: `talkie-voice-eval`)를 만든다. 프로젝트의 Limits에서 월 지출 한도와 알림 기준을 정하고 **Enforce a hard limit**을 켠다. 집행이 약간 늦어 한도를 조금 넘길 수 있다.
5. 그 프로젝트에서 API 키를 만들고 만료일을 정한다.
6. 데이터: 기본은 API 입출력을 학습에 쓰지 않는다(서비스 계약 4.2). 데이터 공유(입출력을 OpenAI와 공유하는 옵션)를 켜지 않는다. 남용 모니터링 로그는 최대 30일 보관된다. 제로 데이터 보관은 승인이 필요하며 이 시험에는 필요하지 않다.
7. `.env`: `OPENAI_API_KEY=<키>`. 같은 키를 음성 인식, 텍스트 모델, 음성 합성, 실시간 참조가 함께 쓴다.

## Anthropic (Claude)

1. https://platform.claude.com 에서 가입한다(Claude Console).
2. Billing 화면(settings/billing)에서 크레딧을 사거나 자동 충전을 설정한다. **자동 충전은 켜지 않는다.** 조직의 월 지출 한도도 같은 화면에서 확인하며 등급별 상한이 있다(Start $500, Build $1,000, Scale $200,000).
3. Workspaces에서 시험 전용 워크스페이스를 만들고 **Spend limits**를 건다. 기본 워크스페이스에는 한도를 걸 수 없어서 전용 워크스페이스가 필요하다. 한도는 조직 한도보다 낮게만 설정된다.
4. API keys 화면(settings/keys)에서 그 워크스페이스로 범위를 정해 키를 만들고 만료일을 정한다. 키는 만들 때 한 번만 전체가 보인다.
5. 데이터: 상업용 API는 기본적으로 학습에 쓰지 않는다. Development Partner Program에 참여하지 않는다. 보관은 고객센터가 "30일 이내 삭제", 개발자 문서가 "기본 미보관(Covered Model만 30일)"이라고 서로 다르게 설명하므로 Haiku 5.5가 어느 쪽인지 문서의 최신 내용을 확인한다(**미확인**). Console의 플레이그라운드는 ZDR 범위에서 제외된다.
6. `.env`: `ANTHROPIC_API_KEY=<키>`.

## Soniox (음성 인식)

1. https://soniox.com 에서 계정을 만들고 Console에 로그인한다.
2. 기본 프로젝트(My First Project)의 API Keys에서 키를 만든다.
3. 결제: 문서에는 무료 크레딧, 선불 여부, 카드 등록 절차가 없다(**미확인**). Console의 Billing과 https://soniox.com/pricing 에서 확인한다. 실시간 요금은 시간당 $0.12(벤더 페이지)이며 3분 세션은 약 $0.006이다. 지출 한도나 알림 기능이 있는지도 Console에서 확인한다.
4. 데이터: 보안 문서는 기본이 무보관이고 Async API로 저장한 데이터만 30일 뒤 삭제되며 학습에 쓰지 않는다고 한다. 한국어 페이지의 "지역 내 저장" 서술과 어긋나므로 Console의 보안·규정 문서나 문의로 DPA를 확인한 뒤 `VOICE_EVAL_ACK`에 `soniox`를 적는다. 하니스는 실시간 WebSocket만 쓰고 Async API는 쓰지 않는다.
5. `.env`: `SONIOX_API_KEY=<키>`.

## Deepgram (음성 인식, 교체 후보)

1. https://console.deepgram.com/signup 에서 가입한다. 가입 시 $200 크레딧이 카드 없이 주어지며 소진될 때까지 유지된다고 안내한다. 3분 세션이 약 $0.023이라 카드를 등록하지 않아도 충분하다. 카드를 등록하면 자동 충전(기본 잔액 $10 이하에서 $100)이 켜질 수 있으므로 시험에는 등록하지 않는 편이 안전하다.
2. 첫 키는 콘솔에서 만든다. Projects 드롭다운 → Settings → API Keys에서 이름과 역할을 정해 만든다.
3. 지출 한도와 알림 기능은 문서에서 확인하지 못했다(**미확인**).
4. 데이터: 공식 Model Improvement Partnership Program 문서를 읽고 확인한다. 2차 자료는 기본 비참여이며 요청에 `mip_opt_out=true`를 붙이면 제외된다고 하지만 이 하니스는 해당 옵션을 아직 넣지 않았다. 확인 후 `VOICE_EVAL_ACK`에 `deepgram`을 적는다.
5. `.env`: `DEEPGRAM_API_KEY=<키>`.
6. 한국어는 공식 언어표에 있으나 스트리밍 지원 구분이 문서에 없다. `stt-deepgram`은 `language: multi`로 설정했고 한국어가 인식되지 않으면 `configs/matrix.yaml`에서 `language: ko`로 바꿔 시험한다.

## Cartesia (음성 합성, 교체 후보)

1. https://play.cartesia.ai 에서 가입한다.
2. https://play.cartesia.ai/keys 에서 표준 API 키를 만든다. 크레딧 사용량 등 관리 API용 admin 키와는 별개이며 서로 쓸 수 없다. 음성 합성에는 표준 키를 쓴다.
3. 플랜: Free는 월 20K 크레딧이고 Pro는 월 $5에 100K 크레딧이다. 음성 합성은 글자당 약 1 크레딧이라 3분 세션(AI 발화 약 1,350자)이 Free로 약 14번이다. Free에는 상업 이용 라이선스가 없지만 시험에는 해당하지 않는다. 오버리지(초과 과금)를 꺼 두면 크레딧이 소진되면 요청이 막힌다는 설명이 2차 자료에 있으므로 설정에서 확인한다.
4. 데이터: Zero Data Retention은 Enterprise만 제공한다. 기본 학습과 보관 조건은 확인하지 못했다(**미확인**). Trust Center(trust.cartesia.ai)와 개인정보 정책에서 확인한 뒤 `VOICE_EVAL_ACK`에 `cartesia`를 적는다.
5. `.env`: `CARTESIA_API_KEY=<키>`, 선택으로 `CARTESIA_VOICE_ID=<목소리 ID>`. 비우면 Pipecat 템플릿의 예시 목소리를 쓴다.

## 하니스에 적용하는 순서

1. 위 공급자 중 필요한 곳의 키를 발급한다. 권장 순서는 Anthropic, Google, Soniox(기본 조합) → OpenAI(교체와 실시간 참조) → Deepgram, Cartesia(교체).
2. `harness/voice-eval/.env.example`을 `.env`로 복사하고 키를 채운다.
3. `uv run bot.py --config baseline --check`로 키 존재 여부(값은 출력하지 않음), 학습 정책 상태, 예상 최대 비용, 남은 한도를 확인한다.
4. 확인 안내에 나온 업체의 정책을 직접 확인한 뒤 `.env`의 `VOICE_EVAL_ACK`에 적는다. 예: `VOICE_EVAL_ACK=google,soniox`.
5. `uv run bot.py --config baseline`으로 시작하고 브라우저에서 `http://localhost:7860/client`를 연다. 자세한 흐름은 [README](README.md)를 따른다.
6. 시험이 끝나면 공급자 콘솔의 실제 청구액을 보고 `uv run python -m voice_eval.ledger settle <항목 번호> <원화 금액>`으로 장부를 맞춘다.

## 출처

- Google: [Gemini API 결제](https://ai.google.dev/gemini-api/docs/billing), [Gemini API 추가 서비스 약관](https://ai.google.dev/terms), [악용 감시](https://ai.google.dev/gemini-api/docs/usage-policies), [데이터 로깅 및 공유](https://ai.google.dev/gemini-api/docs/logs-policy)
- OpenAI: [선불 결제](https://help.openai.com/en/articles/8264644-how-can-i-set-up-prepaid-billing), [프로젝트 관리](https://help.openai.com/en/articles/9186755-managing-projects-in-the-api-platform), [지출 한도](https://developers.openai.com/api/docs/guides/spend-limits), [데이터 통제](https://developers.openai.com/api/docs/guides/your-data)
- Anthropic: [API 키 받기](https://platform.claude.com/docs/en/get-api-key), [워크스페이스](https://platform.claude.com/docs/en/manage-claude/workspaces), [API와 데이터 보관](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention), [모델 학습 정책](https://privacy.claude.com/en/articles/7996885-how-do-you-use-personal-data-in-model-training)
- Soniox: [시작하기](https://soniox.com/docs/stt/get-started), [보안·개인정보](https://soniox.com/docs/stt/security-and-privacy), [가격](https://soniox.com/pricing)
- Deepgram: [가입](https://console.deepgram.com/signup), [API 키 만들기](https://developers.deepgram.com/docs/create-additional-api-keys), [모델 개선 프로그램](https://developers.deepgram.com/docs/the-deepgram-model-improvement-partnership-program)
- Cartesia: [가격](https://www.cartesia.ai/pricing), [API 규칙](https://docs.cartesia.ai/use-the-api/api-conventions), [Zero Data Retention](https://docs.cartesia.ai/enterprise/zero-data-retention)
