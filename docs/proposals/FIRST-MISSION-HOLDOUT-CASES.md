# 첫 카페 미션 평가의 과적합 검토용 새 사례

작성·판정 후보 고정: 2026-11-16. **실제 모델 실행 전에 판정 후보를 고정했다.** 이 사례들은 [기존 평가 사례](FIRST-MISSION-EVALUATION-CASES.md)로 평가 지시를 보강한 뒤(2026-11-16 worklog), 보강이 처음 보는 대화에서도 효과가 있는지 보기 위한 holdout이다. 이 사례의 실행 결과를 보고 평가 지시를 고치지 않는다. 고치면 이 사례는 더 이상 holdout이 아니다.

판정 후보는 [PRD 4.5절](../PRD.md#45-평가와-달성-일수)과 평가 지시의 기준 정의(`app/src/mission/evaluation.ts`)를 적용한 **검토 후보**이며 승인된 정답표가 아니다. 사용자 검토 전이다. 발화 ID는 이 문서 안의 식별자이며, 직원 발화의 근거는 맥락일 뿐 사용자 언어 근거가 아니다. 코드 사본은 `app/src/mission/eval-cases.ts`(`HOLDOUT_EVAL_CASES`)에 있다.

## 설계

- 기존 9개와 다른 형태를 넣었다. 목표 항목 일부 누락, 처리 요청을 직원에게 넘김, 카페인 조건 없이 재제조 합의, 다른 위치의 기록 누락, 교정 뒤 같은 오류로 되돌아감, 단발 잡담이 그 예다.
- H-01과 H-02는 처리 요청 여부만 다른 최소 쌍이다. 80% 경계의 양쪽(83.5 / 73.5)에 놓이도록 만들었다.
- 판정 후보 가운데 해석이 갈릴 수 있는 기준은 **경계**로 표시했다. 경계 기준의 불일치는 따로 집계한다.

## 점수 후보 요약

| 사례 | 수준·모드 | 핵심 | 목표 | 언어 | 합계 | 80% |
| --- | --- | --- | --- | --- | --- | --- |
| H-01 | A2·실전 | 문제를 모호하게 말하고 환불 요청 | 50 | 33.5 | 83.5 | 달성 |
| H-02 | A2·실전 | H-01과 같으나 처리를 직원에게 맡김 | 40 | 33.5 | 73.5 | 미달 |
| H-03 | B1·실전 | 온도만 말하고 재제조 합의 | 45 | 40 | 85 | 달성 |
| H-04 | B2·실전 | 비용·시간 확인 질문과 단발 잡담 | 60 | 40 | 100 | 달성 |
| H-05 | A2·실전 | 사용자 수락 발화가 저장 누락 | 20/20 | 37/37 | 57/57 | 달성 |
| H-06 | A2·연습 | 교정 뒤 새 요청에서 같은 오류 | 60 | 37 | 97 | 달성 |
| H-07 | A2·실전 | H-01을 상대역 규칙대로 고침 | 50 | 32 | 82 | 달성 |
| H-08 | B2·실전 | H-04를 상대역 규칙대로 고침 | 60 | 40 | 100 | 달성 |

**상대역 규칙 위반(2026-11-16 실행 뒤 발견):** H-01·H-02·H-04의 직원은 사용자가 처리를 요청하거나 방법을 묻기 전에 재제조·환불을 먼저 제시했다. H-02의 직원은 처리를 대신 골랐다. 이는 상대역 규칙(PRD 4.2·DEC-076: 듣지 않은 처리를 먼저 완성하지 않고, 방법을 물었을 때 두 처리를 제시)에 어긋난다. 평가는 사용자 발화만 근거로 하므로 이 세 사례는 평가 판정 시험으로는 유지한다. 다만 상대역 행동의 예시로 쓰지 않는다. 직원 발화를 규칙대로 고친 대본은 H-07·H-08로 새로 고정했다. 이미 실행한 사례는 고치지 않는다. H-02의 처리 위임은 규칙에 맞게 다시 쓰면 직원이 두 처리를 알려 주고 사용자가 고르는 흐름이 되어 H-07과 같아지므로 따로 만들지 않았다.

**검토가 필요한 지점:** 아래는 현행 정책을 그대로 적용한 결과다. 의도와 맞는지 사용자 검토가 필요하다.
- H-03은 카페인 문제가 해결되지 않았는데도 80%를 넘는다. 목표 45점에 언어 점수가 더해진 결과다.
- H-05는 최종 수락이 저장되지 않아 목표 해결 항목 40점이 제외되고, 남은 항목이 모두 충족이라 100%가 된다.

## H-01 문제를 모호하게 말하고 환불 요청

A2·실전, 종료 사유 `goal_completed`, 경로 `refund`.

| ID | 역할 | 대사 |
| --- | --- | --- |
| H-01-1 | 직원 | Hi. How can I help? |
| H-01-2 | 사용자 | This not my drink. |
| H-01-3 | 직원 | I'm sorry. What's wrong with it? |
| H-01-4 | 사용자 | It wrong. I not like it. |
| H-01-5 | 직원 | I see. I can make you a new drink at no extra charge in about five minutes, or cancel it and give you a full refund. Which would you prefer? |
| H-01-6 | 사용자 | Refund, please. I have no time. |
| H-01-7 | 직원 | Of course. I'll cancel this drink and give you a full refund. Is that okay? |
| H-01-8 | 사용자 | Yes, please. Thank you. |
| H-01-9 | 직원 | Your full refund is done. |

| 기준 | 후보 | 근거와 경계 |
| --- | --- | --- |
| 온도·카페인 전달 | 미충족·미충족 | 온도·카페인 어느 차이도 말하지 않았다. “wrong”만으로 조건 전달을 인정하지 않는다(PRD 4.5.1). |
| 처리 요청 | 충족 | H-01-6에서 환불을 요청했다. |
| 최종 온도·카페인 해결·합의 | 충족 | 환불 수락(H-01-8)과 직원 확정(H-01-9)은 두 조건의 허용 대안 해결이다(DEC-081). |
| 의미 관계(4) | 부분 충족 | H-01-4의 “I not like it”에서 부정 형태가 틀렸다. 의미는 전달된다. |
| 문장 구조(3) | 부분 충족 | H-01-2와 H-01-4에서 be 동사가 빠졌다(This not / It wrong). |
| 안정성(3) | 부분 충족 | 같은 생략이 두 번 반복됐다. |
| 의도에 맞는 단어(4) | 충족(경계) | 쓴 단어가 틀리지는 않았고 문제를 구체적으로 말하지 않은 것이다. 정보 부족은 목표 항목과 설명·확인에서 본다. |
| 단어 조합·상황 표현 | 충족 | 짧고 공손한 요청·수락이다. |
| 정보 순서(4) | 충족(경계) | 제시한 정보의 순서에는 문제가 없고 정보 자체가 부족했다. |
| 이유·대조·조건 연결(3) | 충족 | H-01-6의 “I have no time”이 환불 이유로 분명하게 병치됐다. |
| 간결성과 관련성(3) | 충족 | 모든 발화가 미션과 관련된다. |
| 상대 말에 맞는 응답(4) | 충족(경계) | H-01-4는 “What's wrong?”의 주제에 맞춰 답했다. 내용이 모호한 문제는 설명·확인에서 본다. |
| 필요한 설명·확인·수정(3) | 부분 충족 | 직원이 문제를 물었는데 무엇이 다른지 밝히지 못했다. 한 번의 기회라 미충족은 아니다. |
| 앞선 대화와의 연결(3) | 충족 | 환불 선택과 수락이 일관된다. |

목표 50, 언어 33.5(문법 5·어휘 10·구성 10·상호작용 8.5), 합계 83.5.

## H-02 H-01과 같으나 처리를 직원에게 맡김

A2·실전, 종료 사유 `goal_completed`, 경로 `refund`. H-01-1~4와 같은 대사에 이어 다음과 같이 진행한다.

| ID | 역할 | 대사 |
| --- | --- | --- |
| H-02-5 | 직원 | I see. I can make you a new drink at no extra charge in about five minutes, or cancel it and give you a full refund. What would you like me to do? |
| H-02-6 | 사용자 | I don't know. You choose. |
| H-02-7 | 직원 | Then I'll cancel it and give you a full refund. Is that okay? |
| H-02-8 | 사용자 | Okay. Thank you. |
| H-02-9 | 직원 | Your full refund is done. |

판정 후보는 H-01과 같고, 처리 요청과 이유 연결 두 기준만 다르다.
- **처리 요청: 미충족.** 사용자가 처리를 고르지 않고 직원에게 넘겼다. 직원의 제안을 수락한 것은 합의의 근거일 뿐, 요청의 근거가 아니다.
- **이유·대조·조건 연결: 충족(경계).** 이유를 연결할 필요가 없었다. 필요 없는 연결을 하지 않았다는 이유로 감점하지 않는다.

상대 말에 맞는 응답은 충족(경계)이다. H-02-6은 질문에 대한 응답이다.

목표 40, 언어 33.5, 합계 73.5. H-01과 함께 보면 처리 요청 10점이 80% 달성 여부를 가른다.

## H-03 온도만 말하고 재제조 합의

B1·실전, 종료 사유 `goal_completed`, 경로 `remake`. 직원은 사용자가 말하지 않은 카페인 조건을 모른다.

| ID | 역할 | 대사 |
| --- | --- | --- |
| H-03-1 | 직원 | Hi. How can I help? |
| H-03-2 | 사용자 | I ordered a hot latte, but this one is iced. Could you make it hot, please? |
| H-03-3 | 직원 | I'm sorry. I can remake it hot at no extra charge. It will take about five minutes. Is that okay? |
| H-03-4 | 사용자 | Yes, that's fine. I can wait. |
| H-03-5 | 직원 | Great. I'll remake your latte hot now. |

| 기준 | 후보 | 근거와 경계 |
| --- | --- | --- |
| 온도 전달·처리 요청 | 충족 | H-03-2. |
| 카페인 전달 | 미충족 | 디카페인을 말하지 않았다. |
| 최종 온도 해결 | 충족 | 뜨거운 재제조를 수락했고 직원이 확정했다. |
| 최종 카페인 해결 | 미충족 | 재제조 내용에 디카페인 조건이 없다. 환불이 아니므로 대안 해결도 아니다. |
| 최종 합의 | 충족 | 구체적인 재제조 수락(H-03-4)과 직원 확정(H-03-5)이 있다. 이 항목은 합의 성립만 보며, 카페인 미해결은 위 항목에서 이미 반영했다. |
| 언어 문법·어휘·구성 9개 | 충족 | 정확하고 연결된 B1 수준의 요청·수락이다. |
| 상대 말에 맞는 응답·앞선 연결 | 충족 | H-03-4는 H-03-3의 제안과 대기 질문에 답했다. |
| 필요한 설명·확인·수정(3) | 충족 | 2026-11-16 DEC-090으로 후보를 부분 충족에서 바꿨다. 처음부터 말하지 않은 디카페인 조건은 목표 항목에서 반영하며, 대화 중 질문·오해로 드러난 필요가 없었으므로 여기서 다시 감점하지 않는다. 처음 후보는 부분 충족이었고 모델은 3/3 충족으로 판정했다. |

목표 45, 언어 40, 합계 85(처음 후보 83.5).

## H-04 비용·시간 확인 질문과 단발 잡담

B2·실전, 종료 사유 `goal_completed`, 경로 `remake`.

| ID | 역할 | 대사 |
| --- | --- | --- |
| H-04-1 | 직원 | Hi. How can I help? |
| H-04-2 | 사용자 | Hi. I ordered a hot decaf latte, but I've been given an iced one, and the label says regular. |
| H-04-3 | 직원 | I'm sorry about that. I can remake it hot and decaf at no extra charge in about five minutes, or cancel it and give you a full refund. |
| H-04-4 | 사용자 | Busy morning, huh? Just to check, would the remake cost anything extra, and is five minutes the longest it might take? |
| H-04-5 | 직원 | No extra charge at all, and it should be about five minutes. |
| H-04-6 | 사용자 | Great, then I'll go with the remake, please. |
| H-04-7 | 직원 | Perfect. I'll remake your hot decaf latte now. |

목표 6개와 언어 12개 모두 충족 후보다(합계 100). 각 기준의 판단은 다음과 같다.
- **처리 요청:** H-04-6의 “I'll go with the remake, please”는 허용된 처리를 고른 요청이다.
- **확인 질문(H-04-4):** 필요한 확인이다. 이미 들은 정보를 다시 묻는다고 감점하지 않는다.
- **간결성과 관련성(경계):** “Busy morning, huh?”는 한 번의 짧은 잡담이며 진행을 방해하지 않는다. 반대 근거로만 남기고 감점하지 않는다.
- **B2 수준:** 필요한 정보를 정확하게 연결해 전달했다. 더 긴 설명을 요구하지 않는다.

## H-05 사용자 수락 발화가 저장 누락

A2·실전, 종료 사유 `goal_completed`, 경로 `remake`. 평가 입력에 누락 표시가 있고, H-05-4(사용자 수락)는 저장되지 않아 입력에 없다.

| ID | 역할 | 대사 |
| --- | --- | --- |
| H-05-1 | 직원 | Hi. How can I help? |
| H-05-2 | 사용자 | I ordered a hot decaf latte, but this is iced and the label says regular. Can you make a new one? |
| H-05-3 | 직원 | I'm sorry. I can remake it hot and decaf at no extra charge. It will take about five minutes. Is that okay? |
| H-05-5 | 직원 | Great. I'll remake your hot decaf latte now. |

| 기준 | 후보 | 근거와 경계 |
| --- | --- | --- |
| 온도·카페인 전달·처리 요청 | 충족 | H-05-2. |
| 최종 온도·카페인 해결·합의 | 판정 불가 | 사용자 확인이 필요한데 수락 발화가 누락됐다. 직원 확정만으로 수락을 추정하지 않고, 누락을 미충족으로 단정하지도 않는다. |
| 의미 관계·문장 구조·어휘 3·정보 순서·연결·간결성 | 충족 | H-05-2의 설명과 요청. |
| 안정성(3) | 충족(경계) | 남은 사용자 발화는 하나지만 설명·대조·요청 구조가 모두 들어 있다. 누락된 것은 짧은 수락이라 이 기준이 보는 수행은 관찰된다. |
| 상대 말에 맞는 응답(4) | 충족(경계) | H-05-2는 직원의 첫 질문에 맞는 답이다. 제안에 대한 응답은 누락됐지만 관찰된 응답 근거가 있다. |
| 필요한 설명·확인·수정(3) | 충족 | 처음 설명이 충분했다. |
| 앞선 대화와의 연결(3) | 판정 불가 | 사용자 발화가 하나뿐이라 자기 앞선 발화와 이어지는지 볼 근거가 없다. 이는 누락 때문이다. |

목표 20/20(40 제외), 언어 37/37(3 제외), 합계 57/57 = 100%.

## H-06 교정 뒤 새 요청에서 같은 오류

A2·연습, 종료 사유 `goal_completed`, 경로 `refund`. H-06-2에 대한 교정(H-06-3)과 성공한 다시 말하기(H-06-4)가 기록돼 있다.

| ID | 역할 | 대사 |
| --- | --- | --- |
| H-06-1 | 직원 | Hi. How can I help? |
| H-06-2 | 사용자 | I ordered a hot decaf latte, but this is iced and marked regular. Could you making it hot and decaf? |
| H-06-3 | 튜터 | Use “Could you make it hot and decaf?” Try that request again. |
| H-06-4 | 사용자 | Could you make it hot and decaf? |
| H-06-5 | 직원 | Of course. I can remake it at no extra charge. It will take about five minutes. Is that okay? |
| H-06-6 | 사용자 | Sorry, I can't wait. Could you giving me a refund? |
| H-06-7 | 직원 | Of course. I'll cancel this drink and give you a full refund. Is that okay? |
| H-06-8 | 사용자 | Yes, please. |
| H-06-9 | 직원 | Your full refund is done. |

| 기준 | 후보 | 근거와 경계 |
| --- | --- | --- |
| 목표 6개 | 충족 | H-06-2에서 두 차이와 요청을 말했고, H-06-6~9에서 환불 요청·수락·확정이 이어진다. 경로를 바꿨지만 중복 득점은 없다. |
| 문장 구조(3) | 부분 충족 | H-06-2와 H-06-6에서 “Could you + -ing” 오류가 반복됐다. H-06-4는 직접 따라 말한 것이다. |
| 안정성(3) | 부분 충족 | 교정 뒤 새 요청(H-06-6)에서 같은 오류로 되돌아갔다. [R-01](FIRST-MISSION-EVALUATION-CASES.md#r-01)의 스스로 적용한 사례와 대조된다. |
| 나머지 언어 10개 | 충족 | 의미 관계는 분명하다. 이유(“I can't wait”)와 경로 변경이 자연스럽다. 도움을 받은 것 자체는 감점하지 않는다. |

목표 60, 언어 37, 합계 97.

## H-07 H-01을 상대역 규칙대로 고침

A2·실전, 종료 사유 `goal_completed`, 경로 `refund`. 직원은 무엇이 다른지 다시 묻고, 처리는 사용자가 정하게 한다.

| ID | 역할 | 대사 |
| --- | --- | --- |
| H-07-1 | 직원 | Hi. How can I help? |
| H-07-2 | 사용자 | This not my drink. |
| H-07-3 | 직원 | I'm sorry. What's wrong with it? |
| H-07-4 | 사용자 | It wrong. I not like it. |
| H-07-5 | 직원 | Sorry, could you tell me what's different from what you ordered? |
| H-07-6 | 사용자 | I don't know. Just wrong. |
| H-07-7 | 직원 | Okay. What would you like me to do about it? |
| H-07-8 | 사용자 | Refund, please. I have no time. |
| H-07-9 | 직원 | Of course. I can cancel this drink and give you a full refund, with no fee. Is that okay? |
| H-07-10 | 사용자 | Yes, please. Thank you. |
| H-07-11 | 직원 | Your full refund is done. |

판정 후보는 H-01과 같고, 필요한 설명·확인·수정 기준만 다르다.
- **필요한 설명·확인·수정: 미충족.** 직원이 두 번 확인을 요청했지만(H-07-3·5) 무엇이 다른지 끝내 밝히지 못했다. F-01과 달리 처음의 분명한 설명이라는 반대 근거도 없다.
- **목표:** 처리 요청(H-07-8)과 환불 해결·합의는 충족, 온도·카페인 전달은 미충족이다.

목표 50, 언어 32(문법 5·어휘 10·구성 10·상호작용 7), 합계 82.

## H-08 H-04를 상대역 규칙대로 고침

B2·실전, 종료 사유 `goal_completed`, 경로 `remake`. 사용자가 방법을 물은 뒤에만 직원이 두 처리를 제시한다.

| ID | 역할 | 대사 |
| --- | --- | --- |
| H-08-1 | 직원 | Hi. How can I help? |
| H-08-2 | 사용자 | Hi. I ordered a hot decaf latte, but I've been given an iced one, and the label says regular. |
| H-08-3 | 직원 | I'm sorry about that. How would you like me to fix it? |
| H-08-4 | 사용자 | Busy morning, huh? What are my options? |
| H-08-5 | 직원 | I can remake it hot and decaf at no extra charge in about five minutes, or cancel it and give you a full refund. |
| H-08-6 | 사용자 | Just to check, is five minutes the longest it might take? |
| H-08-7 | 직원 | Yes, it should be about five minutes. |
| H-08-8 | 사용자 | Great, then I'll go with the remake, please. |
| H-08-9 | 직원 | Perfect. I'll remake your hot decaf latte now. |

목표 6개와 언어 12개 모두 충족 후보다(합계 100). H-04와 같은 판단을 적용한다.
- 방법 질문(H-08-4)과 대기 시간 확인(H-08-6)은 필요한 확인이다.
- 단발 잡담은 간결성과 관련성의 경계이며 감점하지 않는다.

## 2차 새 사례(N-01~N-06)

작성·판정 후보 고정: 2026-11-16, H 사례 실행 뒤·N 사례 실행 전. H 사례를 모두 실행한 뒤 처음 보는 대화로 다시 확인하기 위해 만들었다. 직원 발화는 수정한 상대역 규칙을 따른다(문제를 들으면 원하는 처리를 묻고, 요청한 처리의 조건만 안내).

| 사례 | 수준·모드 | 핵심 | 목표 | 언어 | 합계 | 80% |
| --- | --- | --- | --- | --- | --- | --- |
| N-01 | A1·실전 | 단어·짧은 문장으로 충분히 해결 | 60 | 40 | 100 | 달성 |
| N-02 | B1·실전 | 카페인을 말하지 않고 재제조, 동사 형태 오류 반복 | 45 | 35 | 80 | 달성(경계) |
| N-03 | C·실전 | 관용 표현으로 간결하게 환불 | 60 | 40 | 100 | 달성 |
| N-04 | B2·실전 | 처리 요청 발화가 저장 누락 | 50/50 | 40/40 | 90/90 | 달성 |
| N-05 | A2·실전 | 재제조 요청 뒤 환불로 경로 변경 | 60 | 40 | 100 | 달성 |
| N-06 | B1·실전 | 요청 뒤 마음을 바꿔 합의 없이 종료 | 20 | 40 | 60 | 미달 |

### N-01 단어·짧은 문장으로 충분히 해결(A1·실전, `goal_completed`, `remake`)

| ID | 역할 | 대사 |
| --- | --- | --- |
| N-01-1 | 직원 | Hi. How can I help? |
| N-01-2 | 사용자 | Hot decaf latte. My order. This is iced. Regular. |
| N-01-3 | 직원 | Oh, I'm sorry. What would you like me to do? |
| N-01-4 | 사용자 | New one, please. Hot. Decaf. |
| N-01-5 | 직원 | Sure. I can make a new hot decaf latte, free. It takes about five minutes. Okay? |
| N-01-6 | 사용자 | Okay. I wait. |
| N-01-7 | 직원 | Great. I'll make your hot decaf latte now. |

18개 모두 충족 후보다. A1에서 단어를 병치하는 것은 맥락에서 성립하는 짧은 표현이며, 주문(N-01-2 앞부분)과 현재 음료(iced, regular)의 대조가 순서로 분명하다. 문장 구조는 경계다. N-01-6의 “I wait”는 단발이며 A1 기대 안에서 의미가 전달되므로 감점하지 않는다.

### N-02 카페인을 말하지 않고 재제조, 동사 형태 오류 반복(B1·실전, `goal_completed`, `remake`)

| ID | 역할 | 대사 |
| --- | --- | --- |
| N-02-1 | 직원 | Hi. How can I help? |
| N-02-2 | 사용자 | Hello. I order a hot latte, but this one was cold, so I am not happy. |
| N-02-3 | 직원 | I'm sorry about that. What would you like me to do? |
| N-02-4 | 사용자 | Can you make again the drink? Hot one. |
| N-02-5 | 직원 | Of course. I can remake it hot at no extra charge. It will take about five minutes. Is that okay? |
| N-02-6 | 사용자 | Five minutes is okay. I will waiting. |
| N-02-7 | 직원 | Great. I'll remake your latte hot now. |

| 기준 | 후보 | 근거와 경계 |
| --- | --- | --- |
| 카페인 전달·최종 카페인 해결 | 미충족 | 디카페인을 말하지 않았고, 재제조 내용에 카페인 조건이 없다. |
| 나머지 목표 4개 | 충족 | 온도 전달(N-02-2), 재제조 요청(N-02-4), 수락(N-02-6)과 확정(N-02-7). |
| 의미 관계(4) | 부분 충족 | 시제가 어긋나고(order / was), N-02-6의 “will waiting”이 시간 관계를 불안정하게 나타낸다. 의미는 전달된다. |
| 문장 구조(3) | 부분 충족 | “make again the drink”의 어순과 “will waiting”. |
| 안정성(3) | 부분 충족 | 동사 형태 문제가 N-02-2·4·6에 걸쳐 반복된다. |
| 단어 조합(3) | 충족(경계) | “make again”의 어색함은 어순 문제로 보고 문장 구조에서 판정한다(DEC-090에서 유지). |
| 필요한 설명·확인·수정(3) | 충족 | DEC-090으로 부분 충족에서 바꿨다(H-03과 같은 이유). |
| 나머지 언어 7개 | 충족 | but/so 연결, 공손한 요청, 제안에 맞는 응답. |

목표 45, 언어 35(문법 5·어휘 10·구성 10·상호작용 10), 합계 80으로 정확히 80% 달성 경계다. 처음 후보는 78.5(미달)였다.

### N-03 관용 표현으로 간결하게 환불(C·실전, `goal_completed`, `refund`)

| ID | 역할 | 대사 |
| --- | --- | --- |
| N-03-1 | 직원 | Hi. How can I help? |
| N-03-2 | 사용자 | Hi, I ordered a hot decaf latte, but this one's iced and the label says regular. |
| N-03-3 | 직원 | I'm so sorry. What would you like me to do? |
| N-03-4 | 사용자 | I'm actually in a bit of a rush, so could you just refund it? |
| N-03-5 | 직원 | Of course. I'll cancel the drink and give you a full refund, with no fee. Is that alright? |
| N-03-6 | 사용자 | Yes, that's great. Thanks for sorting it. |
| N-03-7 | 직원 | You're welcome. The full refund is done. |

18개 모두 충족 후보다. C에서 이 상황에 필요한 수행을 간결하고 자연스럽게 보였다. 더 긴 설명이나 협상을 요구하지 않는다.

### N-04 처리 요청 발화가 저장 누락(B2·실전, `goal_completed`, `refund`)

입력에 누락 표시가 있고, N-04-4(사용자 처리 요청)는 입력에 없다.

| ID | 역할 | 대사 |
| --- | --- | --- |
| N-04-1 | 직원 | Hi. How can I help? |
| N-04-2 | 사용자 | Hi. I ordered a hot decaf latte, but this one is iced and the label says regular. |
| N-04-3 | 직원 | I'm sorry about that. What would you like me to do? |
| N-04-5 | 직원 | Certainly. I can cancel this drink and give you a full refund, with no fee. Is that okay? |
| N-04-6 | 사용자 | Yes, please. That works for me. |
| N-04-7 | 직원 | Done. Your full refund has been processed. |

| 기준 | 후보 | 근거와 경계 |
| --- | --- | --- |
| 처리 요청 | 판정 불가 | 요청 발화가 누락됐다. 직원의 “Certainly”로 요청을 추정하지 않으며 미충족으로 단정하지도 않는다. |
| 나머지 목표 5개 | 충족 | 두 차이(N-04-2), 환불 수락(N-04-6)과 확정(N-04-7). |
| 안정성·앞선 연결 | 충족(경계) | 남은 두 발화(설명과 수락)로 구조의 일관성과 앞선 설명과의 연결을 볼 수 있다. |
| 나머지 언어 10개 | 충족 | |

목표 50/50(10 제외), 언어 40/40, 합계 90/90 = 100%.

### N-05 재제조 요청 뒤 환불로 경로 변경(A2·실전, `goal_completed`, `refund`)

| ID | 역할 | 대사 |
| --- | --- | --- |
| N-05-1 | 직원 | Hi. How can I help? |
| N-05-2 | 사용자 | I ordered a hot decaf latte. But this is iced, and it is regular. |
| N-05-3 | 직원 | I'm sorry. What would you like me to do? |
| N-05-4 | 사용자 | Can you make a new one, please? |
| N-05-5 | 직원 | Sure. I can remake it hot and decaf at no extra charge. It will take about five minutes. Is that okay? |
| N-05-6 | 사용자 | Oh, five minutes is long. Can I get a refund instead? |
| N-05-7 | 직원 | Of course. I can cancel this drink and give you a full refund, with no fee. Is that okay? |
| N-05-8 | 사용자 | Yes, please. Refund is better. |
| N-05-9 | 직원 | Okay. Your full refund is done. |

18개 모두 충족 후보다. 경로를 바꿨지만 처리 요청은 한 번만 인정한다. 최종 해결은 환불로 판정하며 중복 득점은 없다. 문장 첫머리의 “But”은 A2에서 대조가 분명하므로 감점하지 않는다.

### N-06 요청 뒤 마음을 바꿔 합의 없이 종료(B1·실전, `user_ended`, 경로 없음)

| ID | 역할 | 대사 |
| --- | --- | --- |
| N-06-1 | 직원 | Hi. How can I help? |
| N-06-2 | 사용자 | I ordered a hot decaf latte, but I got an iced regular one. |
| N-06-3 | 직원 | I'm sorry. What would you like me to do? |
| N-06-4 | 사용자 | Could you remake it as a hot decaf, please? |
| N-06-5 | 직원 | Of course. I can remake it hot and decaf at no extra charge. It will take about five minutes. Is that okay? |
| N-06-6 | 사용자 | Hmm, I'm not sure. Maybe I'll just keep this one. |
| N-06-7 | 직원 | Okay. Would you like me to do anything else about it, or keep the drink as it is? |
| N-06-8 | 사용자 | I want to end this conversation now. |
| N-06-9 | 직원 | Okay. We'll stop here. No replacement or refund has been agreed. |

| 기준 | 후보 | 근거와 경계 |
| --- | --- | --- |
| 두 차이·처리 요청 | 충족 | N-06-2·4. |
| 최종 해결 3개 | 미충족 | 허용된 처리에 합의하지 않았다. 음료를 그대로 두는 것은 허용 경로가 아니다. |
| 언어 12개 | 충족 | 문장은 정확하고 응답은 질문에 맞는다. 결정을 바꾼 것 자체는 앞선 연결의 불일치가 아니다. DEC-090으로 앞선 연결 후보를 부분 충족에서 바꿨다. |

목표 20, 언어 40, 합계 60(처음 후보 58.5).

## 3차 검증 사례(V-01~V-05)

작성·판정 후보 고정: 2026-11-16, DEC-090·091을 평가 지시에 반영한 뒤·V 사례 실행 전. H·N 결과를 보고 평가 지시를 고쳤으므로, 그 변경(누락 시 처리 요청, 요청 인정 범위, 어순)을 처음 보는 대화로 확인한다.

| 사례 | 수준·모드 | 확인할 것 | 목표 | 언어 | 합계 | 80% |
| --- | --- | --- | --- | --- | --- | --- |
| V-01 | B1·실전 | 요청 발화 누락: 처리 요청 판정 불가 | 50/50 | 37/40 | 87/90 | 달성 |
| V-02 | A2·실전 | 안내받은 선택지 중 하나를 고름: 요청 충족 | 60 | 40 | 100 | 달성 |
| V-03 | A2·실전 | “Okay. Yes.”만 하고 고르지 않음: 요청 미충족 | 10 | 36.5 | 46.5 | 미달 |
| V-04 | B2·실전 | 어순 오류 단발: 단어 조합 감점 없음 | 60 | 38.5 | 98.5 | 달성 |
| V-05 | A2·실전 | 누락됐지만 요청을 다시 말함: 요청 충족(과잉 판정 불가 방지) | 60 | 40 | 100 | 달성 |

### V-01 요청 발화 누락(B1·실전, `goal_completed`, `refund`, 누락 표시)

| ID | 역할 | 대사 |
| --- | --- | --- |
| V-01-1 | 직원 | Hi. How can I help? |
| V-01-2 | 사용자 | I ordered hot decaf latte, but this one is iced and it have caffeine. |
| V-01-3 | 직원 | I'm sorry about that. What would you like me to do? |
| V-01-5 | 직원 | Of course. I can cancel this drink and give you a full refund, with no fee. Is that okay? |
| V-01-6 | 사용자 | Yes, is fine. Thank you. |
| V-01-7 | 직원 | Your full refund is done. |

- **목표:**
  - 처리 요청은 판정 불가다. 요청 발화(V-01-4)가 누락됐고, V-01-6의 수락은 요청이 아니다(DEC-091).
  - 나머지 목표 5개는 충족이다. “it have caffeine”은 일반 카페인이라는 차이를 전달한다.
- **언어:**
  - 문장 구조는 부분 충족이다(“it have”, 주어 없는 “is fine”).
  - 안정성은 부분 충족이다. 형태 오류가 V-01-2와 V-01-6에서 반복된다.
  - 앞선 연결은 경계다. 남은 두 발화로 판단할 수 있다.
  - 나머지 언어 기준은 충족이다.
- **점수:** 목표 50/50, 언어 37, 합계 87/90.

### V-02 안내받은 선택지 중 하나를 고름(A2·실전, `goal_completed`, `refund`)

| ID | 역할 | 대사 |
| --- | --- | --- |
| V-02-1 | 직원 | Hi. How can I help? |
| V-02-2 | 사용자 | I ordered a hot decaf latte. This is iced and regular. |
| V-02-3 | 직원 | I'm sorry. What would you like me to do? |
| V-02-4 | 사용자 | I don't know. What can you do? |
| V-02-5 | 직원 | I can remake it hot and decaf at no extra charge in about five minutes, or cancel it and give you a full refund. |
| V-02-6 | 사용자 | Refund, please. |
| V-02-7 | 직원 | Of course. I'll cancel this drink and give you a full refund, with no fee. Is that okay? |
| V-02-8 | 사용자 | Yes. Thank you. |
| V-02-9 | 직원 | Your full refund is done. |

18개 모두 충족 후보다. V-02-6은 안내받은 선택지 중 하나를 직접 고른 처리 요청이다. V-02-4의 방법 질문은 필요한 확인이다.

### V-03 수락만 하고 고르지 않음(A2·실전, `user_ended`, 경로 없음)

| ID | 역할 | 대사 |
| --- | --- | --- |
| V-03-1 | 직원 | Hi. How can I help? |
| V-03-2 | 사용자 | I ordered a hot decaf latte, but this is iced and regular. |
| V-03-3 | 직원 | I'm sorry. What would you like me to do? |
| V-03-4 | 사용자 | Hmm. I don't know. |
| V-03-5 | 직원 | I can remake it hot and decaf at no extra charge in about five minutes, or cancel it and give you a full refund. Which would you prefer? |
| V-03-6 | 사용자 | Okay. Yes. |
| V-03-7 | 직원 | Sorry, I'm not sure which one you mean. A remake or a refund? |
| V-03-8 | 사용자 | I want to end this conversation now. |
| V-03-9 | 직원 | Okay. We'll stop here. No replacement or refund has been agreed. |

| 기준 | 후보 | 근거와 경계 |
| --- | --- | --- |
| 두 차이 | 충족 | V-03-2. |
| 처리 요청 | 미충족 | 두 선택지를 듣고도 고르지 않았다. “Okay. Yes.”는 요청이 아니다(DEC-091). |
| 최종 해결 3개 | 미충족 | 합의가 없다. |
| 상대 말에 맞는 응답(4) | 부분 충족 | V-03-6이 “어느 쪽이냐”는 질문의 요구(선택)에 답하지 않았다. V-03-2는 맞는 응답이다. |
| 필요한 설명·확인·수정(3) | 부분 충족(경계) | 직원의 확인 요청(V-03-7)에 명료화하지 않고 종료했다. 처음 설명은 충분했다. |
| 나머지 언어 10개 | 충족 | |

목표 10, 언어 36.5, 합계 46.5.

### V-04 어순 오류 단발(B2·실전, `goal_completed`, `remake`)

| ID | 역할 | 대사 |
| --- | --- | --- |
| V-04-1 | 직원 | Hi. How can I help? |
| V-04-2 | 사용자 | Hi. I ordered a hot decaf latte, but you gave me an iced one, and the label says regular. |
| V-04-3 | 직원 | I'm sorry about that. What would you like me to do? |
| V-04-4 | 사용자 | Could you make hot it again, and decaf this time, please? |
| V-04-5 | 직원 | Of course. I can remake it hot and decaf at no extra charge. It will take about five minutes. Is that okay? |
| V-04-6 | 사용자 | That's fine. I can definitely wait five minutes. |
| V-04-7 | 직원 | Great. I'll remake your hot decaf latte now. |

- **문장 구조:** 부분 충족(경계). V-04-4의 “make hot it again” 어순이 B2 요청 구조로 성립하지 않는다.
- **단어 조합:** 충족. 어순은 문장 구조에서만 본다(DEC-090).
- **안정성:** 충족. 단발 오류이고 나머지 구조는 일관된다.
- **나머지:** 목표 6개와 나머지 언어 기준은 모두 충족이다.
- **점수:** 목표 60, 언어 38.5, 합계 98.5.

### V-05 누락됐지만 요청을 다시 말함(A2·실전, `goal_completed`, `refund`, 누락 표시)

| ID | 역할 | 대사 |
| --- | --- | --- |
| V-05-1 | 직원 | Hi. How can I help? |
| V-05-2 | 사용자 | I ordered a hot decaf latte. But this is iced, and it is regular. |
| V-05-3 | 직원 | I'm sorry. What would you like me to do? |
| V-05-5 | 직원 | Sorry, I didn't catch that. Could you say that again? |
| V-05-6 | 사용자 | A refund, please. I'm in a hurry. |
| V-05-7 | 직원 | Of course. I'll cancel this drink and give you a full refund, with no fee. Is that okay? |
| V-05-8 | 사용자 | Yes, thank you. |
| V-05-9 | 직원 | Your full refund is done. |

18개 모두 충족 후보다. 누락은 있지만 V-05-6에서 요청을 다시 말했으므로 처리 요청은 확인된다. 누락 표시만 보고 판정 불가로 두지 않는다.

## 실행·판단 규칙

- 실행 전에 이 문서와 코드 사본을 고정한다. 실행 결과는 날짜별 worklog에 남긴다.
- 기존 9개 사례와의 일치율 차이로 과적합을 판단한다. 경계 기준과 그 밖의 기준을 나눠 본다. 80% 달성 여부가 바뀌는지는 따로 본다.
- 불일치가 나오면 다음 둘 중 하나로 분류해 사용자와 검토한다. 이 결과로 평가 지시를 바로 고치지 않는다.
  - 판정 후보가 정책과 다르다(후보 오류).
  - 모델이 정책과 다르다(평가 오류).
