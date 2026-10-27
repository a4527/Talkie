# 코드 명명 일관성 점검 · 2026-10-27

상태: **사용자 적용 요청으로 N01~N19 반영·검증 완료.** 아래 표는 점검 당시 이름과 적용 방향을 보존한다. 저장 JSON 키는 호환성 경계에서 유지하며 코드/API는 새 이름을 사용한다. 제품 기능·공급자 선정·데이터 보관 정책의 완료나 변경을 뜻하지 않는다.

## 범위와 판단 기준

- 제품 `app/src` 31개 파일의 화면·API·학습·서버·DB·음성 이름을 읽고 호출/타입/필드 연결을 대조했다. 앱 스크립트 6개·시험/설정 8개, 하니스 Python 모듈 11개와 CLI/설정/시험의 관련 이름도 검색·대조했다. 루트 비밀값 검사 도구·환경변수 예제·Compose/Drizzle 설정의 명명도 확인했다. 외부 패키지 소스의 이름은 수정 후보에서 제외했다.
- 기준은 현재 구조인 [design](../../design.md), DB 명명 합의 [ADR-049](../adr/049-clear-database-names-and-merged-session-state.md), 음성 경계 DEC-055다. 개인정보/비밀값을 담을 수 있는 실제 `.env`·DB 행·개인 사용자 파일 `untitled.md`는 이번 명명 점검에서 읽지 않았다.
- 문제는 같은 개념이 경계마다 이름을 바꾸거나, 서로 다른 개념에 같은 모호한 이름을 사용하는 경우다. 모든 짧은 변수·단수/복수·프레임워크 예약어를 기계적으로 바꾸지 않는다.
- A: 코드 내부 이름·파일/참조 변경. B: 브라우저/API 계약 변경. C: 저장된 JSON/장부 호환성 검토 필요. 일부 후보는 A/B/C가 함께 적용된다.

## 점검 당시 이름과 적용 방향

| ID | 현재 이름·확인 위치 | 문제 | 권장 방향 | 영향 |
| --- | --- | --- | --- | --- |
| N01 | `app/learn/page.tsx`의 `/learn`과 `app/api/learning/route.ts`의 `/api/learning` | 화면과 API를 대응시킬 때 학습 기능만 이름이 달라진다 | 외부 경로는 `/learn`·`/api/learn`으로 맞춘다. `fetch`, `sendBeacon`, 브라우저 시험, 현행 문서까지 함께 변경한다 | B |
| N02 | `server/learning.ts`의 `id` 반환, 화면 `Runtime.id`, 요청 `id`, 도메인 `Session.sessionId`, DB `learningSessionId` | 같은 학습 세션 식별자가 여러 이름으로 변한다 | `learningSessionId`로 연결한다. ID 생성 함수인 `LearningSession` 생성자의 `id`는 `createId`로 구분한다 | A/B; `sessionId`는 현재 저장 snapshot 본문에 포함되지 않으므로 그 변경 자체는 C가 아님 |
| N03 | 로그인 쿠키 `raw`/`secret`, 학습 시작 반환 `secret`, 저장 요청 `connection`, 음성 반환 `token` | 서로 다른 자격 증명이 모두 비슷한 이름이라 혼동하기 쉽다 | 각각 `loginSessionToken`, `authLinkToken`, `learningConnectionToken`, `voiceConnectionToken`으로 구분한다. 반환/요청/변수 이름을 대상별로 연결한다. DB 해시 이름은 유지한다 | A/B |
| N04 | `learning/types.ts`의 `Session`, `Request`, `Reply`, `Provider`, `Phase`, `Metric`, `Scenario` | 웹의 `Request`·다른 세션·새 `VoicePort`와 문맥 없이 구분하기 어렵다 | `LearningSessionState`, `LearningRequest`, `LearningReply`, `LearningProvider`, `LearningPhase`, `LearningMetric`, `DemoScenario`처럼 대상을 명시한다. 클래스 `LearningSession`과 상태 타입을 구분한다 | A |
| N05 | `learn/page.tsx`의 `Records`와 `server/db/index.ts`의 `Records`; learn/voice 각각 `Runtime` | 같은 타입명이 조회 결과/DB 객체 또는 서로 다른 실행 상태를 뜻한다 | 화면 `LearningRecordsResponse`, DB `RecordsDatabase`, `RecordsTransaction`, 실행 상태 `LearningRuntime`/`VoiceRuntime`으로 구분한다 | A |
| N06 | 저장 타입 `Snapshot`, 필드 `conversationSnapshot`, 로컬 `payload`/`record`/`data`, 대화 단위 `Turn`, 음성 `VoiceRecord` | 저장 묶음·개별 턴·조회 목록이 모두 record 계열로 불린다 | 저장 묶음 타입은 `ConversationSnapshot`, 해당 로컬 값도 `conversationSnapshot`; 개별 음성 항목은 `VoiceTranscriptTurn`, `record.ts`는 `transcript.ts`, reducer는 `updateVoiceTranscriptTurns`로 맞춘다. 조회의 records는 목록 의미로 유지한다 | A; 저장 필드의 `conversationSnapshot`은 유지 |
| N07 | DB `learningSessionStatus`·`noteGenerationStatus`를 응답에서 `status`·`noteStatus`로 축약. 화면 상태 문구도 `status` | 상태의 대상이 경계에서 사라진다. UI 노트 상태와 DB 노트 상태는 값의 집합도 다르다 | API는 DB와 같은 명시적 상태명, 안내 문자열은 `statusMessage`. UI 전용 상태는 `noteGenerationStatus`와 별도 `ClientNoteGenerationStatus` 타입으로 구분한다. 값들을 하나의 enum으로 합치지 않는다 | A/B |
| N08 | `Turn.id`와 참조 `sourceTurnId`/`deliveredTurnId`/음성 이벤트 `turnId`; `Correction.id` | 정의에서는 `id`, 참조에서는 대상명이 붙어 추적이 끊긴다 | `turnId`·`correctionId`로 맞춘다. 음성 메모리 항목도 같은 `turnId` 사용 | A/C: 기존 저장 원문 JSON에 `id`가 포함됨 |
| N09 | `LearningState` 타입인데 필드는 `learning`, 누락 여부는 `gaps` | 상태 타입과 필드명이 어긋나고 누락 여부가 무엇인지 모호하다 | `learningState`, `hasConversationGaps`로 명확히 한다 | A/C: 저장 snapshot·초기 해시·과거 재전송의 호환성 검토 필요 |
| N10 | DB 핸들 `records`/`temporary`, 풀 `recordsPool`/`transcriptsPool`, 로컬 URL `durableUrl`/`temporaryUrl` | 같은 원문 DB가 temporary/transcript로 바뀌고 역할/수명 기준이 섞인다 | 핸들 `records`/`transcripts`, `recordsDatabaseUrl`/`transcriptsDatabaseUrl`, 생성 스크립트 비밀번호 변수도 `recordsPassword`/`transcriptsPassword`로 맞춘다. SQL·Compose 볼륨·실제 접속 설정은 유지 | A |
| N11 | DB 파일 `schema.ts`·`transcript-schema.ts`와 설정 `drizzle.records.config.ts`·`drizzle.transcripts.config.ts` | 두 DB 스키마 중 하나만 파일명에 대상이 드러난다 | `records-schema.ts`·`transcripts-schema.ts`, 관련 파일 `transcripts-lifecycle.ts`로 맞추고 Drizzle 설정/import를 함께 갱신한다 | A; 기존 SQL migration 이름/내용은 수정하지 않음 |
| N12 | HTTP 유틸 `body`, `response`, `failure`, `string`, `COOKIE`, `config`, `emailKey` | 파싱·검증·응답 생성 등 동작이 이름에서 드러나지 않고 emailKey는 실제 키가 아니라 검증/정규화한 주소를 반환한다 | 예: `readJsonBody`, `jsonResponse`, `errorResponse`, `requireString`, `LOGIN_SESSION_COOKIE_NAME`, `getLocalConfig`, `normalizeTestEmailAddress`. 출처 검사 등 기존 동작은 유지 | A |
| N13 | 계정 `accountAction`, 학습 화면 함수 `api`, 음성 화면 inline fetch; 계정 파일 `messages`에 학습 오류도 포함 | 같은 요청 역할이 서로 다르게 명명되고 공통 오류 문구의 소속이 잘못 드러난다 | 함수 `requestAccountAction`·`requestLearningAction`·`requestVoiceConnectionToken`. `messages`는 공통 `api-error-messages.ts`의 `apiErrorMessages`, 음성 전용 오류는 `voiceErrorMessages`로 구분. 클라이언트 모듈 추출은 필요 최소한으로 수행 | A |
| N14 | `heartbeat`, `listRecords`, `finalize`, `finishNote`, `owned`, `connection`, `demoMarkdown`, `koreaDate`, `markdown` | 다른 파일에서 가져왔을 때 대상·동작이 불분명하다 | `updateLearningHeartbeat`, `listLearningRecords`, `finalizeLearningNote`(트랜잭션 내부), `completeLearningNote`(인증 포함), `requireOwnedLearningSession`, `requireLearningConnection`, `buildDemoNoteMarkdown`, `formatKstDate`, `renderNoteMarkdown` 등으로 구분 | A |
| N15 | `LiveCredential`, `GEMINI_MODEL`, `geminiSetup`, `gemini-setup.ts`, `inputId`/`outputId`/`lastOutputId` | Gemini Live 전용인지 일반 음성/Gemini 설정인지 드러나지 않고 이벤트 `turnId`와 내부 ID 이름이 다르다 | `GeminiLiveCredential`, `GEMINI_LIVE_MODEL`, `createGeminiLiveSetup`, `gemini-live-setup.ts`; `inputTurnId`/`outputTurnId`/`lastOutputTurnId` | A |
| N16 | 토큰 응답 `seconds`, 쿠키 `maxAge`, 음성 `sampleRate`, `nextTime`, UI `ack`, 계정 `current` | 기간·주파수·동의 대상·현재 값의 대상이 드러나지 않는다 | `testDurationSeconds`, `maxAgeSeconds`, `sampleRateHz`, `nextPlaybackTimeSeconds`, `hasAcceptedVoiceTestConditions`, `currentEmailAddress`. 표준 Web API의 `sampleRate`/`maxAge` 필드는 그대로 매핑 | A/B |
| N17 | 하니스 `Entry.id` ↔ 함수 인자 `entry_id` ↔ 결과 `ledger_entry`; 저장 시각 `ts` | 같은 장부 항목 ID가 세 이름이고 시각도 대상이 모호하다 | `LedgerEntry`/`entry_id`/`ledger_entry_id`, 장부 `reserved_at`, 시험 결과 `recorded_at`처럼 구분 | A/C: `ledger.json`·`results.jsonl`의 기존 파일 읽기/보존 필요 |
| N18 | 하니스 `spent_krw()`가 예약액도 합산 | 실제 지출만 반환하는 함수로 오해할 수 있다. 구현은 예약액 포함이며 버그라고 단정하지 않는다 | `committed_krw()`처럼 확정·예약 포함 의미를 나타내고 로그·report·시험을 함께 갱신. 기간/한도 계산 방식은 변경하지 않는다 | A |
| N19 | 계정/조회 응답 `email`, 노트 `date`·`markdown`과 DB `emailAddress`·`learningEndDateKst`·`noteMarkdown` | 같은 값이 DB→응답→화면에서 축약되고 날짜의 기준도 사라진다 | `emailAddress`, `learningEndDateKst`, `noteMarkdown`으로 전달한다. 일반 날짜 함수 인자까지 일괄 변경하지 않으며 노트 날짜의 한국 종료일 의미를 보존한다 | A/B; 기존 Markdown 본문이나 SQL 컬럼은 변경하지 않음 |

## 그대로 유지할 구분

- 외부 URL의 `learn`은 화면 동작 이름, 내부 `learning/`·`LearningSession`은 학습 도메인 이름이다. URL을 맞춘다는 이유로 모든 `learning`을 `learn`으로 치환하면 타입·문서가 오히려 부자연스러워진다. 외부 경로끼리, 내부 도메인 이름끼리 일관되게 한다.
- `server/auth.ts`는 계정 인증이라는 책임명이다. `/account`와 동일 철자가 아니라고 자동으로 파일을 바꿀 근거는 없다. 계정 삭제 함수가 함께 있는 책임 분리는 별도 설계 문제이며 이번 명명 정리에서 코드를 대규모 재배치하지 않는다.
- 로그인 세션·학습 세션·공급자 음성 연결은 서로 다른 수명/권한을 가진다. 모두 `session`이나 `token` 하나로 합치지 않는다. UI의 `phase`와 DB의 학습 세션 상태, 전사 생성 완료와 실제 재생 완료도 구분한다.
- `page.tsx`, `route.ts`, `layout.tsx`, HTTP `GET`/`POST`, `useSyncExternalStore`의 `getSnapshot`, Web Audio/WebSocket/Google/Pipecat API 필드는 외부 규약이다. 그 철자를 내부 스타일에 맞춰 바꾸지 않는다.
- TypeScript camelCase/PascalCase, Python snake_case, SQL snake_case, TypeScript 파일 kebab-case는 언어별 관례로 유지한다. Python 모듈 `voice_eval`과 폴더 `voice-eval`도 정상이다.
- `user`(학습자 역할)·`assistant`(AI 역할), 계정 `userId`, `account` 화면의 구분은 유지한다. 다만 `demoMarkdown`의 사용자 발화 배열 `users`는 `userTurns`, 유지보수 집계 `accounts`/`sessions`는 `deletedAccountCount`/`processedSessionCount`처럼 실제 내용을 드러내도록 로컬 변수 후보에 포함한다.
- DEC-049로 채택한 SQL 컬럼과 과거 migrations/스냅샷은 기준이다. 단순 미관을 이유로 새 SQL rename이나 과거 migration 재작성을 하지 않는다. 예를 들어 `sourceDeletedAt`은 이미 채택한 원문 삭제 사건 이름이므로 이번에는 유지한다.
- `GOOGLE_API_KEY`는 앱/하니스가 이미 동일하게 사용한다. `TALKIE_VOICE_TEST`와 `VOICE_EVAL_*`는 제품 시험과 독립 후보 하니스라는 서로 다른 범위다. Google 문서의 `GEMINI_API_KEY` 표기와 다르다는 이유로 실제 키 변수·환경 파일을 일괄 변경하지 않는다.
- `tx`, `sql`, `pcm`, `stt`, `llm`, `tts`와 짧은 콜백 변수는 역할이 분명한 범위에서 유지한다. 도메인 경계를 넘는 `id`/`secret`과 같은 수준의 문제로 보지 않는다.

## 변경 순서와 검증 계획

1. N01의 화면/API 경로부터 맞추고 모든 호출·sendBeacon·현재 문서·시험을 갱신한다. 이전 주소를 다른 도메인으로 남겨 두지 않는다. 호환 alias 필요 여부는 로컬 실행 중인 구버전 탭/클라이언트 사용 여부에 따라 판단한다.
2. A 항목의 내부 타입·함수·파일·로컬 변수 이름을 묶어서 변경한다. 경로 이름을 맞추는 데 불필요한 파일 이동·로직 변경·추상화 추가는 제외한다. 사용 중인 `server-only`/단위·통합 시험 mock/import 경계를 함께 확인한다.
3. N02/03/07/16의 API 필드를 브라우저와 서버에서 동시에 변경한다. 현재 별도 정의된 화면 조회 타입을 서버 응답과 같은 명시적 계약으로 정리해 재발을 줄일 수 있다. 구현을 공유 타입으로 이동하는 경우 필요한 필드만 브라우저에 노출하며 서버 모듈을 클라이언트에서 import하지 않는다.
4. C 항목(N08/09/17)은 무조건 치환하지 않는다. `conversation_snapshot`은 JSON이고 `snapshotHash`는 직렬화 내용으로 계산한다. 키 rename만 해도 과거 행·기존 순번의 재전송 검증에 영향을 준다. 이름 통일이 데이터 보존/재전송 계약을 바꾸지 않도록 기존 JSON 읽기·검증·해시 보존/이관 방식을 먼저 구체화한다. 이관 필요성·기존 DEC와 충돌이 있으면 해당 부분만 별도 논의한다. 장부도 이름 변경 때문에 누적 비용이 초기화되면 안 된다.
5. 실제 변경 후 타입·빌드, 학습/음성/라우트 단위 시험, 별도 합성 DB 서버 시험, 관련 PC/모바일 브라우저 시험, 하니스 pytest를 변경 범위에 맞춰 수행한다. 저장 필드 변경에는 과거 형식 복원·동일 저장 순번 재전송·장부 누적 보존을 검증한다. 명명 정리 검증에 유료 호출·실제 사용자 데이터는 필요하지 않다.

## 조사 결과의 한계

- 런타임 장애·성능·품질 점검이 아니라 정적 명명 감사다. 최초 조사 단계에서는 관련 코드를 바꾸지 않아 앱 시험을 실행하지 않았다. 적용 후 검증은 아래와 당일 worklog를 따른다.
- N01~N19은 발견한 이름 패턴의 묶음이며 변수 19개만 바꾼다는 뜻이 아니다. 실제 변경 시 타입 참조·시험·현행 설명까지 연결해 파일별 변경 목록을 산출한다. 루프의 모든 단문 변수까지 전부 장문으로 바꾸는 계획은 아니다.
- 부수적으로 계정 화면의 “실제 AI와 음성은 연결 전” 안내와 루트 환경변수 예제의 “변수명 미정” 문구가 현재 구현과 다름을 발견했다. 이는 명명 문제와 별도인 현행 설명 보정 후보이며 제품 동작 변경은 아니다. 과거 날짜의 worklog/CHANGELOG는 당시 이름을 역사로 보존한다.

## 적용 결과 · 2026-10-27

- N01~N07/N10~N16/N19: API·브라우저·도메인·서버·시험의 이름을 함께 갱신했다. `/api/learn`만 제공하며 구버전 탭은 새로고침한다. HTTP `Request`/`Response`, 쿠키·Web Audio·Google wire 필드, SQL/환경변수/Compose 이름은 유지했다.
- N08/N09: 런타임 타입과 API의 턴/교정/상태/누락 필드는 새 이름이다. 서버의 `validateConversationSnapshot`과 `encodeStoredConversationSnapshot`이 기존 JSON과 연결한다. 새 저장도 기존 키 순서와 기본값으로 직렬화해 기존 해시·초기 저장·재전송 계약을 유지한다. 기존 데이터·migration을 변경하지 않았고 추가 데이터 정책/이관 결정은 필요하지 않았다.
- N17/N18: 장부의 구형 이름을 읽고 누적액·순번·시각을 보존한 채 다음 쓰기에서 새 이름으로 저장한다. 결과는 신/구 이름을 함께 읽고 기존 유효 행을 재작성하지 않는다. 예산 집계와 보관 기한 계산은 유지한다.
- 부수 설명 보정: 계정 화면의 음성 미연결 문구와 루트 `.env.example`의 변수 미정 안내를 현재 실행 경로로 갱신했다. 공통 오류 문구는 `client/api-error-messages.ts`로 분리했다.

직접 변경 파일은 다음 묶음에서 확인한다. 기존 음성 구현과 문서 수정은 보존했으며 커밋·스테이징은 하지 않았다.

| 범위 | 파일/연결 |
| --- | --- |
| 화면/API/클라이언트 | `app/src/app/page.tsx`, `account/page.tsx`, `account/confirm/page.tsx`, `learn/page.tsx`, `voice/page.tsx`, `api/account/route.ts`, `api/learn/route.ts`(이동), `api/voice/token/route.ts`, `components/conversation.tsx`, `client/account.ts`, `client/api-error-messages.ts`(추출), `client/voice.ts`(추출) |
| 학습 | `app/src/learning/{types,session,buffer,note,fake-provider}.ts` |
| 서버/DB | `app/src/server/{auth,config,http,learning,maintenance,voice-token}.ts`, `db/index.ts`, `db/records-schema.ts`·`db/transcripts-schema.ts`·`db/transcripts-lifecycle.ts`(이동) |
| 음성 | `app/src/voice/port.ts`, `transcript.ts`·`gemini-live-setup.ts`(이동), `browser-audio.ts`, `adapters/gemini-live.ts` |
| 앱 실행/시험 | `app/drizzle.records.config.ts`, `app/drizzle.transcripts.config.ts`, `app/package.json`, `app/scripts/{configure-local,database,smoke-voice}.ts`, `app/tests/{learning,server,voice,voice-route,naming-contracts}.test.ts`, `app/tests/browser/{storage,voice}.spec.ts` |
| 하니스 | `harness/voice-eval/bot.py`, `voice_eval/{ledger,results,report,session}.py`, `tests/test_ledger.py`, `README.md` |
| 기준/진행 문서 | `design.md`, `README.md`, `.env.example`, `PROGRESS.md`, `CHANGELOG.md`, 본 제안서, 당일 worklog. 이동 소스에 직접 연결된 `database-schema-refactor.md`·`database-schema-review-2026-10-25.md`는 링크 대상만 보정 |

검증: 앱 단위/라우트 **30개**, 독립 PostgreSQL 합성 서버 **24개**(구형 JSON 복원·동일 순번 재전송·해시 보존·실제 백업/복원 포함), PC/모바일 Chromium **16개**, 하니스 pytest **24개** 통과. 타입 검사·제품 빌드도 확인했다. 유료 호출·실제 사용자 데이터·실제 장치 시험은 수행하지 않았다. 환경 조건·최종 문서 대조는 [당일 worklog](../worklogs/2026-10-27.md#적용--코드-명명-일관성)를 따른다.
