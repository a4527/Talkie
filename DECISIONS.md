# Talkie 결정 목록

중요 결정의 상태·ADR 링크와 작은 결정을 관리한다. 현재 구조·공통 규칙은 [design.md](design.md), 선택 배경·대안·이유·영향은 각 ADR을 기준으로 한다. 기존 `DEC-*` ID는 요구사항·작업·과거 기록과의 연결을 위해 유지한다. ADR 번호는 기존 DEC 번호를 따른다.

## ADR 목록

| 결정 ID | 결정 | 상태 | ADR | 대체 관계 |
| --- | --- | --- | --- | --- |
| `DEC-001` | 제품 형태는 반응형 웹서비스 | Accepted | [ADR-001](docs/adr/001-responsive-web.md) | — |
| `DEC-002` | 학습 이력은 사용자별 별도 저장소가 기준 | Accepted | [ADR-002](docs/adr/002-per-user-learning-records.md) | — |
| `DEC-003` | 대화 흐름의 핵심 규칙 | Partially Superseded | [ADR-003](docs/adr/003-conversation-rules.md) | 명시 종료만 허용한 부분은 DEC-024의 외부 환경 중단 후 자동 종료 예외로 대체 |
| `DEC-004` | 경쟁 서비스 분석의 증거 기준 | Superseded | [ADR-004](docs/adr/004-research-evidence.md) | DEC-006에 의해 대체 |
| `DEC-005` | 현재 상태와 날짜별 작업 기록을 분리 | Accepted | [ADR-005](docs/adr/005-work-status-and-daily-records.md) | — |
| `DEC-006` | REA를 제외하고 첫 학습 흐름부터 구현 | Accepted | [ADR-006](docs/adr/006-prototype-first.md) | DEC-004를 대체 |
| `DEC-007` | 기능 구현과 엔지니어링 검증을 함께 진행 | Accepted | [ADR-007](docs/adr/007-incremental-engineering-validation.md) | — |
| `DEC-008` | 서비스 부담의 실시간 음성 AI와 제한된 학습 맥락 | Partially Superseded | [ADR-008](docs/adr/008-realtime-ai-and-context.md) | 학습 상태 책임 부분은 DEC-010으로 대체, 나머지는 유지 |
| `DEC-010` | AI의 학습 진행 판단과 앱의 상태 기록·복원 | Accepted | [ADR-010](docs/adr/010-ai-led-learning-app-records.md) | DEC-008의 학습 상태 책임 부분 대체 |
| `DEC-011` | MVP의 대화 중 AI 판단 교정 | Accepted | [ADR-011](docs/adr/011-mvp-in-conversation-correction.md) | DEC-010의 미정 MVP 교정 모드 확정 |
| `DEC-012` | 전체 대화 임시 보관과 요약·학습 항목·원문 근거 보관 | Accepted | [ADR-012](docs/adr/012-temporary-transcripts-and-learning-evidence.md) | DEC-002·DEC-010의 기록 범위 구체화, 종료 후 AI 일괄 선별·임시 원문 최대 24시간/성공 즉시 삭제 후속 합의 포함 |
| `DEC-013` | 대화와 학습 진행 상태의 주기적 묶음 저장 | Accepted | [ADR-013](docs/adr/013-periodic-batch-recording.md) | DEC-010·DEC-012의 저장 빈도·복원 범위 구체화 |
| `DEC-014` | 공개 가입과 제한된 무료 체험 | Accepted | [ADR-014](docs/adr/014-public-signup-limited-trial.md) | DEC-008의 무료 체험 방향 구체화 |
| `DEC-015` | 첫 로컬 구현의 Next.js와 TypeScript | Accepted | [ADR-015](docs/adr/015-nextjs-typescript-local-prototype.md) | DEC-006·DEC-007의 개발 접근 구체화 |
| `DEC-016` | 로컬 AI 후보 실험 총 3만 원과 데이터·로그 범위 | Accepted | [ADR-016](docs/adr/016-local-ai-experiment-budget-and-data.md) | DEC-008·DEC-012의 로컬 실험 조건 구체화 |
| `DEC-017` | 무료 체험 1개월·유료 기간 제한 없는 학습 기록 보관 | Accepted | [ADR-017](docs/adr/017-plan-based-learning-record-retention.md) | DEC-012·DEC-014의 지속 학습 기록 보관 기간 구체화, 학습 종료 후 30일·유료 전환 후속 합의 포함 |
| `DEC-018` | 구독 만료 후 기존 유료 학습 기록 유지·조회·다운로드 | Accepted | [ADR-018](docs/adr/018-learning-records-after-subscription-expiry.md) | DEC-017의 미정 구독 종료 후 처리 구체화 |
| `DEC-019` | MVP 사용자 삭제 기능은 회원 탈퇴로 한정 | Accepted | [ADR-019](docs/adr/019-mvp-account-deletion-scope.md) | DEC-017·DEC-018의 삭제 기능 범위 구체화 |
| `DEC-020` | 이메일 링크 로그인·마지막 이용 후 30일 유지·로그인 링크 10분 | Accepted | [ADR-020](docs/adr/020-email-link-login-and-session-retention.md) | DEC-014의 로그인 방식·DEC-019의 탈퇴 본인 확인 구체화, 링크 일회성 후속 합의 포함 |
| `DEC-021` | 탈퇴 즉시 차단·24시간 이내 일괄 삭제·백업 7일 이내 삭제 | Accepted | [ADR-021](docs/adr/021-scheduled-account-deletion-and-backup-deadlines.md) | DEC-019·DEC-020의 탈퇴 처리·백업 기한 구체화 |
| `DEC-023` | 미경험 상황 우선과 질문 내용 반복 회피 | Accepted | [ADR-023](docs/adr/023-diverse-scenarios-and-question-content.md) | DEC-008의 제한된 맥락 선택 기준 구체화 |
| `DEC-024` | 외부 환경 중단 후 24시간 자동 종료·노트 생성 | Accepted | [ADR-024](docs/adr/024-auto-close-interrupted-session-after-one-day.md) | DEC-003의 절대적 명시 종료 규칙에 예외 추가, DEC-010의 종료 실행 범위 구체화 |
| `DEC-025` | 앱의 휘발성 음성 처리·공급자 모델 학습 금지·최대 30일 보관 | Accepted | [ADR-025](docs/adr/025-ephemeral-audio-and-provider-retention.md) | DEC-008·DEC-016의 음성 처리·공급자 조건 구체화 |
| `DEC-026` | 앱 직접 관리 이메일 링크·세션 인증 | Accepted | [ADR-026](docs/adr/026-app-managed-email-link-authentication.md) | DEC-020의 인증 구현 책임 구체화 |
| `DEC-027` | 임시 전체 대화 글의 앱 복원용 백업 제외 | Accepted | [ADR-027](docs/adr/027-exclude-temporary-transcripts-from-backups.md) | DEC-012의 임시 원문 백업 범위 구체화 |
| `DEC-028` | 지속 작업 목록과 정시 실행 | Accepted | [ADR-028](docs/adr/028-durable-scheduled-work-list.md) | DEC-012/021/024의 작업 실행 방식 구체화 |
| `DEC-029` | OpenAI Realtime·Gemini Live 동일 사례 비교 | Accepted | [ADR-029](docs/adr/029-compare-two-live-audio-candidates.md) | DEC-016의 실험 후보 범위, 최종 공급자 미채택 |
| `DEC-030` | 직접 음성 경로 우선, 필요 시 중계 비교 | Accepted | [ADR-030](docs/adr/030-validate-direct-voice-path-first.md) | DEC-008의 경로 검증 순서, 최종 경로 미채택 |

## 작은 결정

## DEC-022 · 필요한 노트의 개별 다운로드

- 결정일: 2026-10-21
- 상태: Accepted
- 동의 근거: 사용자가 “다운은 그냥 노트1개씩 개별로 선택해서 필요한것만 다운받을 수 있게하자”라고 명시했다.
- 결정과 이유: 날짜별 Markdown 노트 중 필요한 노트 하나를 선택해 개별 다운로드한다. 여러 노트 일괄 다운로드와 비교해 선택·다운로드 구현 범위를 줄이고 사용자가 필요한 것만 받도록 한다. 여러 노트를 받으려면 각각 내려받아야 한다.
- 영향과 한계: PRD F-12·8절과 B-06의 다운로드 범위를 구체화한다. 앱의 AI 참고 기록 저장·선택 정책과 구독 만료 후 기존 유료 노트 다운로드 권한은 변경하지 않는다. 구현·파일 생성 검증은 아직 없다. 다운로드 이후 사용자 기기에 저장된 사본은 앱의 탈퇴/만료 삭제 대상이 아니다.


## DEC-009 · 현재 설계·결정 목록·ADR의 역할 분리

- 결정일: 2026-10-20
- 상태: Accepted
- 동의 근거: 사용자가 엔지니어링 문서 보강안을 승인하면서 세 문서의 역할·ADR 분리 기준을 명시했다.
- 결정과 이유: `design.md`에는 현재 구조와 기술적 가정·제약, 이 파일에는 ADR 링크·상태와 작은 결정, `docs/adr/NNN-제목.md`에는 중요한 선택의 배경·대안·이유·영향을 둔다. 설명을 복제하지 않고 연결해 현재 설계와 과거 선택 이유를 각각 찾도록 한다.
- 영향: 문서 위치와 링크를 관리하는 작업이 추가된다. 제품 범위나 기술 스택을 변경하지 않는다. DEC-005의 작업 상태·현재 진행·날짜별 기록 분리는 유지한다.

## 기록·변경 규칙

여러 구성 요소에 영향을 주거나, 되돌리기 어렵거나, 선택 이유를 나중에도 설명할 필요가 있으면 ADR로 분리한다. 단순 변수명이나 쉽게 바꿀 설정값까지 ADR로 만들지 않는다. 작은 결정은 이 파일에 날짜·상태·동의 근거·결정과 이유를 짧게 남긴다. 영향이 커지면 ADR로 옮기고 기존 항목에는 링크를 남긴다.

중요 결정은 대안과 영향을 논의하고 명시적 동의를 받은 뒤 Accepted로 기록한다. 미확정 제안은 `docs/proposals/`에 둔다. 중요한 선택이 바뀌면 새 ADR을 작성하고 이전 ADR을 Superseded로 표시한다. 이 목록의 상태·대체 링크와 `design.md`의 현재 구조도 함께 갱신한다. 과거 승인 근거와 당시 내용을 지우지 않는다.

새 ADR 형식:

```md
# ADR-NNN · DEC-XXX · 제목

- 결정일:
- 상태: Accepted | Superseded
- 동의 근거:
- 배경·확정 제약·측정 근거:
- 검토한 대안과 장단점:
- 결정:
- 이유:
- 영향·단점: 비용·일정·사용자 경험·데이터·운영·연결 요구사항/작업
- 검증하지 못한 가정:
- 재검토 조건:
- 대체 관계: 이전/후속 ADR 링크
```
