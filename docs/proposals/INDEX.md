# 제안서·검토 기록 색인

분류 점검일: 2026-10-28. 이 폴더는 미승인 제안과 채택 전 비교·검토 과정을 보존한다. 파일이 이 폴더에 있다는 이유만으로 내용 전체가 미승인인 것은 아니며, 일부 채택을 문서 전체 승인으로 해석하지 않는다.

아래 분류는 탐색 안내다. 본문의 당시 추천·미정·미착수 표시는 작성 시점의 기록이며 현재 구현 상태를 갱신하는 용도로 쓰지 않는다. 문서 위치와 기존 링크는 유지한다.

## 남은 제안·논의에 사용하는 자료

| 자료 | 채택된 부분과 현재 기준 | 남은 제안·확인 범위 |
| --- | --- | --- |
| [AI 후보 평가 계획](AI-CANDIDATE-EVALUATION-PLAN.md) | 후보 구성·평가 방향은 DEC-050/053/054, 로컬 통합 우선은 DEC-055, 무료 로컬 시험 예외는 DEC-056. 적용 조건은 [PRD](../PRD.md#provider-data-policy) | 후보별 예산·표본·호출 상한·평가 기준·최종 모델/경로는 D-03에서 합의·검증. 과거 가격/정책 조사는 조회 시점과 한계를 확인 |
| [MVP 사전 결정 진행표](MVP-PREIMPLEMENTATION-DECISIONS.md) | 채택 근거는 연결된 DEC/ADR, 현행 미완료 작업은 [TASKS](../TASKS.md) | 후속 논의 순서와 미정 범위의 출발점. 과거 진행표만으로 현재 미정 여부를 판정하지 않음 |
| [최소 MVP 결정 점검표](MINIMUM-MVP-DECISION-CHECKLIST.md) | 2026-10-23 요구사항 대조 기록. 후속 합의는 연결된 결정·설계를 우선 확인 | 점검용 식별자 L/P는 TASK 완료 상태가 아님. 남은 정책·검증 누락을 대조할 때 사용 |
| [인증·저장 상세 설계 초안](AUTHENTICATION-STORAGE-DESIGN.md) | 기술 선택은 DEC-041~045, 인증/버퍼 후속은 DEC-046/047. 현행 계약은 [인증](../design/AUTHENTICATION.md)·[DB](../design/DATABASE.md)·[학습 저장](../design/LEARNING-PERSISTENCE.md)·[로컬 운영](../design/LOCAL-OPERATIONS.md) | 당시 비교·동시성 검토 근거. Google 인증 상세·운영/실패·복원 등 남은 범위는 D-02와 대조 |
| [학습 상태 쟁점](LEARNING-STATE-ISSUES.md) | 책임·MVP 모드·기록·저장은 DEC-010~013과 후속 결정. 현재 계약은 [학습 저장](../design/LEARNING-PERSISTENCE.md)·[음성](../design/VOICE.md) | 초기 대안과 사용자 답변의 근거. 저장 기술·실패 처리를 전부 미정으로 읽지 않고 남은 음성/학습 통합 계약과 구분 |

## 채택·적용 전의 비교 및 검토 기록

| 자료 | 분류와 연결 | 후속으로 남는 범위·한계 |
| --- | --- | --- |
| [초기 기술 스택 비교](INITIAL-STACK.md) | A안 채택, [ADR-015](../adr/015-NEXTJS-TYPESCRIPT-LOCAL-PROTOTYPE.md). D-04 완료 근거의 비교 과정 | 당시 추천·동의 요청 보존. 운영 플랫폼·DB·공급자 채택을 포함하지 않음 |
| [DB 개편 재개 메모](DATABASE-SCHEMA-REFACTOR.md)·[양방향 검토](DATABASE-SCHEMA-REVIEW-2026-10-25.md) | 승인 범위는 [ADR-049](../adr/049-CLEAR-DATABASE-NAMES-AND-MERGED-SESSION-STATE.md), 현행 계약은 [DATABASE](../design/DATABASE.md), 이관 검증은 [2026-10-25 worklog](../worklogs/2026-10-25.md) | 예약 실행기 전면 개편·delta 저장·미확정 재개 복구 계약 변경은 채택 범위 밖. 당시 후보명을 현행 스키마로 사용하지 않음 |
| [명명 일관성 점검](NAMING-CONSISTENCY-AUDIT-2026-10-27.md) | N01~N19 적용 기록, 검증은 [2026-10-27 worklog](../worklogs/2026-10-27.md#적용--코드-명명-일관성) | 점검 당시 이름과 비교 근거 보존. 제품 기능·공급자 선정·보관 정책 완료를 뜻하지 않음 |
| [문서 쟁점 교차 검토](DOCUMENTATION-CROSS-REVIEW.md) | 2026-10-16 당시 검토 제안. 이후 채택 범위는 [DECISIONS](../DECISIONS.md) | 문서 전체의 일괄 채택 승인은 없음. 당시 미정·추천·모델명/가격/약관 관찰을 현행 명세나 최신 사실로 사용하지 않음 |

## 가정에 따른 조사·추정

| 자료 | 용도 | 한계 |
| --- | --- | --- |
| [보관 기간별 비용 추정](RETENTION-COST-ESTIMATE.md) | 2026-10-21 단가·사용량/용량 가정에 따른 비교 | 실측·견적 확정·공급자/정책 채택이 아님. 의사결정에 재사용할 때 현재 단가와 실제 측정 조건을 다시 확인 |
