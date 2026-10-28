# 로컬 API 계약

갱신일: 2026-10-28. 현재 로컬 합성 이메일·가짜 AI 저장 API와 비공개 음성 시험 API의 구현 설명이다. Google OAuth/OIDC 로그인 API와 운영 음성 API는 미구현이다. 로그인 조건은 [PRD 8.1](../PRD.md#81-가입로그인과-로그인-유지)을 따른다.

## 공통 요청·응답

- 라우트는 Node.js 런타임이며 JSON을 사용한다. 변경 요청의 실제 Host와 브라우저 Origin을 고정 로컬 origin과 대조하고 교차 출처 요청을 거부한다. 프록시 전달 헤더를 신뢰하지 않는다.
- POST는 `application/json` 객체만 받으며 본문은 최대 300 KiB다. 배열·잘못된 JSON·초과 본문은 거부한다. 이는 현재 입력 제한이며 운영 API 계약 확정을 뜻하지 않는다.
- 정상 응답은 각 action의 객체를 직접 반환한다. 실패는 `{error: "공개_오류_코드"}`와 HTTP 상태다. 알려지지 않은 예외는 `SERVICE_UNAVAILABLE`/503으로 바꾸며 공급자 오류 원본·SQL·본문·쿠키를 노출하지 않는다.
- 인증·개인 기록 응답은 `Cache-Control: no-store, private`, `Referrer-Policy: no-referrer`를 사용한다. 쿠키 설정과 인증·소유자 확인은 [인증 설계](AUTHENTICATION.md)를 따른다.

구현: [HTTP 공통 처리](../../app/src/server/http.ts), [로컬 입력 설정](../../app/src/server/config.ts). 응답 필드는 현재 코드와 대조한 설명이며 새 공통 envelope를 채택한 것이 아니다.

## 계정 API

구현: [account 라우트](../../app/src/app/api/account/route.ts), [인증 서비스](../../app/src/server/auth.ts).

`GET /api/account`는 로그인한 계정의 `{emailAddress}`를 반환하고 로그인 쿠키를 갱신한다.

`POST /api/account`는 다음 `action`을 받는다. 인증이 필요한 동작은 유효한 로그인 쿠키를 함께 요구한다.

| action | 요청 필드 (action 외) | 정상 응답·쿠키 |
| --- | --- | --- |
| `request` | `emailAddress`, `purpose: login 또는 account_deletion` | `{accepted: true}`. 탈퇴 목적은 본인 로그인 필요. SMTP 수신자 전달 완료의 증거는 아님 |
| `inspect` | `authLinkToken` | `{emailAddress, purpose}`. 링크 유효성·대상 조회이며 소비하지 않음 |
| `confirm` | `authLinkToken` | `{purpose}`. 로그인 목적이면 새 로그인 쿠키, 탈퇴 재확인이면 기존 브라우저의 세션에 권한 연결 |
| `logout` | 없음 | `{ok: true}`, 로그인 쿠키 제거 |
| `delete` | 없음 | `{ok: true}`, 로그인 쿠키 제거. 기존 로그인과 탈퇴 재확인 권한 필요 |

링크 화면의 GET은 인증을 소비하지 않는다. 로그인 상태의 다른 계정을 자동 교체하지 않으며 탈퇴 재확인은 원래 요청한 브라우저에 귀속한다. 처리 순서·기한 판정은 [인증 흐름](AUTHENTICATION.md#이메일-링크와-세션-처리)을 따른다.

## 학습 API

구현: [learn 라우트](../../app/src/app/api/learn/route.ts), [학습 서비스](../../app/src/server/learning.ts), [브라우저 조회 타입](../../app/src/learning/types.ts). 과거 `/api/learning` alias는 제공하지 않는다.

`GET /api/learn`은 로그인한 계정의 `{emailAddress, sessions, notes}`를 반환한다. 세션은 `learningSessionId`·`learningSessionStatus`·`noteGenerationStatus`·`learningSessionEndedAt`, 노트는 `learningEndDateKst`·`noteMarkdown`을 포함한다. 서버 응답의 종료 시각은 브라우저 조회 타입에 명시된 필드 집합보다 넓다. 만료 노트와 다른 계정의 기록은 조회하지 않는다.

`POST /api/learn`은 모두 로그인 쿠키를 요구한다.

| action | 요청 필드 (action 외) | 정상 응답 |
| --- | --- | --- |
| `start` | `scenario` (`correction` 또는 `conversation`) | `{learningSessionId, learningConnectionToken, confirmedSaveSequenceNumber, demoScenario, conversationSnapshot}`. 진행 대화가 있으면 재개 조건 확인 |
| `save` | `learningSessionId`, `learningConnectionToken`, `saveSequenceNumber`, `conversationSnapshot` | `{confirmedSaveSequenceNumber}` |
| `end` | `learningSessionId`, `learningConnectionToken` | `{learningSessionEndedAt}` |
| `heartbeat`, `pause` | `learningSessionId`, `learningConnectionToken` | `{ok: true}` |
| `note` | `learningSessionId` | `{ok: true}`. 본인 세션의 가짜 노트 정리이며 연결 토큰은 요구하지 않음 |

`ConversationSnapshot`의 구조는 런타임 타입, 저장 JSON의 구형 키·해시 호환성은 [DB 저장 형식](DATABASE.md#저장-json과-이관-호환성), 저장·재시도·종료 순서는 [학습 저장 설계](LEARNING-PERSISTENCE.md)를 따른다.

## 비공개 음성 토큰 API

`POST /api/voice/token`은 `{testOnly: true}`와 로그인 쿠키를 받아 `{voiceConnectionToken, testDurationSeconds}`를 반환한다. 현재 시험 시간은 180초다. 로그인·동일 출처·무료 시험 설정과 발급 간격을 확인한 뒤 서버가 공급자에 단기 연결 토큰을 요청한다. 브라우저에는 장기 API 키를 전달하지 않는다.

구현: [voice/token 라우트](../../app/src/app/api/voice/token/route.ts), [토큰 발급](../../app/src/server/voice-token.ts). 무료 여부의 수동 확인·직접 연결 제한은 [음성 설계](VOICE.md)를 따른다. Google 소셜 로그인과 Gemini 공급자 연결 토큰은 별개다.

## 주요 오류와 미정 범위

| HTTP 상태 | 코드 예시·의미 |
| --- | --- |
| 400 | `INVALID_REQUEST` 등 JSON/필드 오류, `INVALID_LINK`·`EXPIRED_LINK`·`USED_LINK`·`REPLACED_LINK` 등 링크 오류 |
| 401 | `LOGIN_REQUIRED` |
| 403 | `FORBIDDEN_ORIGIN`, `ORIGINAL_BROWSER_REQUIRED`, `VOICE_TEST_DISABLED`, `VOICE_TEST_ACK_REQUIRED` |
| 404 | `NOT_FOUND` |
| 409 | `LOGOUT_FIRST`, `ALREADY_CONNECTED`, `CONNECTION_EXPIRED`, `SESSION_CLOSED`, `SESSION_CLOSING`, `SAVE_SEQUENCE_CONFLICT`, `RECORD_UNAVAILABLE` |
| 413 / 415 | `REQUEST_TOO_LARGE`·`RECORD_TOO_LARGE` / `JSON_REQUIRED` |
| 429 | `WAIT_30_SECONDS`, `VOICE_TEST_WAIT` |
| 503 | `SERVICE_UNAVAILABLE`, `VOICE_KEY_REQUIRED`, `VOICE_TOKEN_UNAVAILABLE` |

이 표는 주요 사례이며 전체 오류 목록의 복사본이 아니다. 런타임 입력 검증·응답 변환은 연결한 코드를 기준으로 대조한다. 운영 음성 API·재연결·비용 초과 계약과 Google 계정 연결 정책은 미정이다. 생성 내용과 실제 재생 범위를 구분하고, 취소 뒤 늦은 응답이 확인 기록을 바꾸지 않는 제약은 [음성](VOICE.md)·[학습 저장](LEARNING-PERSISTENCE.md) 설계에 둔다.
