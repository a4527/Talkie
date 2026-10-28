# DB 스키마 양방향 검토

2026-10-25 승인 후속: 사용자가 탈퇴 권한/원문 상태 통합과 명명 변경 적용을 승인했다. 최종 용어는 `transcript_saves`, `save_sequence_number`, `confirmed_save_sequence_number`, `conversation_snapshot`, `snapshot_hash`이며 batch 후보를 대체한다. 현재 계약은 [ADR-049](../adr/049-CLEAR-DATABASE-NAMES-AND-MERGED-SESSION-STATE.md)와 [design](../DESIGN.md)을 따른다. 아래 미승인 표시는 당시 검토 상태이며 예약 실행기 전면 개편·delta 저장·미확정 재개 복구 계약 변경은 계속 후속이다.

2026-10-25 · 미승인 검토 제안. [재개 메모](DATABASE-SCHEMA-REFACTOR.md)를 기준으로 현재 작업 폴더의 미커밋 구현까지 읽었다. 코드·스키마·마이그레이션·DB 데이터는 변경하지 않았다. 관련 작업은 D-02/B-01/B-05/B-06이며 완료 상태를 바꾸지 않는다.

## 검토 범위와 판단 기준

기준은 [지속 스키마](../../app/src/server/db/records-schema.ts), [임시 스키마](../../app/src/server/db/transcripts-schema.ts), [인증](../../app/src/server/auth.ts), [학습 저장·복원](../../app/src/server/learning.ts), [정리 실행기](../../app/src/server/maintenance.ts), [수명 기록](../../app/src/server/db/transcripts-lifecycle.ts), [브라우저 저장](../../app/src/app/learn/page.tsx)과 기존 마이그레이션·서버 시험이다. 실행 중 DB의 카탈로그·행 수·실행 계획은 조회하지 않았다. 따라서 실제 DB와 코드의 일치, 실제 병목·절감량은 미확인이다. 테스트도 이번 읽기 전용 검토에서 실행하지 않았다.

효율성은 테이블 수보다 수명 경계, 잘못된 관계를 DB가 차단하는지, 실제 조회 조건, 저장 중복과 반복 처리량으로 판단한다. DEC-028/034/035/048의 지속 작업·두 인스턴스·인증 저장·원문 수명 이력 경계와 PRD의 로그인/재개/보관/탈퇴 정책을 유지한다.

## 테이블별 검토

| 현재 테이블 | 판단·변경 후보 | 근거와 영향 |
| --- | --- | --- |
| `users` | 유지 | 계정 기준 행과 탈퇴 즉시 차단 표시가 필요하다. 이메일 unique를 유지한다. 결제/구독 모델은 이번 정리에 추가하지 않는다. |
| `auth_request_controls` | 역할 유지, `email_auth_rate_limits` 이름 후보 | 가입 전 이메일에도 적용하는 공통 30초 제한이므로 사용자 FK나 인증 요청 행에 합치지 않는다. |
| `auth_challenges` | `email_auth_requests`, 목적·발송 상태·세션 결합 CHECK 후보 | 로그인은 계정 생성 전 발급할 수 있어 사용자 FK를 필수로 만들면 안 된다. 탈퇴 요청만 인증 세션 ID가 필요하다. `delivery`는 SMTP 시도 결과이며 수신 증거가 아니다. |
| `auth_sessions` | 유지, `user_id` 인덱스 후보 | 여러 브라우저와 30일 갱신 수명. 계정 탈퇴 시 일괄 무효화·cascade가 사용자 조건으로 실행된다. |
| `deletion_confirmations` | 분리 유지, `account_deletion_confirmations` 이름 후보 | 로그인과 별도의 일회성·10분 권한. 현재 세션 PK/FK가 이미 적절하다. |
| `learning_sessions` | 유지, `version`→`confirmed_batch_number`, 사용자 인덱스·상태 CHECK 후보 | 지속 DB가 확정한 원문 위치가 필요하다. 진행 세션 부분 unique만으로는 종료된 세션 목록·정리 조회를 충분히 지원하지 않는다. |
| `session_notes` | 유지, 소유자 복합 FK·사용자/만료 인덱스·`date`형 후보 | 원문 삭제 후에도 남는 최종 결과. 세션당 한 노트인 PK는 현재 요구에 맞는다. 날짜는 한국 시간 종료일을 유지한다. |
| `scheduled_jobs` | 대상 제약과 실행 계약 보강 | 현재는 대상/예정 시각만 있고 상태·시도 이력이 없으며 실제 실행기는 대부분 업무 행을 스캔한다. 컬럼 추가만으로 해결되지 않는다. |
| `transcript_sessions` | guard 유지, 초기 `version/digest/payload` 제거 후보 | 세 열은 생성 시 빈 값만 넣고 저장 때 갱신하지 않는다. 행 존재·잠금·소유자·기한은 늦은 저장 차단에 사용한다. |
| `transcript_versions` | 묶음 유지, `transcript_batches`와 `batch_number/content_hash` 이름 후보 | `(session_id, version)` PK는 묶음 조회·재전송 키에 적절하다. 최근 창 축소와 임시 DB만 커밋된 상태를 복구한다. |
| `transcript_lifecycle` | 분리 유지, 사용자 인덱스·삭제 시각/사유 CHECK 후보 | 정상 원문 삭제 후에도 남아야 한다. guard에 cascade로 종속시키면 목적을 잃는다. 과거 미확인 시각의 NULL은 보존한다. |

11개 분리는 현재 수명·권한 경계상 타당하다. 11개를 영구 상한으로 고정할 근거는 없지만, 이번 검토에서 테이블 증감이 필요한 근거는 발견하지 못했다. 이름 변경은 이해 비용 개선이며 성능 개선으로 계산하지 않는다.

## 먼저 다룰 정합성

1. **노트와 작업의 소유자 일치.** 현재 노트의 `session_id`와 `user_id` FK는 각각 존재 여부만 확인한다. 다른 사용자의 세션과 사용자 조합도 스키마상 가능하다. `learning_sessions(id, user_id)` unique와 노트의 복합 FK를 검토한다. 작업의 세션 대상에도 같은 관계가 필요하다. 사용자 대상 작업은 세션 NULL을 허용하되 종류별 대상 CHECK를 둔다. 현재 앱 경로의 실제 계정 간 유출이 확인됐다는 뜻은 아니다. 기존 조합 위반 사전 조회와 추가 unique의 공간·쓰기 비용이 필요하다.
2. **NULL 작업 대상 중복.** `job_target(kind,user_id,session_id)`는 NULL이 있는 계정 대상 중복을 막지 않는다. 종류/사용자의 계정 대상 부분 unique와 종류/세션 대상 부분 unique로 나누거나 PostgreSQL 16의 `NULLS NOT DISTINCT`를 사용할 수 있다. 전자는 대상 구분이 명확하고 후자는 구조가 간단하다. 현재 탈퇴 경로는 사용자 잠금·`deleted_at` 검증으로 직렬화되므로 실제 중복 발생을 입증한 결함으로 쓰지 않는다.
3. **허용값·행 내부 관계.** 목적, 발송 상태, 학습/노트 상태, 작업 종류, 삭제 사유와 비음수 순번을 CHECK 후보로 둔다. 탈퇴 목적이면 인증 세션 필수·로그인 목적이면 NULL, 삭제 시각과 사유는 둘 다 NULL 또는 둘 다 존재하도록 명시한다. CHECK는 NULL 결과를 허용하므로 필수값에는 NOT NULL 또는 명시적 NULL 검사가 필요하다. `consumed_at`과 `revoked_at`은 현재 둘 다 존재할 수 있으므로 배타 조건을 임의로 추가하지 않는다. 두 DB의 서로 다른 시계 사이 순서를 CHECK로 강제하지 않는다.

인증 요청의 세션 FK 추가는 별도 판단이다. `ON DELETE CASCADE`는 인증 세션 정리 시 요청 행도 지워 보관·진단 의미를 바꿀 수 있고, 단순 RESTRICT는 정리를 막을 수 있다. 목적/세션 CHECK부터 검토하며 기존 효력 종료 후 24시간 이내 정리 계약과 삭제 순서를 확인한 뒤 선택한다.

## 인덱스와 실행기

우선 후보는 `learning_sessions(user_id)`, `auth_sessions(user_id)`, `session_notes(user_id, expires_at)`, 임시 DB의 `transcript_sessions(user_id)`와 `transcript_lifecycle(user_id)`다. 각각 목록/계정별 정리·일괄 무효화·유효 노트 조회/삭제·탈퇴 정리 조건에 대응한다. 소유자 복합 unique `(id,user_id)`는 선두가 `id`라 사용자별 조회 인덱스를 대체하지 않는다. PK/unique가 이미 만든 인덱스는 중복 추가하지 않는다.

`scheduled_jobs`는 현재 `kind/session_id`로 찾고 `due_at`은 찾은 뒤 비교한다. 실행기를 기한 작업 조회로 바꿀 때만 pending/retry 조건과 `next_attempt_at`에 맞는 인덱스를 함께 설계한다. 인증 정리의 `least(...)` 조건은 단순 `expires_at` 인덱스만으로 해결된다고 가정하지 않는다. JSON payload 내부 조건으로 검색하지 않으므로 GIN 인덱스를 추가할 근거도 없다. 작은 데이터에서는 순차 스캔이 더 저렴할 수 있으며 후보 전부를 일괄 추가하지 않는다.

현재 `maintenance`는 사용자 전체→학습 세션 전체→세션별 작업 조회, 이후 완료 세션의 원문 삭제 재시도와 수명 이력 전체의 고아 확인을 반복한다. 노트가 만료돼도 학습 행은 남아 반복 조회 대상이므로 장기 이용 시 비용 증가 가능성이 있다. 삭제 정책을 임의로 추가하기보다 실행 대상 쿼리·페이지 단위 처리·완료 원문 정리 확인·복구 스캔 주기를 먼저 설계한다.

예약 작업은 DEC-028 방향대로 실행 대상·기한·재시도 정보를 관리하고 업무 행을 잠근 뒤 현재 상태를 재검증하는 안을 추천한다. `status/attempt_count/next_attempt_at`의 의미, 생성/취소/완료/재시작·중복 규칙과 원문 정리 실패의 복구를 먼저 정의한다. 업무 스캔은 누락 복구용으로 남긴다. 여러 실행기용 소유/lease 컬럼은 동시 실행 방식이 정해진 뒤 선택한다. 오류는 허용 코드만 저장한다. 새 서비스 없이 구현 가능하나 이번 후보 중 구현·실패 시험 부담이 크다.

## 저장 묶음 비용과 보존할 계약

관찰: 브라우저는 내용이 바뀌면 최근 창 전체를 새 묶음으로 전송한다. `saveLearning`은 매 저장마다 확정 순번 이하의 모든 과거 payload를 읽어 턴 불변성을 검사한다. `readConfirmed`도 확정된 모든 묶음을 합친다. payload의 유효성 검사는 교정과 턴의 연결도 확인하므로 단순 행 수 이상의 처리량이 발생할 수 있다.

추정: 묶음당 크기가 일정한 조건에서도 N번 저장까지 과거 묶음 읽기 합계는 대략 `0+1+…+(N-1)`에 따라 늘어난다. 실제 바이트·시간은 대화/교정 수·창 크기·캐시에 달려 있으며 벤치마크 결과는 아니다. `version`을 `batch_number`로 바꾸는 것만으로 중복 저장은 줄지 않는다.

대안은 A 현재 snapshot 묶음 유지 후 계측, B 새 턴/변경 교정 중심의 delta와 주기적 checkpoint다. A는 복구 계약과 이관 부담이 작고 중복이 남는다. B는 중복·재검사를 줄일 가능성이 있으나 순서·누락·교정 갱신·동일 내용 해시·부분 커밋 복구가 복잡해진다. 우선 A로 합성 긴 대화의 저장 바이트/읽기 바이트·지연·잠금 시간을 측정하고 B는 별도 승인 대상으로 둔다. 최신 payload 하나로 덮어쓰거나 확정 전 묶음을 읽는 안은 기존 계약을 깨므로 추천하지 않는다.

이름 변경·미사용 열 제거 시에도 기존 묶음 번호/해시/확정 위치와 초기 0번 묶음을 보존한다. JSONB는 객체 키 순서를 보존하지 않으므로 DB에서 읽은 JSON을 임의 직렬화해 기존 content hash를 다시 계산하는 이관은 피한다. 원문을 새 지속 테이블·로그·백업에 복사하지 않는다.

## 도입 범위와 검증 제안

반론 교환 후 추천 순서는 ① 부분 커밋 후 메모리 소실 재개의 충돌 검증 ② 소유자/대상/허용값 제약 및 정리 대상 선별 ③ 실제 조회에 맞춘 인덱스 검증 ④ 예약 작업 실행·삭제 기한 상세 계약 개편 ⑤ 긴 대화 측정 후 저장 형식 개선 논의다. 명명·미사용 열 정리는 별도 작은 변경으로 병행할 수 있다. 기존 마이그레이션 수정 대신 새 이관을 사용하고 기존 행의 값·소유자·중복·날짜 형식을 사전 확인한다. `date`형 전환은 한국 시간 귀속을 바꾸지 않으며 잘못된 기존 문자열을 조용히 보정하지 않는다. 유료 보존의 `expires_at` nullable/구독 모델은 B-05의 미구현 기능으로 별도 설계한다.

승인 후 검증은 잘못된 소유자/허용값/NULL 대상 중복 거부, 기존 데이터 이관, 같은 번호/같은 내용 재전송·다른 내용 거부, 최근 창 축소·부분 커밋 복구, 원문 삭제 후 늦은 저장 차단, 작업 생성/취소/재시작·실패 재시도와 기한 불변을 포함한다. 인덱스는 합성 데이터의 규모/분포를 기록하고 EXPLAIN 및 쓰기 비용을 비교한다. 실제 사용자 원문이나 비밀값은 근거에 포함하지 않는다.

## 클로드와의 반론 교환

Orca의 Claude 검토자에게 독립 검토를 요청하고, Codex의 초기 판단·문서 초안을 전달한 뒤 Claude의 발견에 코드 근거로 답변했다. Claude의 최종 답변·초안 평가·성공 완료 보고를 수신했으며 아래 조정에 잔여 이견이 없음을 확인했다. 근거 추적은 Run `run_f8ae371f53b5`, Task `task_828182c52dd8`, Dispatch `ctx_840337f4a3fe`다. 모델 간 동의는 사용자 승인이나 실행 검증을 뜻하지 않는다.

| 쟁점 | Claude의 초기 의견 | Codex의 답변·검토 결과 |
| --- | --- | --- |
| 재시도 충돌 | 최근 창이 변하면 미확정 묶음의 hash가 달라져 영구 충돌할 수 있으므로 미확정 upsert 검토 | 같은 탭은 `pending.current`에 번호/내용을 고정해 재시도하므로 일반화할 수 없다. 다만 메모리 소실 재개는 아래 별도 위험이 있다. upsert 즉시 채택은 보류한다. |
| 예약 작업의 실효성 | 탈퇴 작업에 소비자가 없고 예약 행이 장식에 가깝다 | 탈퇴 작업의 미소비는 맞지만 노트 작업의 `due_at`은 `waiting_save` 처리에 실제 사용된다. 실행 기준 혼재로 정확히 표현하고, 전체 스캔 선별을 큰 실행기 개편 전에 검토한다. |
| 노트 소유자 | `notes.user_id`를 없애고 세션을 조인하면 소유자 불일치 자체를 없앨 수 있다 | 유효한 대안이다. 복합 FK는 직접 사용자 조회/삭제를 유지하고 인덱스 비용이 추가된다. 열 제거는 중복·추가 unique를 줄이는 대신 목록/정리 쿼리를 바꾼다. 현재 방식 유지+복합 FK를 우선 제안하되 선택 전 비교한다. |
| 인증 갱신 비용 | 매 인증의 사용자/세션 잠금과 UPDATE가 비싸므로 갱신 간격 확대·약한 잠금 검토 | 현재 잠금은 탈퇴·저장 직렬화의 일부다. 마지막 인증된 이용 후 정확한 30일 계약도 있으므로 계측 없이 바꾸지 않는다. `last_seen_at`은 현재 읽는 코드가 없지만 마지막 이용 시각의 의미가 있으므로 미사용 payload와 동급으로 제거하지 않는다. |
| 임시 guard의 기한 | 지속 DB 기한과 중복이며 단독 정리에도 쓰지 않으므로 제거 또는 독립 파기 보완 검토 | 현재 guard는 저장 때만 동기화되어 종료 직후 NULL일 수 있다. 독립적인 기한 준수 장치로 볼 수 없다는 지적에 동의한다. 기한의 기준은 지속 DB이고 보조값 갱신·양 DB 장애 시 삭제 계약은 별도 설계한다. |
| guard와 수명 이력 통합 | 수명 행을 guard로도 쓰면 테이블 하나를 줄일 수 있다 | 기술적으로 가능하지만 삭제된 수명 행을 저장 가능한 guard로 오인하지 않도록 모든 경로를 바꿔야 한다. 버전 cascade·삭제 멱등성·늦은 저장 경쟁 재검증 부담에 비해 현재 이득이 부족하다. |
| 고아/완료 행 스캔 | 삭제 완료 이력을 제외하면 처리량을 줄일 수 있다 | 매번 전체를 읽는 문제는 동의한다. 다만 학습 행이 없어진 삭제 이력도 고아 정리가 필요하므로 단순 영구 제외 대신 범위·주기·복구 조건을 함께 설계한다. |

**우선 검증할 복구 공백:** 확정 번호 1, 임시 DB에만 번호 2가 저장된 후 브라우저 메모리가 사라지면 재개 API는 1까지만 돌려준다. 새 화면의 `pending`은 비어 있고 새 저장은 번호 2를 사용한다. 그 내용이 임시 번호 2와 다르면 `VERSION_CONFLICT`가 반복될 수 있다. 기존 `server.test.ts`의 부분 커밋 복구 시험은 재개 후에도 테스트 변수가 원래 번호 2의 내용을 직접 재전송하므로 메모리 소실 경로를 검증하지 않는다. 코드상 경로를 확인했지만 실행 재현은 하지 않았다. 명명 변경보다 먼저 이 사례를 재현하고, 같은 번호 다른 내용 거절·확정분만 복원·이전 연결의 늦은 저장 차단을 보존하는 복구 계약을 논의해야 한다. generation이나 미확정 묶음 정리 등 대안은 아직 미승인이다.

이 반론에 따라 기능상 정합성·복구 검증과 정리 대상 선별을 명명 변경보다 우선한다. 이름 변경·미사용 열 제거는 별도 작은 변경으로 병행할 수 있지만 자동 생성 SQL의 drop/create 여부와 기존 데이터 보존을 직접 확인한다. 인증 잠금 축소·버퍼/묶음 상한·미확정 덮어쓰기는 이번 정리에 묵시적으로 포함하지 않는다.

## 사용자 후속 질문: 필요성과 명명·통합 대안

아래는 사용자 질문에 따른 추가 제안이며 기존 11개 유지 추천에 대한 재검토다. 테이블 수 유지 자체는 요구사항이 아니다. 탈퇴 이메일 재확인 제거·테이블 통합은 아직 승인되지 않았고 현재 코드·채택 결정은 바꾸지 않는다.

- `users.created_at`: 현재 인증·원문/노트 기한 계산에서 읽지 않는다. 기능 필수는 아니며 계정 생성 시점 확인용 메타데이터다. 유지한다면 `account_created_at`으로 명확히 한다. 체험 기록 30일은 학습 종료부터 계산하므로 이 열과 연결하지 않는다.
- 탈퇴 이메일 재확인: DEC-020/036과 PRD 8.1의 기존 계약. 장기간 로그인한 공유 기기나 유출 세션만으로 삭제하지 못하게, 현재 이메일 접근을 다시 확인하려는 목적이다. 메일 지연·추가 조작·발송 비용이 단점이다. 이메일 계정까지 탈취된 경우를 해결하지는 않는다. 재확인 유지와 저장 테이블 분리는 별도 선택이다. 민감 작업 재인증의 일반 근거는 [OWASP 인증 안내](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#require-re-authentication-for-sensitive-features)이며, Talkie의 이메일 방식·10분 수치를 의무화하는 자료는 아니다.
- 탈퇴 최종 권한: 로그인 세션당 최대 한 행, 같은 로그인 세션에서만 사용하므로 `auth_sessions`에 기한·사용 시각 두 열로 통합 가능하다. 권한 수명이 다르다는 이유만으로 별도 테이블이 필수는 아니다. 통합 시 만료/사용 권한 열을 독립적으로 정리해 DEC-046의 효력 종료 후 24시간 내 정리를 지키고, 재확인 시 초기화·최종 사용 시 원자적 소비·백업 복원 무효화를 유지해야 한다. 별도 테이블은 독립 정리/FK 경계가 단순하고 통합은 조인/테이블을 줄이는 대신 로그인 행에 선택적 상태가 추가된다. 단순화가 목적이면 통합안을 제안한다.
- 세 가지 `version`: `learning_sessions.version`은 지속 DB의 확정 위치, `transcript_versions.version`은 실제 묶음의 순번이다. 두 DB 중 임시 DB만 커밋됐을 때 구분해야 하므로 둘 다 필요하다. `transcript_sessions.version`은 초기 0에서 바뀌지 않아 제거 후보다. 문서 수정 이력이나 앱 버전이 아니다.
- 임시 DB 3개 분리: 상태/수명 행 하나와 여러 저장 묶음으로 2개 통합 가능하다. 통합 상태 행은 원문 삭제 후에도 남기고 `source_deleted_at IS NULL`인 경우만 저장을 허용한다. 삭제 시 부모 행 대신 모든 자식 묶음을 명시적으로 삭제하고 삭제 시각/사유를 같은 트랜잭션에 기록한다. 저장·삭제 모두 같은 상태 행을 잠그고 삭제 후 upsert 부활을 금지한다. 생성/첫 저장 시각의 과거 NULL·탈퇴/고아 정리는 보존한다. 현재 행 존재 자체로 저장을 차단하는 방식이 바뀌므로 경쟁 시험과 승인 후 이관이 필요하다. 별도 상태·수명 테이블은 현재 차단 규칙을 유지하고, 통합은 중복 식별자/테이블을 줄이는 대신 삭제 상태 검사를 모든 경로에 강제해야 한다.

두 통합을 모두 선택하면 지속 7개+임시 2개, 총 9개다. 서비스·인스턴스·백업 경계나 로그인/탈퇴 사용자 동작은 그대로 유지할 수 있지만, 데이터 이관·정리/복원·늦은 저장 회귀 시험 부담이 생긴다. 테이블 수 감소가 유의미한 성능/요금 절감을 보장하지 않으며 시간·절감량은 미측정이다. 원문을 한 행의 누적 JSON으로 합치는 1개 테이블안은 행 확대·재작성과 재전송/확정 경계 재설계 부담 때문에 이번 단순화안에 포함하지 않는다.

### 전체 명명 제안

원칙: 식별자에 도메인을 붙여 로그인 세션과 학습 세션을 구분하고, 시각에는 대상과 사건을 표시한다. 기한(`deadline`), 유효기간(`expires`), 실제 완료(`deleted`)를 구분한다. 아래는 현재 모든 SQL 컬럼을 대상으로 하며 같은 이름은 유지한다. 값/형식/기능 변경은 이름 변경과 분리한다.

| 현재 테이블 → 제안 | 현재 컬럼 → 제안 |
| --- | --- |
| `users` 유지 | `id` → `user_id`; `email` → `email_address`; `created_at` → `account_created_at`; `deleted_at` → `account_deletion_confirmed_at` |
| `auth_request_controls` → `email_auth_rate_limits` | `email` → `email_address`; `requested_at` → `last_auth_email_requested_at` |
| `auth_challenges` → `email_auth_requests` | `id` → `email_auth_request_id`; `email` → `email_address`; `purpose` → `authentication_purpose`; `token_hash` → `auth_link_token_hash`; `session_id` → `requesting_login_session_id`; `created_at` → `auth_link_issued_at`; `expires_at` → `auth_link_expires_at`; `consumed_at` → `auth_link_used_at`; `revoked_at` → `auth_link_invalidated_at`; `delivery` → `email_send_status` |
| `auth_sessions` → `login_sessions` | `id` → `login_session_id`; `user_id` 유지; `token_hash` → `login_token_hash`; `created_at` → `login_session_created_at`; `last_seen_at` → `last_authenticated_activity_at`; `expires_at` → `login_session_expires_at`; `revoked_at` → `login_session_invalidated_at` |
| `deletion_confirmations` → `account_deletion_authorizations`(분리 유지 시) | `session_id` → `login_session_id`; `expires_at` → `account_deletion_authorization_expires_at`; `consumed_at` → `account_deletion_authorization_used_at`; 통합 시 동일한 두 시각 열을 `login_sessions`로 이동 |
| `learning_sessions` 유지 | `id` → `learning_session_id`; `user_id` 유지; `status` → `learning_session_status`; `version` → `confirmed_transcript_batch_number`; `created_at` → `learning_session_started_at`; `interrupted_at` → `learning_session_interrupted_at`; `ended_at` → `learning_session_ended_at`; `transcript_delete_deadline_at` 유지; `note_status` → `note_generation_status`; `connection_hash` → `learning_connection_token_hash`; `lease_until` → `learning_connection_expires_at`; `scenario` → `demo_scenario` |
| `session_notes` → `learning_session_notes` | `session_id` → `learning_session_id`; `user_id` 유지; `date` → `learning_end_date_kst`; `markdown` → `note_markdown`; `expires_at` → `note_retention_expires_at` |
| `scheduled_jobs` 유지 | `id` → `scheduled_job_id`; `user_id` → `target_user_id`; `session_id` → `target_learning_session_id`; `kind` → `job_type`; `due_at` → `scheduled_run_at` |
| `transcript_sessions` → `transcript_storage_sessions`(분리 유지 시) | `session_id` → `learning_session_id`; `user_id` 유지; `version/digest/payload` 제거 후보; `transcript_delete_deadline_at` 유지 |
| `transcript_versions` → `transcript_save_batches` | `session_id` → `learning_session_id`; `version` → `transcript_batch_number`; `digest` → `batch_content_hash`; `payload` → `batch_snapshot` |
| `transcript_lifecycle` → `transcript_lifecycle_records`(분리 유지 시) | `session_id` → `learning_session_id`; `user_id` 유지; `created_at` → `transcript_storage_created_at`; `first_saved_at` → `first_nonempty_batch_saved_at`; `deleted_at` → `source_deleted_at`; `deletion_reason` → `source_deletion_reason` |

임시 상태·이력 통합 시 테이블명은 `transcript_session_states`를 제안한다. `learning_session_id`, `user_id`, `transcript_storage_created_at`, `first_nonempty_batch_saved_at`, `transcript_delete_deadline_at`, `source_deleted_at`, `source_deletion_reason`을 둔다. 저장 묶음은 `transcript_save_batches`에 유지한다. 기한 값이 마지막 저장 때만 복사되는 현재 한계는 통합/명명만으로 해결되지 않으며 갱신 계약을 별도로 정한다.

상태값은 `purpose=delete` → `authentication_purpose=account_deletion`, `delivery=accepted` → `email_send_status=smtp_accepted`를 제안한다. `demo_scenario`는 현재 합성 시험 분기라는 의미이며 실제 제품 시나리오 모델 채택을 뜻하지 않는다. API/TypeScript 이름·인덱스·FK·시험도 같은 용어로 맞춰야 하며, 기존 번호/해시/시각은 이름만 바꾸면서 보존한다.

## 외부 근거와 한계

- [PostgreSQL 16 제약](https://www.postgresql.org/docs/16/ddl-constraints.html): NULL unique 동작·NULLS NOT DISTINCT·복합 FK·CHECK의 NULL 처리 및 참조 측 인덱스의 별도 설계 근거. 실제 현재 행의 위반 여부를 증명하지 않는다.
- [PostgreSQL 16 복합 인덱스](https://www.postgresql.org/docs/16/indexes-multicolumn.html): 선두 열에 따른 조회 특성. 제시 후보의 속도 개선을 측정한 결과는 아니다.
- [PostgreSQL 16 JSON](https://www.postgresql.org/docs/16/datatype-json.html): JSONB 객체 키 순서 비보존. 현재 저장 해시 오류가 확인됐다는 뜻은 아니다.

문서는 Compose의 PostgreSQL 16 계열에 맞춰 확인했다. 공식 자료의 기능 사실과 Talkie에 적용할 추천·비용 추정을 구분한다.
