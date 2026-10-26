# Talkie

한국어 화자를 위한 영어 회화 웹서비스 프로젝트입니다.

제품 요구사항은 [PRD.md](PRD.md), 작업별 문서 안내는 [AGENTS.md](AGENTS.md)를 참고하세요.

현재 구조·기술적 가정은 [design.md](design.md), 결정 상태·ADR은 [DECISIONS.md](DECISIONS.md), 측정·실험 방법은 [검증 설계](docs/design/engineering-validation.md)를 참고하세요.

## 첫 학습 흐름 실행

Node.js 22.12 이상(검증 환경: 24.22.0)에서 실행합니다.

```sh
cd app
npm ci
npm run dev
```

[http://127.0.0.1:3000](http://127.0.0.1:3000)에서 시나리오를 고르고 **대화 시작**을 누릅니다. 교정 시나리오는 답변 → 연습 표현 → 첫 재시도 실패 → 두 번째 성공 순서이며, 입력의 실제 영어 정확도를 판정하지 않습니다. 대화 종료 후 노트를 보고 `YYYY-MM-DD.md`로 다운로드할 수 있습니다. **데모 시나리오 확인**에서 다음 응답/노트 실패와 느린 응답을 시험합니다.

B-00은 가짜 AI·텍스트·브라우저 메모리만 사용합니다. 새로고침하면 기록이 사라지며, 실제 음성·AI·인증·영구 저장·날짜별 여러 세션 통합은 후속 작업입니다. API 키나 환경 변수는 필요하지 않습니다. 대화 입력은 외부 AI나 앱 서버로 보내지 않습니다. 화면의 최소 진단 정보도 최근 100개를 메모리에만 둡니다.

```sh
npm test                 # 상태 전이·중복·재개·노트 근거
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e          # Chromium PC·모바일 크기, 다운로드
```

Linux에서 브라우저 라이브러리가 부족하면 관리자 권한으로 `npx playwright install-deps chromium`이 필요할 수 있습니다. 테스트는 3100 포트를 사용합니다. 최적화 빌드 실행은 `npm run build` 후 `npm start`입니다.

구현 파일은 모두 `app/`에 둡니다. 위 npm·npx 명령은 `app/`에서 실행하며, 저장소 루트에서는 `npm --prefix app run dev`처럼 실행할 수도 있습니다.

```text
app/
├── src/                  # 화면·학습 처리
├── tests/                # 앱 테스트·브라우저 테스트 설정
├── package.json
├── package-lock.json
├── tsconfig.json
├── next.config.ts
└── next-env.d.ts
```

설치된 의존성 `app/node_modules/`, 빌드·개발 캐시 `app/.next/`, 테스트 산출물도 이 안에 생성됩니다. 개발 서버를 멈춘 뒤 `app/`에서 `npm run clean`으로 빌드·테스트 산출물을 지울 수 있습니다. 다음 실행 시 필요한 산출물은 다시 생성됩니다. 루트의 문서·환경 파일·Git 설정과 저장소 공통 보안 검사(`scripts/`, `tests/test_secret_check.py`)는 유지합니다.

## 로컬 인증·저장 시험

이 단계는 **합성 이메일(`.test`)·합성 대화와 가짜 AI**를 사용합니다. `/`의 메모리 데모는 그대로이며 `/account`에서 로그인하고 `/learn`에서 DB 저장을 시험합니다. 실제 메일 서비스·음성 AI·요금제 전환·운영 백업은 연결 전입니다.

Docker Engine과 Compose가 실행 가능한 환경에서 `app/`에서 실행합니다.

```sh
npm ci
npm run local:configure   # app/.env 생성, 독립된 DB 비밀번호 생성, 기존 파일 덮어쓰기 금지
npm run local:up          # PostgreSQL 두 인스턴스와 Mailpit
npm run db:migrate        # 각 DB에 검토된 SQL 마이그레이션 적용
npm run jobs              # 시작 시 누락된 정리 작업 처리
npm run dev
```

[계정 화면](http://127.0.0.1:3000/account)에서 `learner@example.test` 같은 주소로 요청하고 [Mailpit](http://127.0.0.1:8025)에서 링크를 엽니다. 대상 이메일을 확인하고 버튼을 누른 브라우저에 로그인됩니다. 자동 재발송·실패 전용 재요청 버튼은 없으며 기존 화면에서 30초 뒤 다시 요청할 수 있습니다.

[저장 학습 화면](http://127.0.0.1:3000/learn)은 확인 턴을 5초 간격으로 저장하고 새로고침 후 재개하며 중복 연결은 차단합니다. 연결 확인 15초·연결 유효 창 45초는 시험 초기값입니다. 메모리 창은 직렬화 기준 128 KiB/200턴으로 제한하고 미저장 단위가 빠지면 누락을 표시합니다. 이미 서버에 저장된 기록은 창 축소로 삭제하지 않습니다. 종료 후 저장이 성공하면 최근 사용자 발화 최대 세 개의 짧은 근거로 **가짜 노트**를 저장하고 임시 원문을 삭제합니다. 같은 한국 날짜의 노트는 파일 하나로 내려받습니다. 실제 AI의 선별·전체 P0 노트 형식·품질 완료를 뜻하지 않습니다.

자동 종료·노트 재시도/원문 정리·탈퇴·인증 만료 자료 정리에는 작업 실행기가 필요합니다. [service](app/scripts/systemd/talkie-jobs.service)·[timer](app/scripts/systemd/talkie-jobs.timer) 템플릿의 체크아웃 경로와 Node 경로를 확인한 뒤 사용자 systemd에 등록합니다. 현재 환경은 사용자 systemd bus가 없어 자동 등록·실행을 검증하지 못했고 `npm run jobs`로 작업 함수를 검증했습니다. 기기 종료 중 실행·큰 데이터의 처리 시간/기한 준수는 보장하지 않습니다.

Compose 포트는 루프백에만 공개하고 Mailpit 저장은 tmpfs입니다. DB의 별도 볼륨 이름/라벨만으로 호스트 백업에서 자동 제외되지는 않습니다. 실제 스냅샷/볼륨 백업 제외를 확인해야 합니다. `npm run local:down`은 DB 볼륨을 보존하고 Mailpit 시험 메일은 폐기합니다. `docker compose down -v`는 DB도 삭제하므로 일반 종료 명령으로 쓰지 않습니다.

실제 사용자 데이터 보관 전 앱/마이그레이션 DB 권한 분리·백업 자동 폐기·탈퇴/체험 만료 상태 재적용·정시 실행/삭제 기한·두 저장소 연결 손실의 추가 검증이 필요합니다. `npm run db:invalidate-restored-auth`는 과거 백업 복원 뒤 인증을 전체 무효화하며, 탈퇴 데이터 재적용까지 끝난 것으로 취급하지 않습니다. 원본 오류·SQL·메일·토큰은 로그에 출력하지 않습니다. 제품용 JSONL 로거·7일 삭제는 후속입니다.

서버 시험에는 초기화 가능한 별도 DB 이름을 `talkie_test_`로 시작하게 만들고 두 URL을 환경에 지정합니다. 일반 DB 초기화를 막기 위해 이름을 검사합니다.

```sh
npm run test:server
# PG_BIN_DIR에 pg_dump/pg_restore 경로를 지정하면 실제 백업·복원 시험도 수행
TALKIE_STORAGE_E2E=1 APP_ORIGIN=http://127.0.0.1:3100 npm run test:e2e -- storage.spec.ts
```

브라우저 시험은 실행 중인 두 시험 DB·SMTP가 필요합니다. Mailpit API 기본값은 `http://127.0.0.1:18025`이며 Compose를 쓰면 `MAILPIT_TEST_ORIGIN=http://127.0.0.1:8025`로 지정합니다. 단위 테스트는 `npm test`, 변경 SQL 생성은 `npm run db:generate`입니다. 생성 SQL을 검토한 뒤 적용하며 앱 요청/개발 서버 시작 때 스키마를 자동 변경하지 않습니다.

## DB에서 원문 생성·삭제 확인

스키마 변경 후 개발 서버·작업 실행기를 멈추고 `app/`에서 `npm run db:migrate`를 실행한 뒤 다시 시작한다. 이관은 각 DB별 트랜잭션이며 두 DB를 한 번에 커밋하지 않는다. 한쪽 실패 시 앱을 재개하지 말고 원인을 해결한 뒤 같은 명령으로 나머지 이관을 완료한다. DBeaver에서 연결을 새로고침한다. 기존 소유자 불일치·중복 작업·원문/이력 충돌은 이관을 실패시키며 임의 수정하지 않는다.

DEC-049의 현재 스키마는 지속 DB 7개(`users`, `email_auth_rate_limits`, `email_auth_requests`, `login_sessions`, `learning_sessions`, `learning_session_notes`, `scheduled_jobs`)와 임시 DB 2개(`transcript_session_states`, `transcript_saves`)다. 탈퇴 이메일 재확인은 유지하고 최종 허용 기한/사용 시각을 로그인 행에 저장한다. 계정 생성은 `account_created_at`, 탈퇴 확정은 `account_deletion_confirmed_at`이다.

지속 DB(5433)의 `learning_sessions.confirmed_save_sequence_number`는 저장 성공을 확정한 마지막 순번, `transcript_delete_deadline_at`은 원문 삭제 기한이다. 원문 DB(5434)의 `transcript_saves`에는 저장 순번별 `conversation_snapshot`과 재전송 확인용 `snapshot_hash`가 있다. 같은 대화가 여러 저장에 포함될 수 있으며 원문 복원은 확정 순번까지만 합친다. 종료 후 노트 저장 성공 또는 기한 만료로 원문 저장 행을 삭제한다.

원문이 사라진 뒤에도 상태 행에서 생성·삭제 사실을 확인할 수 있다.

```sql
SELECT learning_session_id, transcript_storage_created_at, first_nonempty_save_at,
       transcript_delete_deadline_at, source_deleted_at, source_deletion_reason
FROM transcript_session_states
ORDER BY transcript_storage_created_at DESC NULLS LAST;
```

- `transcript_storage_created_at`: 빈 원문 저장소 생성 시각.
- `first_nonempty_save_at`: 발화가 있는 데이터의 첫 임시 DB 저장 시각. 신규 행의 NULL은 아직 발화 저장이 없다는 뜻이며 지속 DB 저장 확정과는 구분한다.
- `transcript_delete_deadline_at`: 마지막 저장 때 복사한 기한. 지속 DB의 최초 종료 기한이 기준이며 이 보조값만으로 독립 삭제를 보장하지 않는다.
- `source_deleted_at`: 원문 저장 행의 실제 SQL 삭제 완료 시각. 삭제된 상태 행은 남아 있어도 이후 저장을 거절한다.
- `source_deletion_reason`: `note_saved`(노트 저장), `no_user_turns`(사용자 발화 없음), `deadline_expired`(기한 만료).

기존 원문의 알 수 없는 과거 시각은 NULL이며 변경 전에 이미 삭제된 원문은 이력도 복원할 수 없다. 상태에는 대화 내용을 남기지 않고 탈퇴/고아 정리 때 함께 삭제한다. 새 이관은 기존 저장 순번·해시·snapshot·확정 위치·탈퇴 권한을 보존한다.

## AI 후보 시험 하니스

음성 인식·텍스트 모델·음성 합성 후보를 직접 말하고 들어 비교하는 시험 전용 도구는 제품 코드와 분리해 `harness/voice-eval/`에 있습니다. 설치와 실행은 [하니스 README](harness/voice-eval/README.md), 공급자별 키 발급·결제·환경변수는 [PROVIDERS.md](harness/voice-eval/PROVIDERS.md)를 따릅니다. 합성 대화와 본인 음성만 사용하며 실제 사용자 데이터는 넣지 않습니다.

## 로컬 환경 변수와 커밋 점검

`.env`는 로컬 전용이며 Git에서 제외합니다. 인증·저장 앱의 변수 이름과 안전한 예시는 [app/.env.example](app/.env.example)을 따르며 실제 값은 Git 제외한 `app/.env`에 둡니다. 루트 [`.env.example`](.env.example)은 기존 공통 예시입니다. 구현 과정에서 변수가 생기면 예시 파일에는 변수 이름과 안전한 예시값만 추가하고, 실제 값은 `.env`에 둡니다. 이미 Git에 올라간 비밀값은 `.gitignore`만으로 제거되지 않으므로 해당 값을 폐기·재발급하고 Git 기록도 별도로 처리해야 합니다.

이 저장소의 커밋 전 검사 훅을 켭니다. [Gitleaks](https://github.com/gitleaks/gitleaks#installing)는 별도로 설치하거나 실행 파일을 `.tools/gitleaks`에 둡니다. Gitleaks가 없으면 커밋을 중단합니다. 현재 로컬 환경에는 공식 v8.30.1 배포 파일을 체크섬 검증 후 `.tools/gitleaks`에 설치했습니다.

```sh
git config --local core.hooksPath .githooks
```

커밋 훅은 민감한 파일명과 스테이징된 비밀값을 검사합니다. push 훅은 추적 중인 민감 파일명과 Git 이력의 비밀값을 다시 검사합니다. GitHub에서도 push와 pull request마다 두 검사를 실행합니다. 전체 커밋 이력은 `gitleaks git --redact .`로 별도 검사할 수 있습니다. 커밋 전에 `git diff --cached --name-only`와 `git diff --cached`도 확인하세요. 검사 도구와 GitHub push protection은 모든 비밀값이나 보안 취약 코드를 식별하지 못하므로 코드와 설정의 접근 권한, 사용자 데이터 노출, 서버 측 비밀값 사용 여부도 함께 검토합니다.
