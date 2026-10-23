# Talkie 에이전트 안내

필요한 문서만 읽는다. 먼저 작업 종류를 확인하고 아래 문서의 관련 절만 연다.

| 작업 | 읽을 문서 |
| --- | --- |
| 제품 동작을 설계·변경 | [PRD.md](PRD.md)의 관련 요구사항 |
| 작업을 선택·구현 | [TASKS.md](TASKS.md)의 해당 작업, 필요할 때 관련 PRD 절 |
| 현재 진행 상황 확인 | [PROGRESS.md](PROGRESS.md) |
| 특정 날짜의 작업·검증 확인 | `docs/worklogs/YYYY-MM-DD.md`의 해당 날짜 파일 |
| 현재 구조·데이터 흐름·API 규칙·기술적 가정 확인 | [design.md](design.md)의 관련 절 |
| 기존 결정의 이유 확인·변경 | [DECISIONS.md](DECISIONS.md)의 해당 ID와 연결된 ADR |
| 기준선·부하·실패 실험 설계 | [docs/design/engineering-validation.md](docs/design/engineering-validation.md) |
| 과거 변경 추적 | [CHANGELOG.md](CHANGELOG.md)의 해당 날짜 |
| 실행·설치 방법 확인 | [README.md](README.md) |
| 첫 학습 흐름 구현·검증 | [docs/design/first-learning-flow.md](docs/design/first-learning-flow.md) |
| 최소 기술 스택 검토 | [docs/proposals/initial-stack.md](docs/proposals/initial-stack.md) |

아키텍처, 주요 기능, 배포 방식, 사용자 데이터 등 영향이 큰 **새 결정**이나 채택된 결정의 변경·충돌은 먼저 논의한다. 관련 기존 결정과 근거를 확인하고, 대안별 장단점 및 비용·일정·사용자 경험·데이터·운영에 대한 영향을 구체적으로 제시한다. 사용자와 결정 이유까지 합의하고 명시적 동의를 받은 뒤에만 해당 결정과 관련 문서·구현을 변경한다. 동의 전에는 충돌하지 않는 조사와 제안서 작성만 진행하며, 미확정안을 `DECISIONS.md`에 채택된 결정처럼 기록하지 않는다. 단순한 문구 정리나 기존 결정 안에서의 구현은 이 절차의 대상이 아니다.

문서를 수정할 때는 해당 내용의 기준 문서만 먼저 갱신한다. 요구사항이 바뀌면 관련 작업의 완료 기준을 확인한다. 현재 구조·공통 규칙·기술적 가정은 `design.md`, 중요한 선택의 배경·대안·이유·영향은 `docs/adr/NNN-제목.md`, ADR 상태·링크와 작은 결정은 `DECISIONS.md`에 둔다. 사용자 핵심 약속·큰 변경 비용·보안/데이터 경계·중요한 절충은 ADR로 남기며 구체적인 분리 기준은 `DECISIONS.md`를 따른다. 여러 구성 요소에 영향을 주거나 논의가 길었다는 이유만으로 ADR을 만들지 않는다. 작은 결정은 `DECISIONS.md`에 ID·결정일·상태와 결정·핵심 이유만 1~2줄로 남기고 영향이 커지면 ADR로 옮겨 링크를 남긴다. 중요한 결정은 합의 후에만 채택하고 변경 시 새 ADR로 이전 결정을 대체하며 설계와 목록의 상태·링크를 갱신한다. 사용자에게 의미 있는 변경은 `CHANGELOG.md`에, 현재 상태는 `PROGRESS.md`에, 날짜별 작업 결과는 `docs/worklogs/YYYY-MM-DD.md`에 기록한다. 같은 설명을 여러 파일에 복사하지 않는다.

그날 작업을 마무리할 때는 **그날 바뀐 파일과 직접 연결된 문서만** 대조한다. PRD 요구사항과 해당 TASK의 완료 기준, 승인된 DECISION과 영향받은 문서, TASK 상태와 검증 근거, PROGRESS의 현재 상태, CHANGELOG의 의미 있는 변경을 확인한다. 링크·작업 ID·상태의 불일치도 검사한다. 점검 결과와 남은 불일치는 그날의 worklog에 남긴다. 작업하지 않은 날에는 파일을 만들지 않는다.

외부 자료를 참고할 때는 관찰·추정·미확인을 구분하고 출처와 한계를 남긴다. 구현 완료는 해당 작업의 수용 기준을 확인한 뒤 표시한다. 트러블슈팅에는 증상·가설·증거·원인·수정·재검증·재발 방지를 기록한다. 테스트 환경의 장애 실험과 실제 운영 장애를 구분하며 측정 결과에는 조건과 한계를 남긴다.

커밋 전에는 스테이징된 파일 목록과 diff를 확인하고 `.githooks/pre-commit`의 민감 파일명·Gitleaks 검사를 통과시킨다. `.env`와 실제 키·토큰·개인 키·계정 정보는 추적하지 않는다. 검사 통과만으로 안전을 단정하지 말고, 코드의 비밀값 노출과 사용자 데이터 접근·로그 기록도 검토한다.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
