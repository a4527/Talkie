# 데이터베이스 설계

갱신일: 2026-10-29. 로컬 합성 인증·저장 구현의 현행 데이터 모델이다. [제품 보관·삭제 정책](../PRD.md#8-저장-데이터와-학습-노트)을 따른다. Google 로그인 관련 매핑 스키마와 유료 기록 전환은 아직 없다.

## 저장소와 스키마 경계

지속 기록과 임시 원문은 별도 PostgreSQL 인스턴스·볼륨·연결 풀을 사용한다. 인증 상태는 지속 DB의 별도 테이블에 둔다. 두 DB 사이 FK·단일 트랜잭션·동시 커밋을 가정하지 않는다. JSONB·행 단위 접근 정책을 전면 사용하는 결정은 아니다.

스키마의 정확한 열·타입·제약은 [records-schema.ts](../../app/src/server/db/records-schema.ts), [transcripts-schema.ts](../../app/src/server/db/transcripts-schema.ts)를 대조한다. DB 핸들은 `records`·`transcripts`, 타입은 `RecordsDatabase`·`RecordsTransaction`이며 연결은 [db/index.ts](../../app/src/server/db/index.ts)에서 관리한다. 서버 DB 코드는 `server-only`로 제한한다.

| DB | 테이블 | 역할·주요 관계와 제약 |
| --- | --- | --- |
| 지속 | `users` | 계정 ID·고유 이메일·가입·탈퇴 확정 시각 |
| 지속 | `email_auth_rate_limits` | 이메일별 발급 간격 제어. 이메일 PK |
| 지속 | `email_auth_requests` | 로그인/탈퇴 목적·링크 해시·발급/만료/소비/무효화·메일 상태. 해시 고유성, 목적과 요청 로그인 ID의 조합 및 발송 상태 CHECK |
| 지속 | `login_sessions` | 사용자 FK·고유 토큰 해시·수명·무효화·통합 탈퇴 권한. 사용자 인덱스, 권한 소비/만료 조건 CHECK |
| 지속 | `learning_sessions` | 사용자 FK·진행 상태·저장 확정 위치·연결 소유·종료/원문 기한·노트 상태. 계정당 active/interrupted 하나의 조건부 고유 인덱스와 상태/순번 CHECK |
| 지속 | `learning_session_notes` | 학습 세션당 노트·소유자·한국 종료일·보관 기한. 학습 세션/사용자 복합 FK로 소유자 일치, 사용자/만료 인덱스 |
| 지속 | `scheduled_jobs` | 계정/학습 세션 작업의 대상·종류·실행 시각. 소유자 FK·대상별 조건부 고유성·종류/대상 CHECK |
| 임시 | `transcript_session_states` | 학습/사용자 ID·생성/첫 저장·삭제 기한/완료 이력. 상태와 삭제 사유의 조합 CHECK. 지속 DB에 대한 FK는 없음 |
| 임시 | `transcript_saves` | 원문 snapshot과 해시·저장 순번. 상태 FK와 `(learning_session_id, save_sequence_number)` 복합 PK, 순번 CHECK |

선택 이유·범위는 [ADR-033](../adr/033-POSTGRESQL-FOR-DURABLE-RECORDS.md), [ADR-034](../adr/034-ISOLATED-POSTGRESQL-TEMPORARY-TRANSCRIPTS.md), [DEC-035](../DECISIONS.md#dec-035), 명명·통합 결정은 [ADR-049](../adr/049-CLEAR-DATABASE-NAMES-AND-MERGED-SESSION-STATE.md)에 둔다.

## 시각·권한·원문 이력

계정 생성 `account_created_at`, 탈퇴 확정 `account_deletion_confirmed_at`, 원문 삭제 기한 `transcript_delete_deadline_at`, 실제 원문 삭제 완료 `source_deleted_at`은 서로 다른 사건이다. 시각은 UTC 절대 시각으로 보관하며 한국 종료일은 노트 집계용 별도 값이다.

탈퇴 최종 권한은 `login_sessions.account_deletion_authorization_expires_at`·`account_deletion_authorization_used_at`에 둔다. 권한 효력 종료 후에는 이 열만 NULL로 정리해 유효 로그인을 유지한다. 권한 발급·소비는 [인증 흐름](AUTHENTICATION.md), 정리 실행은 [로컬 작업](LOCAL-OPERATIONS.md#기한-작업)을 따른다.

원문은 `transcript_saves.conversation_snapshot`에만 저장하고 상태에는 본문·교정·해시를 복사하지 않는다. 상태 행의 `transcript_storage_created_at`은 저장소 생성, `first_nonempty_save_at`은 비어 있지 않은 발화의 첫 임시 DB 커밋이며 지속 DB의 저장 확정 시각이 아니다. 과거 미확인 시각은 NULL로 유지한다.

삭제 사유는 `note_saved`·`no_user_turns`·`deadline_expired`다. 상태는 정상 원문 삭제 후에도 남고 탈퇴/고아 정리 때 삭제한다. 임시 볼륨 손실과 변경 전 이미 삭제한 원문의 이력은 복원하지 못한다. SQL 삭제 완료를 물리 소거의 증거로 취급하지 않는다. 삭제 원자성·재시도와 저장 차단은 [학습 저장 설계](LEARNING-PERSISTENCE.md#원문-삭제와-수명-경계)를 따른다.

## 저장 JSON과 이관 호환성

각 저장 행의 `save_sequence_number`는 재전송을 식별하는 저장 순번, 지속 학습 행의 `confirmed_save_sequence_number`는 저장 성공 확정 위치다. 호환성 유지 시 초기 0번·순번·`snapshot_hash`·대화·확정 위치와 과거 NULL 시각을 보존하고 기존 해시를 재계산하지 않는다. API/TypeScript도 저장 순번 용어를 사용한다. 두 DB 동시 커밋을 보장하거나 미확정 저장을 재개 근거로 쓰지 않는다.

런타임 `ConversationSnapshot`은 `turnId`·`correctionId`·`learningState`·`hasConversationGaps`를 사용하지만 저장 JSON은 기존 `id`·`learning`·`gaps` 키를 유지한다. 서버 경계에서 구형 JSON을 검증·정규화하고 저장 시 기존 검증기의 키 순서·기본값으로 직렬화한다. 기존 행·해시를 재작성하지 않고 같은 순번 재전송·다른 내용 거절 계약을 유지한다. 코덱은 [learning.ts](../../app/src/server/learning.ts)의 `validateConversationSnapshot`·`encodeStoredConversationSnapshot`이다.

DEC-049 DB 이관과 후속 런타임 명명 정리의 실제 변경·검증 결과는 각각 [2026-10-25](../worklogs/2026-10-25.md), [2026-10-27](../worklogs/2026-10-27.md)에 둔다.

## 접근·마이그레이션

Drizzle ORM·Drizzle Kit과 node-postgres(`pg`)를 사용한다(DEC-045). TypeScript 스키마에서 생성한 SQL은 검토·버전 관리 후 명시적으로 적용하며 지속/임시 DB의 스키마·SQL/메타데이터·이력을 분리한다. 일반 조회·저장은 ORM을 쓰고 필요한 잠금·제약·복잡한 조회는 매개변수화 SQL로 처리할 수 있다. ORM 타입은 런타임 검증·인증·소유자 확인을 대체하지 않는다.

현재 로컬 DB 소유자 역할과 앱 역할 분리는 후속이다. 운영 배포·권한·백업 정책 검증 완료를 뜻하지 않는다. 원문 백업 제외와 복원 한계는 [로컬 운영 구성](LOCAL-OPERATIONS.md#백업과-복원-경계), 저장 실패·두 DB 정합성은 [학습 저장](LEARNING-PERSISTENCE.md)을 따른다.

## 비공개 음성 저장 학습 구분

기존 `demo_scenario`는 저장 호환성을 위해 유지하며 `voice` 값을 추가해 음성 저장 학습을 구분한다. 기존 두 가짜 시나리오 값·snapshot JSON·해시는 유지한다. 제약 변경은 [추가 마이그레이션](../../app/drizzle/records/0003_light_logan.sql)이며 음성 전용 테이블이나 원본 음성 저장은 추가하지 않는다. 진행 중 음성/텍스트 세션을 다른 방식으로 자동 재개하지 않고 원래 방식에서 이어서 하도록 한다.
