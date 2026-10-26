# DB 스키마 개편 재개 메모

2026-10-25 승인 후속: 사용자가 탈퇴 권한/원문 상태 통합과 명명 변경 적용을 승인했다. 최종 용어는 `transcript_saves`, `save_sequence_number`, `confirmed_save_sequence_number`, `conversation_snapshot`, `snapshot_hash`이며 batch 후보를 대체한다. 현재 계약은 [ADR-049](../adr/049-clear-database-names-and-merged-session-state.md)와 [design](../../design.md)을 따른다. 아래 미승인 표시는 당시 검토 상태이며 예약 실행기 전면 개편·delta 저장·미확정 재개 복구 계약 변경은 계속 후속이다.

2026-10-24 · **미승인 제안, 구현·마이그레이션 미착수.** 사용자는 검토 내용을 다음에 이어갈 수 있게 정리하도록 요청했다. 이 메모 작성은 개편안 채택을 뜻하지 않는다. 관련 작업: D-02/B-01/B-05/B-06.

2026-10-25 후속: 테이블별 판단·정합성·인덱스·저장 비용·클로드와의 의견 교환은 [양방향 검토](database-schema-review-2026-10-25.md)에서 이어간다. 아래 표는 당시 후보이며 최종 채택 범위는 문서 상단의 승인 후속과 ADR-049를 따른다.

## 유지할 경계

- 지속 기록/임시 원문의 별도 PostgreSQL 인스턴스·볼륨과 원문 백업 제외(DEC-034), 인증 상태의 지속 DB 저장(DEC-035), 원문 수명 이력(DEC-048)을 유지한다.
- 로그인·탈퇴·원문/노트 보관 정책은 바꾸지 않는다. 테이블 수는 우선 11개를 유지한다.
- 계정, 이메일 인증 요청, 로그인 세션, 학습 세션은 생성 시점·개수·수명이 달라 분리한다. 노트는 원문 삭제 후 보관하며, 수명 이력은 원문 삭제 후에도 남겨야 하므로 각각 분리한다.

## 변경 후보

| 현재 | 제안 | 이유 |
| --- | --- | --- |
| `auth_challenges` | `email_auth_requests` | 일회성 이메일 인증 요청이라는 역할을 드러냄 |
| 위 테이블의 `session_id`, `delivery` | `auth_session_id`, `email_send_status` | 로그인 세션과 발송 시도 결과임을 명확히 함. `accepted`는 `smtp_accepted`로 변경 후보 |
| 인증 목적 `delete` | `account_deletion` | 탈퇴 재확인 목적을 구체화 |
| `auth_request_controls` | `email_auth_rate_limits` | 이메일별 공통 30초 요청 간격 제어 |
| `deletion_confirmations` | `account_deletion_confirmations` | 로그인과 별개인 탈퇴 재확인 권한임을 명확히 함 |
| `transcript_versions.version`, `digest` | `transcript_batches.batch_number`, `content_hash` | 수정 이력이 아니라 순서 있는 저장 묶음 |
| `learning_sessions.version` | `confirmed_batch_number` | 지속 DB에서 확정한 저장 위치 |
| `transcript_sessions`의 `version`, `digest`, `payload` | 제거 | 현재 생성 시 초기값만 기록하고 이후 갱신하지 않음. 저장·복원은 버전 테이블 사용 |
| `session_notes`의 소유자 관계 | 학습 세션과 `(session_id, user_id)` 복합 FK 검토 | 사용자 FK와 세션 FK만으로는 소유자 일치를 강제하지 못함 |
| 상태·목적·작업 종류 | 허용값 CHECK 등 제약 보강 | 현재 text이며 허용값은 앱에서 관리 |

`users`, `auth_sessions`, `learning_sessions`, `session_notes`, `transcript_lifecycle`의 역할은 유지한다. 탈퇴 재확인 권한은 로그인 세션에 컬럼으로 합칠 수도 있지만, 별도 권한·수명이라는 의미를 위해 분리 유지 추천이다.

## 저장 묶음을 유지하는 이유

브라우저의 최근 기록 창에서 오래된 발화가 빠져도 이미 저장된 묶음을 합쳐 전체 확인 기록을 복원해야 한다. 임시 DB 커밋 후 지속 DB 확정이 실패하면 확정 번호까지만 복원하고, 미확정 묶음은 같은 번호·내용으로 재시도한다. 따라서 단순 최신 원문 덮어쓰기로 대체하지 않는다. `transcript_sessions`는 저장 잠금·삭제 기한·삭제 후 늦은 저장 차단용 제어 행으로 남긴다.

`email_send_status`는 수신함 도착 증거가 아니다. 발송 후 DB 갱신 전 종료되면 `pending`이 남을 수 있다. 현재 1회 발송 계약에서는 별도 메일 발송 테이블을 추가하지 않는다.

## 예약 작업 정리

관찰: 탈퇴 작업은 행을 만들지만 실행기는 `users.deleted_at`으로 처리하고, 자동 종료는 세션 스캔, 노트는 작업 예정 시각도 사용한다. 실행 기준이 혼재한다.

제안: DEC-028에 맞춰 `scheduled_jobs`가 실행 대상·예정 시각·재시도를 관리하고, 업무 상태는 사용자/학습 세션에서 재검증한다. 상태 스캔은 누락 작업 복구용으로 둔다. 최소 `status`, `attempt_count`, `next_attempt_at`을 검토하고, 작업 종류별 생성·취소·완료·재시도 규칙을 먼저 정한다. 사용자 대상(NULL session)과 세션 대상 작업의 중복 방지 제약을 분리한다. 여러 실행기의 소유·유효 기한은 필요 시 추가한다. 오류 원문 대신 허용 오류 코드만 사용한다.

## 다음 착수 순서와 검증

1. 이 제안과 현재 코드의 차이를 재확인하고 이름·분리 유지·예약 작업 범위를 사용자와 합의한다. 영향 큰 변경은 동의 후 DECISIONS 규칙에 맞춰 기록하고 design의 현재 계약을 먼저 갱신한다.
2. 이름 변경/미사용 컬럼 제거와 예약 작업 개편을 나눠 구현한다. 기존 마이그레이션을 고치지 않고 새 마이그레이션으로 데이터·순번·해시·확정 위치를 보존한다. 기존 행의 제약 위반과 대기 작업 이관을 사전 점검한다.
3. 중복 저장·다른 내용 거부·임시 DB만 커밋된 상태의 복구·최근 창 축소 후 복원, 탈퇴/기한 만료/노트 완료 후 늦은 저장 차단, 노트 소유자 일치, 작업 중복/실패/재시작을 검증한다.
4. 해당 TASK 수용 기준과 문서를 대조하고 PROGRESS/CHANGELOG/당일 worklog를 갱신한다. 전체 기능 완료로 확대하지 않는다.

이름·중복 제거보다 예약 작업 개편의 구현/검증 부담이 크다. 추가 서비스 도입은 없으며 성능·저장량 개선과 일정은 미측정이다.

## 확인 근거

- 현재 정의: [지속 스키마](../../app/src/server/db/schema.ts), [임시 스키마](../../app/src/server/db/transcript-schema.ts)
- 동작: [인증](../../app/src/server/auth.ts), [저장·복원](../../app/src/server/learning.ts), [정리 실행기](../../app/src/server/maintenance.ts)
- 기존 회귀 시험: [server.test.ts](../../app/tests/server.test.ts). 이번 검토에서는 실행하지 않았다.
- 정책: [DECISIONS](../../DECISIONS.md), [현재 설계](../../design.md), [지속 작업 목록 ADR](../adr/028-durable-scheduled-work-list.md)
