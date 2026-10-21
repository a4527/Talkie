# ADR-029 · DEC-029 · 첫 실시간 음성 후보 두 곳 비교

- 결정일: 2026-10-21
- 상태: Accepted (비교 범위)
- 동의 근거: OpenAI Realtime 단독(A), Gemini Live 단독(B), 두 후보의 같은 사례 비교(C)를 제시했고 사용자가 `4-c`를 선택했다.
- 배경: DEC-008은 실시간 음성 AI 방향, DEC-016은 최초 로컬 비교 총 3만 원, DEC-025는 공급자 모델 학습 금지·최대 30일 보관을 정했다. 최종 공급자·모델은 선택되지 않았다.
- 대안: 단독 비교는 실험 시간·비용이 줄지만 상대적인 품질·지연·비용 근거가 약하다. C는 공통 사례로 대안을 확인할 수 있지만 설정과 평가 작업이 늘고 총예산 안에서 표본을 나눠야 한다.
- 결정과 이유: C를 채택한다. OpenAI Realtime과 Gemini Live를 동일한 핵심 시나리오로 소규모 비교한다. 이는 최종 공급자 또는 모델의 채택이 아니다. 한 후보만으로 음성 경로를 확정하기 전 비교 근거를 얻기 위한 범위 결정이다.
- 영향: 두 후보의 정책·가격·계정 설정 확인, 공통 평가 자료와 끼어들기·중단·실제 재생 범위·교정/요약 품질·지연·10분 비용 기록이 필요하다. 사용자 데이터는 실험에 쓰지 않으며 DEC-016의 합성 대화·본인 음성 범위를 지킨다. DEC-025 적합성과 최대 지출을 확인하기 전에는 음성을 보내거나 유료 호출을 하지 않는다. 두 후보 중 부적합한 곳은 음성 실험에서 제외하고 범위를 재논의한다.
- 검증되지 않은 점: 두 후보의 실제 정책 충족, 가격, 품질, 연결 가능성, 동일 조건 비교 가능성. 최종 공급자·역할별 모델은 D-03 평가와 사용자 동의 후 정한다.
- 참고 자료: [OpenAI Realtime](https://developers.openai.com/api/docs/guides/realtime), [Gemini Live](https://ai.google.dev/gemini-api/docs/live-api), [OpenAI 데이터 제어](https://developers.openai.com/api/docs/guides/your-data), [Gemini 데이터 정책](https://ai.google.dev/gemini-api/docs/zdr). 공식 기능 설명이며 Talkie 적합성을 입증하지 않는다.
- 연결: [DEC-016](016-local-ai-experiment-budget-and-data.md), [DEC-025](025-ephemeral-audio-and-provider-retention.md), PRD 9.2절, D-03.
