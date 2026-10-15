# Talkie

한국어 화자를 위한 영어 회화 웹서비스 프로젝트입니다.

제품 요구사항은 [PRD.md](PRD.md), 작업별 문서 안내는 [AGENTS.md](AGENTS.md)를 참고하세요.

실행·설치 방법은 애플리케이션 코드가 추가될 때 이곳에 기록합니다.

## 로컬 환경 변수와 커밋 점검

`.env`는 로컬 전용이며 Git에서 제외합니다. 현재 필요한 환경 변수는 정해지지 않았으므로 [`.env.example`](.env.example)에는 키나 공급자 설정을 넣지 않았습니다. 구현 과정에서 변수가 생기면 예시 파일에는 변수 이름과 안전한 예시값만 추가하고, 실제 값은 `.env`에 둡니다. 이미 Git에 올라간 비밀값은 `.gitignore`만으로 제거되지 않으므로 해당 값을 폐기·재발급하고 Git 기록도 별도로 처리해야 합니다.

이 저장소의 커밋 전 검사 훅을 켭니다. [Gitleaks](https://github.com/gitleaks/gitleaks#installing)는 별도로 설치하거나 실행 파일을 `.tools/gitleaks`에 둡니다. Gitleaks가 없으면 커밋을 중단합니다. 현재 로컬 환경에는 공식 v8.30.1 배포 파일을 체크섬 검증 후 `.tools/gitleaks`에 설치했습니다.

```sh
git config --local core.hooksPath .githooks
```

커밋 훅은 민감한 파일명과 스테이징된 비밀값을 검사합니다. push 훅은 추적 중인 민감 파일명과 Git 이력의 비밀값을 다시 검사합니다. GitHub에서도 push와 pull request마다 두 검사를 실행합니다. 전체 커밋 이력은 `gitleaks git --redact .`로 별도 검사할 수 있습니다. 커밋 전에 `git diff --cached --name-only`와 `git diff --cached`도 확인하세요. 검사 도구와 GitHub push protection은 모든 비밀값이나 보안 취약 코드를 식별하지 못하므로 코드와 설정의 접근 권한, 사용자 데이터 노출, 서버 측 비밀값 사용 여부도 함께 검토합니다.
