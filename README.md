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

## 로컬 환경 변수와 커밋 점검

`.env`는 로컬 전용이며 Git에서 제외합니다. 현재 필요한 환경 변수는 정해지지 않았으므로 [`.env.example`](.env.example)에는 키나 공급자 설정을 넣지 않았습니다. 구현 과정에서 변수가 생기면 예시 파일에는 변수 이름과 안전한 예시값만 추가하고, 실제 값은 `.env`에 둡니다. 이미 Git에 올라간 비밀값은 `.gitignore`만으로 제거되지 않으므로 해당 값을 폐기·재발급하고 Git 기록도 별도로 처리해야 합니다.

이 저장소의 커밋 전 검사 훅을 켭니다. [Gitleaks](https://github.com/gitleaks/gitleaks#installing)는 별도로 설치하거나 실행 파일을 `.tools/gitleaks`에 둡니다. Gitleaks가 없으면 커밋을 중단합니다. 현재 로컬 환경에는 공식 v8.30.1 배포 파일을 체크섬 검증 후 `.tools/gitleaks`에 설치했습니다.

```sh
git config --local core.hooksPath .githooks
```

커밋 훅은 민감한 파일명과 스테이징된 비밀값을 검사합니다. push 훅은 추적 중인 민감 파일명과 Git 이력의 비밀값을 다시 검사합니다. GitHub에서도 push와 pull request마다 두 검사를 실행합니다. 전체 커밋 이력은 `gitleaks git --redact .`로 별도 검사할 수 있습니다. 커밋 전에 `git diff --cached --name-only`와 `git diff --cached`도 확인하세요. 검사 도구와 GitHub push protection은 모든 비밀값이나 보안 취약 코드를 식별하지 못하므로 코드와 설정의 접근 권한, 사용자 데이터 노출, 서버 측 비밀값 사용 여부도 함께 검토합니다.
