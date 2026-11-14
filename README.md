# Talkie

한국어 화자를 위한 영어 회화 웹서비스 프로젝트입니다.

작업별 문서 안내는 [AGENTS.md](AGENTS.md)를 참고하세요.

## 첫 학습 흐름 실행

Node.js 22.12 이상(검증 환경: 24.22.0)에서 실행합니다.

```sh
cd app
npm ci
npm run dev
```

[http://127.0.0.1:3000/try](http://127.0.0.1:3000/try)에서 시나리오를 고르고 **대화 시작**을 누릅니다. 교정 시나리오는 답변 → 연습 표현 → 첫 재시도 실패 → 두 번째 성공 순서이며, 입력의 실제 영어 정확도를 판정하지 않습니다. 대화 종료 후 노트를 보고 `YYYY-MM-DD.md`로 다운로드할 수 있습니다. **데모 시나리오 확인**에서 다음 응답/노트 실패와 느린 응답을 시험합니다.

B-00은 `/try`에서 가짜 AI·텍스트·브라우저 메모리만 사용합니다. 루트는 랜딩이며 로그인 앱은 `/home`·`/talk`로 이어집니다([화면 통합 기록](docs/worklogs/2026-11-02.md#로컬-앱-데모-통합)). 새로고침하면 기록이 사라지며, 실제 음성·AI·인증·영구 저장·날짜별 여러 세션 통합은 후속 작업입니다. API 키나 환경 변수는 필요하지 않습니다. 대화 입력은 외부 AI나 앱 서버로 보내지 않습니다. 화면의 최소 진단 정보도 최근 100개를 메모리에만 둡니다.

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

로컬 시연용 앱 데모입니다(DEC-068). 메일은 **합성 이메일(`.test`)과 Mailpit**을 사용하고 실제 메일 서비스·요금제 전환·운영 백업·공개 배포는 연결하지 않았습니다.

| 화면 | 내용 |
| --- | --- |
| `/` | 소개·시작하기. `/try`는 로그인 없이 가짜 튜터와 텍스트로 체험(메모리만 사용) |
| `/login` | 이메일 링크 로그인, Google 설정 시 Google 로그인 |
| `/home` | 오늘 대화 시작 또는 멈춘 대화 이어서 하기, 학습 요약, 최근 노트 |
| `/talk` | 음성 대화(Gemini Live 또는 분리형 STT·LLM·TTS 선택) 또는 텍스트 연습. 종료 후 그 대화의 피드백 노트 |
| `/notes`, `/notes/날짜` | 날짜별 노트와 Markdown 다운로드 |
| `/account` | 로그인 수단·Google 연결/해제·로그아웃·탈퇴 |

이전 `/learn`·`/voice` 주소는 `/talk`로 이동합니다. 음성 대화에는 아래 [Gemini Live 비공개 음성 시험](#gemini-live-비공개-음성-시험)의 서버 설정이 필요하며, 없으면 텍스트 연습만 동작합니다.

Docker Engine과 Compose가 실행 가능한 환경에서 `app/`에서 실행합니다.

```sh
npm ci
npm run local:configure   # app/.env 생성, 독립된 DB 비밀번호 생성, 기존 파일 덮어쓰기 금지
npm run local:up          # PostgreSQL 두 인스턴스와 Mailpit
npm run db:migrate        # 각 DB에 검토된 SQL 마이그레이션 적용
npm run jobs              # 시작 시 누락된 정리 작업 처리
npm run dev
```

[로그인 화면](http://127.0.0.1:3000/login)에서 `learner@example.test` 같은 주소로 요청하고 [Mailpit](http://127.0.0.1:8025)에서 링크를 엽니다. 대상 이메일을 확인하고 버튼을 누른 브라우저에 로그인됩니다. 자동 재발송·실패 전용 재요청 버튼은 없으며 기존 화면에서 30초 뒤 다시 요청할 수 있습니다.

### Google 로그인 설정(선택)

Google 로그인·연결 정책은 [DEC-067](docs/adr/067-GOOGLE-ACCOUNT-LINKING-AND-REAUTH.md)을 따릅니다. 설정하지 않으면 로그인 화면에 Google 버튼이 나타나지 않습니다.

1. [Google Cloud 콘솔](https://console.cloud.google.com/apis/credentials)에서 OAuth 동의 화면을 만들고(테스트 사용자에 본인 계정 추가), OAuth 클라이언트 ID를 **웹 애플리케이션** 유형으로 만듭니다.
2. 승인된 리디렉션 URI에 `APP_ORIGIN` + `/api/auth/google/callback`을 그대로 등록합니다. 기본값은 `http://127.0.0.1:3000/api/auth/google/callback`입니다. 브라우저도 같은 주소(`127.0.0.1`)로 엽니다.
3. `app/.env`에 `GOOGLE_OAUTH_CLIENT_ID`·`GOOGLE_OAUTH_CLIENT_SECRET`을 넣고 `npm run db:migrate` 후 개발 서버를 재시작합니다. 비밀값은 Git·문서·채팅에 남기지 않습니다.

Google로 처음 로그인하면 Google 이메일로 새 계정이 만들어지며, 이미 같은 이메일의 `.test` 계정은 없으므로 보통 충돌하지 않습니다. 기존 이메일 계정에 Google을 붙이려면 이메일로 로그인한 뒤 `/account`에서 `Google 계정 연결`을 누릅니다. Google로 가입한 계정의 탈퇴는 `Google로 본인 확인` 후 확정합니다. 로컬 DB에는 Google 사용자 식별자와 이메일만 저장하고 토큰은 저장하지 않습니다.

명명 정리 후 학습 API는 `/api/learn`이다. 이전 코드로 열린 탭은 새로고침한다. 기존 DB JSON·해시·환경변수는 유지하므로 이번 변경을 위한 DB 이관은 필요하지 않다. 상세 계약은 [코드·API 명명과 저장 호환성](docs/design/API.md)을 따른다.

[대화 화면](http://127.0.0.1:3000/talk)의 텍스트 연습은 확인 턴을 5초 간격으로 저장하고 새로고침 후 재개하며 중복 연결은 차단합니다. 연결 확인 15초·연결 유효 창 45초는 시험 초기값입니다. 메모리 창은 직렬화 기준 128 KiB/200턴으로 제한하고 미저장 단위가 빠지면 누락을 표시합니다. 이미 서버에 저장된 기록은 창 축소로 삭제하지 않습니다. 종료 후 저장이 성공하면 최근 사용자 발화 최대 세 개의 짧은 근거로 **가짜 노트**를 저장하고 임시 원문을 삭제합니다. 같은 한국 날짜의 노트는 파일 하나로 내려받습니다. 실제 AI의 선별·전체 P0 노트 형식·품질 완료를 뜻하지 않습니다.

자동 종료·노트 재시도/원문 정리·탈퇴·인증 만료 자료 정리에는 작업 실행기가 필요합니다. [service](app/scripts/systemd/talkie-jobs.service)·[timer](app/scripts/systemd/talkie-jobs.timer) 템플릿의 체크아웃 경로와 Node 경로를 확인한 뒤 사용자 systemd에 등록합니다. 현재 환경은 사용자 systemd bus가 없어 자동 등록·실행을 검증하지 못했고 `npm run jobs`로 작업 함수를 검증했습니다. 기기 종료 중 실행·큰 데이터의 처리 시간/기한 준수는 보장하지 않습니다.

Compose 포트는 루프백에만 공개하고 Mailpit 저장은 tmpfs입니다. DB의 별도 볼륨 이름/라벨만으로 호스트 백업에서 자동 제외되지는 않습니다. 실제 스냅샷/볼륨 백업 제외를 확인해야 합니다. `npm run local:down`은 DB 볼륨을 보존하고 Mailpit 시험 메일은 폐기합니다. `docker compose down -v`는 DB도 삭제하므로 일반 종료 명령으로 쓰지 않습니다.

실제 사용자 데이터 보관 전 앱/마이그레이션 DB 권한 분리·백업 자동 폐기·탈퇴/체험 만료 상태 재적용·정시 실행/삭제 기한·두 저장소 연결 손실의 추가 검증이 필요합니다. `npm run db:invalidate-restored-auth`는 과거 백업 복원 뒤 인증을 전체 무효화하며, 탈퇴 데이터 재적용까지 끝난 것으로 취급하지 않습니다. 원본 오류·SQL·메일·토큰은 로그에 출력하지 않습니다. 제품용 JSONL 로거·7일 삭제는 후속입니다.

서버 시험에는 초기화 가능한 별도 DB 이름을 `talkie_test_`로 시작하게 만들고 두 URL을 환경에 지정합니다. 일반 DB 초기화를 막기 위해 이름을 검사합니다.

```sh
npm run test:server
# PG_BIN_DIR에 pg_dump/pg_restore 경로를 지정하면 실제 백업·복원 시험도 수행
TALKIE_STORAGE_E2E=1 APP_ORIGIN=http://127.0.0.1:3100 npm run test:e2e -- storage.spec.ts
```

배포 전 로컬 통합 확인은 `npm run test:predeploy:e2e`로 실행한다. 두 로컬 PostgreSQL과 Mailpit, Chromium 실행 라이브러리, 무료 Gemini 시험 설정이 필요하다. 실제 백업·복원 시험까지 실행하려면 PostgreSQL 16의 `pg_dump`·`pg_restore`가 있는 디렉터리를 `PG_BIN_DIR`로 지정한다. 명령은 각 PostgreSQL에 `talkie_test_predeploy_*` 임시 DB를 만들어 마이그레이션·서버 시험·프로덕션 빌드·PC/모바일 브라우저 시험·실제 Gemini 연결 스모크를 순서대로 실행하고 임시 DB를 삭제한다. 일반 DB URL이나 원격 DB URL은 거부한다. 브라우저 시험은 실제 HTTP·SMTP·DB를 사용하지만 음성 공급자 응답은 가짜로 대체한다. 실제 공급자 스모크는 고정 합성 문장에 대한 연결·음성/전사 수신만 확인하며 장치 청취·전체 저장 학습을 자동 확인하지 않는다.

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

음성 인식·텍스트 모델·음성 합성 후보를 직접 말하고 들어 비교하는 시험 전용 도구는 제품 코드와 분리해 `harness/voice-eval/`에 있습니다. 설치와 실행은 [하니스 README](harness/voice-eval/README.md), 공급자별 키 발급·결제·환경변수는 [PROVIDERS.md](docs/harness/voice-eval/PROVIDERS.md)를 따릅니다. 합성 대화와 본인 음성만 사용하며 실제 사용자 데이터는 넣지 않습니다.

## 로컬 환경 변수와 커밋 점검

`.env`는 로컬 전용이며 Git에서 제외합니다. 인증·저장 앱의 변수 이름과 안전한 예시는 [app/.env.example](app/.env.example)을 따르며 실제 값은 Git 제외한 `app/.env`에 둡니다. 루트 [`.env.example`](.env.example)은 기존 공통 예시입니다. 구현 과정에서 변수가 생기면 예시 파일에는 변수 이름과 안전한 예시값만 추가하고, 실제 값은 `.env`에 둡니다. 이미 Git에 올라간 비밀값은 `.gitignore`만으로 제거되지 않으므로 해당 값을 폐기·재발급하고 Git 기록도 별도로 처리해야 합니다.

이 저장소의 훅은 Gitleaks 8.30.1의 `git` 명령을 사용합니다. [공식 릴리스](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1)에서 환경에 맞는 배포물과 체크섬을 받아 SHA-256을 확인한 뒤 실행 파일을 `.tools/gitleaks`에 둡니다. 같은 릴리스의 체크섬은 배포물 무결성 확인에 사용합니다. `.tools/`는 Git 추적에서 제외됩니다. Gitleaks가 없으면 커밋을 중단합니다. 다음 명령은 기존 pre-commit·pre-push 훅을 함께 켭니다.

```sh
git config --local core.hooksPath .githooks
```

커밋 훅은 민감한 파일명과 스테이징된 비밀값을 검사합니다. push 훅은 추적 중인 민감 파일명과 Git 이력의 비밀값을 다시 검사합니다. GitHub에서도 push와 pull request마다 두 검사를 실행합니다. 전체 커밋 이력은 `gitleaks git --redact .`로 별도 검사할 수 있습니다. 커밋 전에 `git diff --cached --name-only`와 `git diff --cached`도 확인하세요. 검사 도구와 GitHub push protection은 모든 비밀값이나 보안 취약 코드를 식별하지 못하므로 코드와 설정의 접근 권한, 사용자 데이터 노출, 서버 측 비밀값 사용 여부도 함께 검토합니다.

<a id="gemini-live-비공개-음성-시험"></a>

## 비공개 음성 시험: Gemini Live와 분리형

저장 음성 학습은 최근 6개월에 종료한 이전 음성 세션의 유효한 근거 노트에서 복습 표현 최대 2개를 선별해 전달합니다(개수와 우선순위는 임시 구현). 현재 대화 재개 상태와 구분하며, 주제 이력 기반 반복 회피와 실제 복습 품질은 아직 후속입니다. 선택 범위와 초기 상한은 [음성 설계](docs/design/VOICE.md#튜터-프롬프트와-컨텍스트-경계)를 따릅니다.

음성 저장 학습 노트는 상단에 주제·난이도·복습 표현을, 하단에 근거를 담는 [노트 형식](docs/design/LEARNING-NOTE.md)을 사용합니다. 현재 자동 생성은 확인된 교정/재시도 범위이며 주제·난이도의 실제 AI 종료 추출은 후속입니다.

DEC-055/056의 개발자 본인·합성 대화용 시험이다. 현재 `/talk`에서 Gemini Live와 분리형을 연결 전에 선택할 수 있다. 분리형은 STT Soniox·LLM Gemini를 표시하고 TTS는 Gemini 또는 Google Cloud Standard를 고른다. Soniox TTS는 별도 합성 파일 비교까지만 수행하며 앱 선택지에는 없다. 저장 학습은 확인 전사문·구조화 교정/재시도·중단/재개·종료 후 근거 노트를 연결한다. 실제 공급자 교정 품질·전체 AI 노트 선별·공개 운영 검증은 남는다.

1. 기존 로컬 인증·저장 환경을 실행하고 `/login`에서 합성 `.test` 계정 또는 Google로 로그인한다.
2. AI Studio에서 사용할 키의 프로젝트가 **무료 등급**인지 직접 확인한다. 서버는 등급을 자동 조회하지 못한다. 유료 프로젝트로 바꾸면 이 시험 경로를 사용하지 않는다.
3. `app/.env`에 `GOOGLE_API_KEY`를 설정하고 `TALKIE_VOICE_TEST=gemini-free`, `GEMINI_FREE_TIER_CONFIRMED=true`를 설정한다. 키는 서버에서만 사용하며 `NEXT_PUBLIC_` 접두사를 붙이지 않는다. 하니스의 `.env`와 별개이며 값을 문서·채팅에 복사하지 않는다.
4. 분리형도 시험하려면 `SONIOX_API_KEY`를 서버에 설정하고 `TALKIE_VOICE_CASCADE_TEST=enabled`로 지정한다. Gemini 무료 등급 확인은 분리형 텍스트/Gemini TTS에도 적용된다. Soniox STT와 Google Cloud TTS는 별도 사용액이 발생할 수 있다. 공급자 조건은 본인·합성 음성의 비공개 로컬 시험 범위에서만 적용한다.
5. `cd app`에서 `npm run db:migrate`로 추가 마이그레이션을 적용하고 `npm run dev`로 서버를 재시작한 뒤 `http://127.0.0.1:3000/talk`를 연다. 음성 대화와 음성 경로를 고르고 데이터 사용 조건을 확인한 뒤 `대화 시작`(진행 중인 대화가 있으면 `이어서 하기`)을 누른다. 이어폰을 권장한다. 가상의 일상 이야기로 영어 한 문장을 말한다.
6. 최대 3분 또는 종료 버튼·화면 이탈 시 마이크/재생/연결을 정리한다. 각 경로의 계정당 새 연결 발급은 최대 4분 간격이며 실패 시 자동 재시도하지 않는다. 앱의 음성 대화는 항상 저장 학습이며 확인된 전사문/교정만 저장하고 `잠시 멈추기` 후 `이어서 하기`로 재개한다. `대화 종료` 후 피드백 화면에서 노트·다운로드를 확인하며 저장 실패 시 화면을 유지하면 자동 재시도한다. 원본 음성은 파일·DB·로그에 저장하지 않는다. 음성/텍스트 방식이 다른 진행 대화가 있으면 그 방식으로 이어서 마친 뒤 새 방식을 시작한다. 시험 후 두 시험 설정을 `disabled`로 되돌리면 새 연결 발급이 차단된다.

Google Cloud Standard TTS를 앱에서 고르려면 Cloud Text-to-Speech API를 활성화한 프로젝트 ID를 `app/.env`의 `GOOGLE_CLOUD_PROJECT`에 넣고 로컬에서 `gcloud auth application-default login`을 한 번 완료한다. 앱은 시험 요청 때 로컬 ADC로 단기 OAuth 토큰을 자동 발급·갱신하므로 매번 `export`할 필요가 없다. `gcloud` CLI가 PATH에 없더라도 홈 디렉터리의 `google-cloud-sdk/bin/gcloud`를 찾는다. 토큰을 `.env`·Git·채팅에 저장하지 않는다. 분리형의 STT·LLM은 현재 각각 한 후보만 있으며, Google Cloud TTS는 한글 포함 여부로 한국어/영어 Standard 음성을 고르는 시험 규칙을 쓴다. 한영 혼용 품질은 미검증이다.

Google 무료 API는 제품 개선·학습과 사람 검토에 데이터를 사용할 수 있다. 개인정보·민감/기밀정보나 다른 사람의 기록을 넣지 않는다. 실제 사용자 연결에는 기존 학습 금지·최대 30일 정책이 유지된다. 직접 연결 토큰은 발급 후 최대 4분 유효하며 로그아웃/탈퇴 직후 이미 연결된 공급자 세션의 강제 종료는 아직 보장하지 않는다. 공개 배포하지 않는다.

검증: `cd app` 후 `npm test`, `npm run typecheck`, `npm run test:e2e -- voice.spec.ts`. 브라우저 자동 시험은 가짜 WebSocket·마이크·토큰을 사용하며 실제 AI 품질·실제 장치 검증이 아니다. 무료 프로젝트 설정 후 `npm run voice:smoke`는 실제 공급자에 고정 합성 문장 한 번을 보내 연결·음성/전사 수신을 확인한다. 이는 API를 호출하는 명령이며 출력은 청크 수·바이트 수·수신 여부뿐이다. 장치·청취·저장/노트 E2E를 검증하지 않는다. 구조와 남은 계약은 [design](docs/design/VOICE.md#포트어댑터-경계)을 따른다.

구조화 교정/재시도 진단은 `espeak-ng` 설치 후 `npm run voice:smoke:learning`으로 실행한다. 실행 파일 경로는 `TALKIE_SYNTHETIC_SPEECH`로 지정할 수 있다. 고정 합성 음성을 생성하므로 입력 파일이나 실제 사용자 발화를 받지 않는다. 무료 시험 설정에서 실제 API를 호출하며 연결 하나·최대 60초·자동 재시도 없음으로 제한한다. 교정과 재시도 성공이 기록되지 않으면 실패로 종료한다. 재생 완료는 모의 신호이고 DB에는 쓰지 않는다. 시험에서만 자동 발화 감지를 끄고 합성 발화 시작/끝을 명시한다. 앱의 실제 마이크 설정은 유지한다. [프롬프트 보완 후 검증](docs/worklogs/2026-10-29.md#재시도-판정-프롬프트-보완)에서 고정 합성 사례의 교정·재시도 성공 기록을 확인했다. 전체 AI 품질·실제 장치·DB 저장 검증을 대신하지 않는다.

### TTS 후보만 비교하기

`cd app`에서 `npm run tts:compare -- soniox`를 실행하면 기존 `SONIOX_API_KEY`로 영어·한국어의 짧은 가상 문장 두 개를 Soniox TTS에 보내고 `app/.local/tts-compare/`에 WAV 파일을 저장한다. 실제 API 사용량이 발생할 수 있다. 문장은 고정된 합성 자료이며 사용자 기록은 보내지 않는다.

Google Cloud Text-to-Speech는 Gemini Developer API와 별도 서비스다. [Google Cloud 설정 안내](https://docs.cloud.google.com/text-to-speech/docs/get-started)에 따라 프로젝트에서 결제를 연결하고 Cloud Text-to-Speech API를 활성화한 뒤 [로컬 ADC 인증](https://docs.cloud.google.com/text-to-speech/docs/authentication)을 설정한다. 프로젝트 ID를 `app/.env`의 `GOOGLE_CLOUD_PROJECT`에 넣고 `gcloud auth application-default login`을 완료한 뒤 `npm run tts:compare -- google-cloud`를 실행한다. 스크립트도 단기 토큰을 ADC에서 자동 발급하며 과금 프로젝트를 `x-goog-user-project` 요청 헤더로 지정한다. `GOOGLE_API_KEY`는 이 명령에서 사용하지 않는다. 토큰·서비스 계정 파일을 Git이나 채팅에 올리지 않는다. WAV는 로컬 Git 제외 경로에 저장된다. 두 후보의 출력은 직접 듣고 영어 교정 발음·한국어 도움·속도·자연스러움을 비교한다. 이 명령은 `/talk`에서 선택한 분리형 TTS 공급자를 바꾸지 않는다.
