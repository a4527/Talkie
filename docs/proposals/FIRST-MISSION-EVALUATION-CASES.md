# 첫 카페 미션의 수준별 합성 평가 사례

작성일: 2026-11-05. 대본 고정: 2026-11-09. **사례별 판정은 검토용 후보**다. 기존 정책의 적용을 대조하기 위한 자체 합성 대화이며 공식 CEFR 평가표·실제 AI 실행 결과·확정된 수준별 채점 정답표가 아니다. 시작 시 선택 수준을 고정한다. 대화가 쉬워 보인다는 이유로 선택 수준을 바꾸지 않는다.

기준 정책은 [PRD 4.2~4.5절](../PRD.md#42-일반-대화), 수준 설명은 [미션 설계](../design/MISSIONS.md#언어-수준별-설명), 선행 논의는 [첫 미션 상세 검토안](FIRST-MISSION-DETAILS.md)을 따른다. 목표 배점·언어 배점·판정 불가 계산을 여기서 재정의하지 않는다. 아래 발화 ID는 합성 사례 안에서만 사용하는 식별자이며 실제 저장/API 필드 제안이 아니다.

## 사례를 읽는 방법

각 대화는 실전 모드의 전사문과 재생 완료가 확인된 상황을 가정한다. 직원은 처음에 사용자 주문·불일치·해결 의도를 모른다. 언어 근거는 사용자 발화이고 직원 발화는 질문·제안·수락의 맥락이다. 실제 발음·속도·억양은 이 자료로 평가하지 않는다.

각 수준에서 12개 기준을 모두 대조한다. 아래 표의 설명은 **그 기준을 판단할 때 볼 근거와 한계**이지 해당 문장에 고정 점수를 붙이는 규칙이 아니다. 충족·부분 충족·미충족의 판정 초안은 뒤의 대조 사례에서 비교한다. 특히 짧은 성공 대화만으로 C1/C2의 안정성·유연성을 확정하지 않는다. 관찰된 단순 수행과 관찰되지 않은 높은 수준의 능력을 구분한다.

## A1 — 짧은 표현으로 조건을 전달

| ID | 역할 | 대화 |
| --- | --- | --- |
| A1-1 | 직원 | Hi. How can I help? |
| A1-2 | 사용자 | My order was a hot decaf latte. This is iced. The label says regular. |
| A1-3 | 직원 | I'm sorry. Would you like a hot decaf latte instead? It will be free. It will take about five minutes. |
| A1-4 | 사용자 | Five minutes? |
| A1-5 | 직원 | Yes. About five minutes. Is that okay? |
| A1-6 | 사용자 | Yes, please. I can wait. |
| A1-7 | 직원 | Okay. I'll remake your hot decaf latte now, at no extra charge. |

A1-2는 원래 주문과 현재 음료를 명시적으로 구분하도록 고정했다. 이전 “A hot latte, please. Decaf.”는 원래 주문 설명/새 주문의 모호성 검토 자료로만 보존하며 현재 기본 입력에 포함하지 않는다. 문장이 짧다는 이유로 실패시키지 않는다. A1-4는 관련 확인이며 무진전이 아니다.

## A2 — 단순 설명과 요청

| ID | 역할 | 대화 |
| --- | --- | --- |
| A2-1 | 직원 | Hi. How can I help? |
| A2-2 | 사용자 | I ordered a hot decaf latte, but this is iced and the label says regular. Could you make it hot and decaf? |
| A2-3 | 직원 | I'm sorry. I can remake it at no extra charge. It will take about five minutes. Is that okay? |
| A2-4 | 사용자 | Yes, please. I can wait five minutes. |
| A2-5 | 직원 | Thank you. I'll remake your hot decaf latte now. |

A2-2와 A2-4를 함께 판단한다. 필요한 정보가 한 번에 전달됐으므로 재확인·추가 질문을 강제하지 않는다. 짧은 대화가 완결된 이유와 광범위한 언어 안정성의 근거 한계는 구분한다.

## B1 — 이유를 설명하고 경로 변경

| ID | 역할 | 대화 |
| --- | --- | --- |
| B1-1 | 직원 | Hi. How can I help? |
| B1-2 | 사용자 | I ordered a hot decaf latte, but this one is iced and marked regular. Could you remake it, please? |
| B1-3 | 직원 | I'm sorry. I can remake it at no extra charge. It will take about five minutes. Is that okay? |
| B1-4 | 사용자 | I have to leave soon, so I can't wait five minutes. Could you cancel it and give me a full refund instead? |
| B1-5 | 직원 | Of course. I can cancel this drink and refund the full amount, with no fee. Would you like me to do that? |
| B1-6 | 사용자 | Yes, please. A full refund would be better. |
| B1-7 | 직원 | Okay. I'll cancel the drink and process the full refund now. |

B1-4는 사용자가 자신의 시간 사정을 설명하는 것이며 직원이 새 장애를 추가한 것이 아니다. 초기 재제조 요청과 최종 환불 합의를 중복 득점하지 않는다. 이유 설명·대안 전환은 진전이고 정상 해결이다.

## B2 — 대안을 비교하고 조건을 명확히 함

| ID | 역할 | 대화 |
| --- | --- | --- |
| B2-1 | 직원 | Hi. How can I help? |
| B2-2 | 사용자 | I ordered a hot decaf latte, but this is iced and the label says regular. What can you do to put that right? |
| B2-3 | 직원 | I'm sorry. I can remake it hot and decaf at no extra charge in about five minutes, or cancel it and give you a full refund with no fee. |
| B2-4 | 사용자 | I'd prefer the drink, but I don't have time to wait. A full refund would be more practical. Please cancel the order. |
| B2-5 | 직원 | Certainly. Shall I cancel this drink and refund the full amount? |
| B2-6 | 사용자 | Yes, please. That works for me. |
| B2-7 | 직원 | I'll cancel it and process the full refund now. |

B2-4의 선호·제약·최종 선택 관계를 확인한다. 어려운 단어나 긴 답이 없다는 이유로 감점하지 않는다. A2 사례에 B2를 적용해도 비교가 필요하지 않았다는 이유로 비교 표현을 강제하지 않는다.

## C1 — 의도와 말투를 상황에 맞게 조정

| ID | 역할 | 대화 |
| --- | --- | --- |
| C1-1 | 직원 | Hi. How can I help? |
| C1-2 | 사용자 | I think there's been a mix-up: I ordered a hot decaf latte, but this is iced and labelled regular. Could you let me know what you can do? |
| C1-3 | 직원 | I'm sorry. We can remake it at no extra charge in about five minutes, or cancel it and give you a full refund with no fee. |
| C1-4 | 사용자 | Thanks. I'd normally be happy to wait, but I need to leave now. In that case, could you cancel this drink and refund the full amount? |
| C1-5 | 직원 | Certainly. Shall I go ahead with the cancellation and full refund? |
| C1-6 | 사용자 | Yes, please. I appreciate your help. |
| C1-7 | 직원 | I'll cancel the drink and process the full refund now. |

C1-2의 완곡한 문제 제기와 C1-4의 조건부 선호는 관찰 가능하다. 심각한 갈등·간접적 우려의 해석·다양한 상황에서의 유연성은 이 대화에 없다. 이를 관찰하려고 직원을 공격적으로 만들거나 환불을 방해하지 않는다.

## C2 — 의미 차이를 정밀하게 표현

| ID | 역할 | 대화 |
| --- | --- | --- |
| C2-1 | 직원 | Hi. How can I help? |
| C2-2 | 사용자 | I ordered a hot decaf latte; this one's iced, and the label says regular. I haven't tried it, so I can only go by the label, but it doesn't match what I ordered. What are my options? |
| C2-3 | 직원 | I'm sorry. I can remake it hot and decaf at no extra charge in about five minutes, or cancel it and give you a full refund with no fee. |
| C2-4 | 사용자 | I'd rather have the drink, but I can't spare the time today. Please cancel it and refund the full amount; I don't need a replacement. |
| C2-5 | 직원 | Of course. Shall I proceed with the cancellation and full refund? |
| C2-6 | 사용자 | Yes, please. Thank you. |
| C2-7 | 직원 | I'll cancel it and process the full refund now. |

C2-2는 표시에서 확인한 사실과 직접 마셔 확인하지 않은 사실을 구분한다. 카페인 함유를 사용자가 실제 측정해야 한다는 새 목표는 아니다. C2-4는 선호와 실제 결정을 구분한다. 이 정도의 짧은 표본으로 C2 전체 능력을 인증하거나 모든 세부 기준의 충족을 확정하지 않는다.

## 12개 기준별 수준 대조

아래 열은 각 선택 수준의 위 전체 대화를 가리킨다. 관찰 기회가 없는 수행을 억지로 요구하지 않되 실제 실패를 관찰 부족으로 바꾸지 않는다. 같은 오류에 별개의 영향이 없다면 여러 기준을 자동 감점하지 않는다.

| 기준 | A1 | A2 | B1 | B2 | C1 | C2 |
| --- | --- | --- | --- | --- | --- | --- |
| 문법: 의미 관계 | 2의 원하는 것/현재 음료 대조를 문맥으로 확인 | 2의 주문·현재·대조 | 2·4의 문제·시간·전환 | 2·4의 문제·선호·제약 | 2·4의 추정·조건부 선택 | 2의 확인 사실/미확인 사실, 4의 선호/결정 |
| 문법: 문장 구조 | 2의 정형 요청, 6의 짧은 진술. 완전한 복문을 요구하지 않음 | 2의 진술·요청, 4의 답변 | 2·4·6의 요청·이유·수락 | 2·4·6의 질문·대조·선택 | 2·4의 완곡 요청·조건 구문 | 2·4의 복합 관계를 명료하게 유지하는지 |
| 문법: 수준별 안정성 | 2·4·6의 기본 표현 일관성. 표본은 제한적 | 2·4에서 관찰된 기본 구조만 판단 | 2·4·6의 연결·요청 구조 | 2·4·6의 비교·결정 구조 | 2·4·6에 오류가 없다는 사실만으로 높은 수준의 폭넓은 안정성 확정 금지 | 복합 설명은 관찰되지만 장면/표본의 한계가 커 추가 근거 필요 여부 검토 |
| 어휘: 의도에 맞는 단어 | hot/decaf/iced/regular, wait | 주문·불일치·재제조 조건 | leave/wait/cancel/refund | prefer/practical/cancel | mix-up/labelled/in that case | label/go by/spare/replacement의 정확한 의미 |
| 어휘: 단어 조합 | hot latte, label says regular | hot decaf latte, make it hot | full refund, leave soon | put that right, time to wait | happy to wait, refund the full amount | go by the label, spare the time |
| 어휘: 상황 표현 | please와 직접적이지만 적절한 요청 | Could you…와 수락 | 전환 요청과 수락 | 선호 설명과 명확한 요청 | 완곡함·분명한 요구의 조정 | 사실 한계와 요구를 구분한 정밀한 표현 |
| 구성: 정보 순서 | 원하는 조건→불일치→대기 확인 | 주문→불일치→요청→수락 | 문제→제안→이유→전환 | 문제→대안→선택 이유→수락 | 문제 제기→선택지→상황 설명→요청 | 사실/확인 범위→대안→선호/결정 |
| 구성: 필요한 연결 | 짧은 문맥 연결로 충분한지. 접속사 부재 자동 감점 금지 | but/and의 대조·병렬 | so/instead의 이유·전환 | but의 선호·현실 대조 | normally/but/in that case의 조건 관계 | so/but의 근거 한계·선택 관계 |
| 구성: 간결성과 관련성 | 짧아도 조건이 충분한지 | 2·4가 문제 해결에 관련됨 | 시간 사정은 전환 이유로 관련됨 | 비교가 최종 선택으로 이어짐 | 정중 표현이 핵심 요청을 가리지 않음 | 사실 한계 설명이 관련되지만 장황함 자체를 가점하지 않음 |
| 상호작용: 맞는 응답 | 4의 대기 질문, 6의 수락 | 4가 3의 구체 제안에 응답 | 4·6이 제안/확인에 대응 | 4가 선택지에 답하고 6이 수락 | 4·6이 선택지/확인에 대응 | 4·6이 선택지/확인에 대응 |
| 상호작용: 필요한 대응 | 필요한 대기 확인. 이를 다른 사례의 필수 행동으로 일반화 금지 | 추가 확인 없이 정확한 수락 | 대기 불가를 설명하고 경로 변경 | 선호와 제약을 설명해 선택 | 상대 제안 인정 후 조건에 맞게 요청 | 미확인 사실을 단정하지 않고 필요한 선택을 명료화 |
| 상호작용: 앞선 연결 | 6이 2의 음료 조건·5의 시간을 유지 | 4가 2의 요청을 유지 | 6이 최종 환불 선택을 유지 | 6이 4의 취소/환불을 유지 | 6이 4의 선택을 유지 | 6이 4의 대체 음료 없는 환불을 유지 |

각 행을 채점 정답으로 쓰기 전 선택 수준에서의 충족·부분 충족·미충족·판정 불가를 검토해야 한다. 기본 C1/C2 사례의 개별 등급은 확정하지 않았다. DEC-083에 따른 동일 입력의 수준 대조 후보는 아래 U-02에 구체화했다. 수준이 높다고 모든 기준을 일괄 판정 불가로 만들거나 관찰된 적절한 수행까지 무시하지 않는다.

## 등급을 가르는 대조 사례

아래는 평가에서 구별해야 할 여덟 상황이다. **판정은 검토 후보이며 실제 AI 시험 결과는 아니다.** 각 사례는 상황과 평가 요점을 먼저 읽고, 필요할 때 전체 대화와 세부 근거를 펼쳐 볼 수 있다.

- [문장은 불완전하지만 요청은 분명한 경우](#p-01)
- [같은 문법 오류를 반복해도 해결은 되는 경우](#p-02)
- [말을 바꿔 원하는 온도를 알 수 없는 경우](#f-01)
- [질문에 계속 엉뚱한 답을 하는 경우](#f-02)
- [기록이 빠져 마지막 수락만 남은 경우](#u-01)
- [높은 수준을 선택하고 짧게 잘 해결한 경우](#u-02)
- [교정받은 표현을 나중에 스스로 적용한 경우](#r-01)
- [오류를 반복하다 마지막에 한 번 따라 한 경우](#r-02)

전체 대본은 2026-11-09 고정했다. 각 대본에 적힌 발화만 순서대로 입력한다. 별도 사건이 없으면 저장·재생 완료와 정확한 전사를 가정하며, 기록 누락 사례만 예외다. 이는 시험용 가정이며 실제 기술 검증 결과가 아니다. 세부 표에 없는 기준을 자동 만점으로 채우거나 전체 점수를 확정하지 않는다. 발화 식별자는 펼친 세부 자료에서 근거를 찾을 때 사용한다.

<a id="p-01"></a>

### 문장은 불완전하지만 요청은 분명한 경우

**상황:** 사용자가 “This iced, label regular.”라고 말한 뒤 따뜻한 디카페인으로 다시 만들어 달라고 요청합니다.

**평가 요점:** 문장 구조는 부분 충족 후보입니다. 주문과 실제 음료의 차이·원하는 처리는 전달했으므로, 같은 오류 때문에 미션 목표까지 감점하지 않습니다.

<details>
<summary>전체 대화와 항목별 판정 근거</summary>

검토 식별자: `P-01`.
A2·실전. 단편적 구조와 의미 전달을 구분한다.

| ID | 역할 | 고정 대사 |
| --- | --- | --- |
| P-01-1 | 직원 | Hi. How can I help? |
| P-01-2 | 사용자 | I ordered hot decaf. This iced, label regular. Could you make it hot and decaf? |
| P-01-3 | 직원 | I’m sorry. I can remake your latte hot and decaf at no extra charge. It will take about five minutes. Is that okay? |
| P-01-4 | 사용자 | Yes, please. I can wait five minutes. |
| P-01-5 | 직원 | Thank you. I’ll remake your hot decaf latte now. |

| 기준/결과 | 판정 후보 | 근거·반대 근거와 경계 |
| --- | --- | --- |
| 문장 구조 | 부분 충족 | P-01-2의 This iced / label regular는 필요한 서술 구조가 불완전하다. 요청과 P-01-4의 수락은 완전하므로 전체 미충족으로 단정하지 않는다. |
| 의미 관계·단어 선택 | 충족 | P-01-2의 ordered와 this, hot/iced·decaf/regular가 원래 조건과 현재 차이를 구별하고 재제조 요청도 명확하다. |
| 안정성 | 충족 후보·경계 검토 | P-01-2의 생략은 구조 항목에서 검토한다. P-01-4까지 의미 관계는 일관되며 별개의 대화 전반 불안정 근거 없이 중복 감점하지 않는다. |
| 상대에 맞는 응답·앞선 연결 | 충족 | P-01-4는 구체 조건·대기 시간을 수락한다. |
| 목표 | 여섯 항목 충족 후보 | P-01-2에서 두 불일치·요청, P-01-3~5에서 조건 제안·수락·확정이 연결된다. |

구조 하나만 부분 충족이고 나머지 11개가 충족이라는 추가 판정이 성립할 때에만 기존 조건부 98.5점 예시를 적용할 수 있다. 이 표만으로 전체 점수를 확정하지 않는다.

</details>

<a id="p-02"></a>

### 같은 문법 오류를 반복해도 해결은 되는 경우

**상황:** 사용자가 “Could you making…”을 두 번 쓰지만, 재제조를 요청하고 5분 대기에도 동의합니다.

**평가 요점:** 반복된 문장 구조 오류는 평가에 반영합니다. 대기 수락은 대화의 진전이며, 같은 오류로 안정성까지 함께 감점하려면 별도 근거가 필요합니다.

<details>
<summary>전체 대화와 항목별 판정 근거</summary>

검토 식별자: `P-02`.
B1·실전. 반복 오류를 첫 요청·후속 요청의 정확한 위치에 고정했다. 기존 개요의 환불 전환은 제거하고 재제조 재요청으로 통일했다.

| ID | 역할 | 고정 대사 |
| --- | --- | --- |
| P-02-1 | 직원 | Hi. How can I help? |
| P-02-2 | 사용자 | I ordered a hot decaf latte, but this is iced and marked regular. Could you making it hot and decaf? |
| P-02-3 | 직원 | I’m sorry. I can remake it at no extra charge. It will take about five minutes. Is that okay? |
| P-02-4 | 사용자 | I can wait five minutes. Could you making it hot and decaf, please? |
| P-02-5 | 직원 | Certainly. I’ll remake your hot decaf latte now at no extra charge. |

| 기준/결과 | 판정 후보 | 근거·반대 근거와 경계 |
| --- | --- | --- |
| 문장 구조 | 부분 충족 | P-02-2·4에서 Could you making이 반복된다. 요청은 이해되며 다른 진술 구조는 유지된다. |
| 안정성 | 별도 감점 근거 미확정 | 동일한 형태 오류의 반복만 다시 인용해 구조·안정성을 함께 깎지 않는다. 설명/응답의 다른 구조와 의미 관계가 유지되는 반대 근거도 있다. |
| 의미 관계·상대에 맞는 응답 | 충족 | P-02-2가 두 차이를 전달하고 P-02-4는 대기 가능 여부에 답한다. |
| 무진전 | 실패 근거 아님 | P-02-4의 대기 수락은 새 정보다. 요청 반복만 보고 무진전으로 세지 않는다. |
| 목표 | 여섯 항목 충족 후보 | P-02-2의 설명/요청과 P-02-3~5의 구체 제안·대기 수락·확정이 연결된다. |

반복 형태 오류가 여러 기준에 실제로 별개의 영향을 주는 사례는 별도 보강 대상이다. 본 대본에서는 그 영향을 지어내지 않는다.

</details>

<a id="f-01"></a>

### 말을 바꿔 원하는 온도를 알 수 없는 경우

**상황:** 처음에는 주문을 설명했지만 이후 “Hot. No, iced.”처럼 온도를 계속 뒤집고, 결국 사용자가 종료를 요청합니다.

**평가 요점:** 확인 질문을 받아도 원하는 온도를 전달하지 못했으므로 단어 사용은 미충족 후보입니다. 처음 전달한 문제 설명은 인정하되, 최종 해결에 합의했다고 보지는 않습니다.

<details>
<summary>전체 대화와 항목별 판정 근거</summary>

검토 식별자: `F-01`.
A2·실전. 의미 혼란은 사용자의 확인된 수행이며 기술적 전사 오류가 아니다. 사용자가 명시적으로 종료한다.

| ID | 역할 | 고정 대사 |
| --- | --- | --- |
| F-01-1 | 직원 | Hi. How can I help? |
| F-01-2 | 사용자 | I ordered a hot decaf latte, but this is iced and marked regular. Could you remake it? |
| F-01-3 | 직원 | I’m sorry. I can remake it hot and decaf at no extra charge in about five minutes. Is that okay? |
| F-01-4 | 사용자 | I want it iced. No, hot means iced. |
| F-01-5 | 직원 | Do you want the replacement hot or iced? |
| F-01-6 | 사용자 | Hot. No, iced. Hot is not hot. |
| F-01-7 | 직원 | I’m not sure which temperature you want. Which should I make: hot or iced? |
| F-01-8 | 사용자 | Iced means hot. I want hot, not hot. |
| F-01-9 | 사용자 | I want to end this conversation now. |
| F-01-10 | 직원 | Okay. We’ll stop here. No replacement or refund has been agreed. |

| 기준/결과 | 판정 후보 | 근거·반대 근거와 경계 |
| --- | --- | --- |
| 의도에 맞는 단어 | 미충족 | F-01-4·6·8이 hot/iced 의미를 반복적으로 뒤집어 최종 온도 선택을 방해한다. F-01-2의 최초 명확한 설명은 반대 근거지만 이후 혼란을 없애지 않는다. |
| 의미 관계 | 별도 등급 미확정 | 같은 온도 혼란을 단어 항목과 자동 중복 감점하지 않는다. 별개의 문법상 관계 문제가 있는지 추가 검토한다. |
| 필요한 설명·확인·수정 | 부분 충족 후보 | 최초 설명은 충분하나 F-01-5·7의 확인에 온도를 명료화하지 못한다. 단어 오류와 별개의 상호작용 영향인지 중복 검토가 필요하다. |
| 목표 | 설명 둘·요청 충족, 최종 해결/합의 미충족 후보 | F-01-2의 두 불일치·요청은 보존한다. 재제조 제안을 수락하지 않았고 F-01-10은 미합의 상태를 확인한다. 제안만으로 카페인 해결 항목도 자동 인정하지 않는다. |
| 종료 | 명시적 종료 | F-01-9가 종료 요청이다. 무진전 횟수·자동 실패 임계값을 이 대본에서 판정하지 않는다. |

수행이 확인되므로 단어 항목을 판정 불가로 제외해 점수를 높이지 않는다. 실전 실패에 따른 추가 벌점은 없다.

</details>

<a id="f-02"></a>

### 질문에 계속 엉뚱한 답을 하는 경우

**상황:** 직원이 대기 가능 여부와 재제조·환불 선택을 물어도 사용자는 자전거·달·호랑이 이야기만 합니다.

**평가 요점:** 문장이 문법적으로 맞아도 질문에 맞는 응답은 미충족 후보입니다. 무관 응답 3회는 실전 종료를 검토할 시험 사례이며, 운영 횟수를 확정한 것은 아닙니다.

<details>
<summary>전체 대화와 항목별 판정 근거</summary>

검토 식별자: `F-02`.
B1·실전. 직원 질문 3개에 대한 무관 응답 3개를 고정했다. 모두 재생/저장 확인·제외 사건 없음이라는 가정이다.

| ID | 역할 | 고정 대사 |
| --- | --- | --- |
| F-02-1 | 직원 | Hi. How can I help? |
| F-02-2 | 사용자 | I ordered a hot decaf latte, but this is iced and marked regular. Could you remake it? |
| F-02-3 | 직원 | I’m sorry. I can remake it at no extra charge in about five minutes. Is waiting five minutes okay? |
| F-02-4 | 사용자 | My neighbour has a blue bicycle. |
| F-02-5 | 직원 | If you can’t wait, I can cancel the drink and give you a full refund. Would you prefer a remake or a refund? |
| F-02-6 | 사용자 | The moon looks round tonight. |
| F-02-7 | 직원 | We haven’t agreed on a solution. What would you like me to do about this drink? |
| F-02-8 | 사용자 | My favourite animal is a tiger. |
| F-02-9 | 직원 | We haven’t been able to agree on how to resolve this, so we’ll stop here. |

| 기준/결과 | 판정 후보 | 근거·반대 근거와 경계 |
| --- | --- | --- |
| 상대 말에 맞는 응답 | 미충족 | F-02-4·6·8 모두 직전 질문에 답하지 않는다. 최초 F-02-2는 관련 설명이지만 이후 세 기회에서 선택이 진행되지 않는다. |
| 문장 구조 | 충족 후보 | F-02-2·4·6·8의 구조는 의미를 표현한다. 무관하다는 이유만으로 문법까지 미충족시키지 않는다. |
| 간결성과 관련성·앞선 연결 | 별개 영향 검토 필요 | 무관 응답이 두 기준에도 걸리지만 같은 사건을 자동 다중 감점하지 않는다. 별도 영향이 설명되지 않으면 등급을 보류한다. |
| 목표 | 설명 둘·요청 충족, 최종 해결/합의 미충족 후보 | F-02-2의 설명·요청은 인정하되 이후 어떤 경로도 합의하지 않았다. |
| 무진전 | 연속 3회 검증 후보 | F-02-3→4, 5→6, 7→8을 근거쌍으로 연결한다. 5의 대안 제공과 7의 열린 확인은 새 확인 기회이며 이미 답한 정보를 재질문한 사건이 아니다. |

직원의 F-02-9를 입력에 포함했으므로 이는 종료 후 평가 사례다. 실제 AI가 이 마지막 대사를 자발적으로 올바른 시점에 생성하는지 검증하려면 F-02-8까지의 접두 입력으로 별도 실행해야 한다. 여기서는 실행하지 않았다.

</details>

<a id="u-01"></a>

### 기록이 빠져 마지막 수락만 남은 경우

**상황:** 사용자의 문제 설명은 저장되지 않았고 “Yes, please. I can wait five minutes.”와 직원의 처리 확정만 남았습니다.

**평가 요점:** 남아 있는 수락은 평가할 수 있습니다. 빠진 설명·요청은 직원 말로 추정하거나 사용자 실패로 처리하지 않고 판정 불가를 검토합니다.

<details>
<summary>전체 대화와 항목별 판정 근거</summary>

검토 식별자: `U-01`.
A2·실전. 평가자에게 사용자 설명 한 발화가 저장 누락됐다는 사건을 명시한다. 누락 원문은 제공하거나 복원하지 않는다.

| ID | 역할 | 고정 대사 |
| --- | --- | --- |
| U-01-1 | 직원 | Hi. How can I help? |
| U-01-2 | 직원 | I’m sorry. I can remake your latte hot and decaf at no extra charge. It will take about five minutes. Is that okay? |
| U-01-3 | 사용자 | Yes, please. I can wait five minutes. |
| U-01-4 | 직원 | Thank you. I’ll remake your hot decaf latte now. |

| 기준/결과 | 판정 후보 | 근거·반대 근거와 경계 |
| --- | --- | --- |
| 의미 관계·문장 구조 | 남은 수락 범위의 충족 후보 | U-01-3의 수락과 대기 진술은 분명하다. 누락된 설명까지 충족했다고 확장하지 않는다. |
| 안정성 | 판정 불가 후보 | U-01-3 한 번의 수락/대기 진술만으로 설명·요청을 포함한 구조의 일관성을 확인하기 어렵다. 짧다는 사실 자체보다 누락된 수행 범위를 이유로 기록한다. |
| 단어 선택·단어 조합·상황 표현 | 남은 수행의 충족 후보 | U-01-3의 wait five minutes와 정중한 수락은 적절하다. 직원의 hot/decaf를 사용자 어휘 근거로 쓰지 않는다. |
| 정보 순서·이유/대조/조건 연결 | 판정 불가 후보 | 원래 주문→차이→요청의 사용자 수행이 누락됐다. 이 대본에는 그 구성·관계 수행의 확인 기회가 없다. |
| 간결성과 관련성·상대에 맞는 응답·필요한 대응·앞선 연결 | 남은 수행의 충족 후보 | U-01-3이 U-01-2의 제안과 대기 조건에 직접 응답한다. 존재하지 않는 추가 설명을 요구하지 않는다. |
| 목표 | 문제 전달 둘·처리 요청은 판정 불가 후보, 최종 세 항목은 충족 후보 | 직원 제안으로 누락된 사용자 문제 전달·요청을 추정하지 않는다. U-01-2~4에는 온도/카페인 조건의 구체 제안·수락·확정이 남아 있다. |

위 표는 언어 12개 기준을 모두 다룬다. 누락이 알려진 사례이며 실제 미수행 사례와 다르다. 전 항목을 일괄 제외하거나 기본 대화의 100점을 재사용하지 않는다.

</details>

<a id="u-02"></a>

### 높은 수준을 선택하고 짧게 잘 해결한 경우

**상황:** C1 또는 C2를 선택한 사용자가 쉬운 문장으로 문제와 요청을 정확히 전달하고 직원 제안을 수락합니다.

**평가 요점:** 이번 상황에 필요한 수행이 충분하면 충족 후보입니다. 어려운 표현을 쓰지 않았다는 이유로 감점하지 않으며, 이 점수로 종합 영어 수준을 인증하지 않습니다.

<details>
<summary>전체 대화와 항목별 판정 근거</summary>

검토 식별자: `U-02`.
실전. 아래 동일 대본을 선택 수준 C1 및 C2로 각각 평가한다. 수준만 바꾸며 발화는 바꾸지 않는다.

| ID | 역할 | 고정 대사 |
| --- | --- | --- |
| U-02-1 | 직원 | Hi. How can I help? |
| U-02-2 | 사용자 | I ordered a hot decaf latte, but this is iced and the label says regular. Could you make it hot and decaf? |
| U-02-3 | 직원 | I’m sorry. I can remake it at no extra charge. It will take about five minutes. Is that okay? |
| U-02-4 | 사용자 | Yes, please. I can wait five minutes. |
| U-02-5 | 직원 | Thank you. I’ll remake your hot decaf latte now. |

| 기준/결과 | 판정 후보 | 근거·반대 근거와 경계 |
| --- | --- | --- |
| 의미 관계·문장 구조·안정성 | C1/C2 각각 충족 후보 | U-02-2·4의 주문/현재 대조·요청·대기 수락이 정확하고 일관된다. 필요한 관계의 반대 근거는 이 합성 입력에서 발견되지 않았다. 고급 구문 부재만으로 제외하지 않는다. |
| 단어 선택·단어 조합·상황 표현 | C1/C2 각각 충족 후보 | U-02-2의 온도/카페인 구분과 정중한 요청, U-02-4의 자연스러운 수락이 이 상황에 충분하다. 더 어려운 동의어를 강제하지 않는다. |
| 정보 순서·필요한 연결·간결성과 관련성 | C1/C2 각각 충족 후보 | U-02-2의 주문→차이→요청, but/and, U-02-4의 짧은 수락이 필요한 정보를 명료하게 연결한다. |
| 맞는 응답·필요한 대응·앞선 연결 | C1/C2 각각 충족 후보 | U-02-4는 U-02-3의 구체 제안에 답하고 U-02-2의 요구를 유지한다. 불필요한 재확인을 요구하지 않는다. |
| 목표 | 여섯 항목 충족 후보 | U-02-2에 두 불일치·요청, U-02-3~5에 제안·수락·직원 확정이 있다. |

12개 기준을 각각 검토하는 근거를 영역별로 묶었다. 두 수준 모두 이 상황의 충족 후보이지 C1/C2 전체 능력 인증이나 모든 짧은 대화의 자동 만점 규칙이 아니다. 독립 검토/실제 모델 판정은 남는다.

</details>

<a id="r-01"></a>

### 교정받은 표현을 나중에 스스로 적용한 경우

**상황:** 처음 “Could you making…”을 교정받아 따라 말한 뒤, 스스로 “Could you tell me how long it will take?”라고 묻습니다.

**평가 요점:** 단순한 따라 말하기와 새로운 요청에 직접 적용한 근거를 구분합니다. 이후 적용은 긍정 근거이며, 도움을 받았다는 사실 자체로 감점하지 않습니다.

<details>
<summary>전체 대화와 항목별 판정 근거</summary>

검토 식별자: `R-01`.
A2·연습. 도움·따라 말하기·이후 독립 적용을 구분한다.

| ID | 역할 | 고정 대사 |
| --- | --- | --- |
| R-01-1 | 직원 | Hi. How can I help? |
| R-01-2 | 사용자 | I ordered a hot decaf latte, but this is iced and marked regular. Could you making it hot and decaf? |
| R-01-3 | 튜터 | Use “Could you make it hot and decaf?” Try that request again. |
| R-01-4 | 사용자 | Could you make it hot and decaf? |
| R-01-5 | 직원 | Of course. I can remake it at no extra charge. |
| R-01-6 | 사용자 | Could you tell me how long it will take? |
| R-01-7 | 직원 | About five minutes. Is that okay? |
| R-01-8 | 사용자 | Yes, please. I can wait five minutes. |
| R-01-9 | 직원 | I’ll remake your hot decaf latte now. |

| 기준/결과 | 판정 후보 | 근거·반대 근거와 경계 |
| --- | --- | --- |
| 문장 구조 | 충족 후보 | R-01-2의 오류 뒤 R-01-4는 직접 모방, R-01-6은 새 목적의 올바른 요청이다. 단발 오류만으로 자동 부분 충족시키지 않는다. |
| 안정성 | 충족 후보 | R-01-2·4·6·8을 함께 본다. R-01-6의 독립 적용과 8의 일관된 수락이 긍정 근거이며 첫 오류도 보존한다. |
| 필요한 설명·확인·수정 | 충족 | R-01-2의 설명, 4의 수정, 6의 필요한 시간 확인, 8의 수락이 확인된다. |
| 목표 | 여섯 항목 충족 후보 | R-01-2의 설명/요청과 5~9의 조건·시간 확인·수락·확정이 연결된다. |

독립 적용은 이 고정 입력에서 R-01-6에 직접 답을 제공한 튜터 발화가 없다는 뜻이다. 일반적인 전이나 장기 습득을 증명하지 않는다. 튜터 대사는 사용자 언어 근거에 포함하지 않고 도움 자체를 감점하지 않는다.

</details>

<a id="r-02"></a>

### 오류를 반복하다 마지막에 한 번 따라 한 경우

**상황:** 교정을 받아도 같은 오류를 반복하다 마지막에만 “Could you make…”를 정확히 따라 말합니다.

**평가 요점:** 마지막 성공만으로 앞선 반복 오류를 지우지 않습니다. 이후 스스로 적용한 사례보다 근거가 약하며, 도움 횟수 자체를 감점하는 것은 아닙니다.

<details>
<summary>전체 대화와 항목별 판정 근거</summary>

검토 식별자: `R-02`.
A2·연습. 반복 오류 후 마지막 한 번의 따라 말하기만 성공한다.

| ID | 역할 | 고정 대사 |
| --- | --- | --- |
| R-02-1 | 직원 | Hi. How can I help? |
| R-02-2 | 사용자 | I ordered a hot decaf latte, but this is iced and marked regular. Could you making it hot and decaf? |
| R-02-3 | 튜터 | Use “Could you make it hot and decaf?” Try that request again. |
| R-02-4 | 사용자 | Could you making it hot and decaf? |
| R-02-5 | 튜터 | After “Could you”, use “make”. Say “Could you make it hot and decaf?” |
| R-02-6 | 사용자 | Could you making it hot and decaf? |
| R-02-7 | 튜터 | Try once more: “Could you make it hot and decaf?” |
| R-02-8 | 사용자 | Could you make it hot and decaf? |
| R-02-9 | 직원 | I can remake it at no extra charge in about five minutes. Is that okay? |
| R-02-10 | 사용자 | Yes, please. I can wait five minutes. |
| R-02-11 | 직원 | I’ll remake your hot decaf latte now. |

| 기준/결과 | 판정 후보 | 근거·반대 근거와 경계 |
| --- | --- | --- |
| 문장 구조 | 부분 충족 | R-02-2·4·6의 동일 형태 오류가 반복되고 8은 직접 모방이다. 10의 정상 진술도 함께 보되 요청 구조의 불안정성을 지우지 않는다. |
| 안정성 | 독립 감점 근거 미확정 | 마지막 성공만으로 안정적 사용을 확정하지 않으나 같은 반복 오류만으로 구조와 함께 자동 감점하지도 않는다. R-01과 비교한 독립 적용 근거 부족을 기록한다. |
| 의미 관계·상대에 맞는 응답 | 충족 후보 | 요청 뜻은 계속 분명하며 R-02-10은 대기 조건에 적절히 응답한다. 형태 오류를 목표 실패로 전환하지 않는다. |
| 목표 | 여섯 항목 충족 후보 | R-02-2의 두 불일치·요청과 9~11의 제안·수락·확정이 연결된다. |
| 무진전 | 연습 자동 실패 적용 안 함 | 튜터 교정 후 반복은 연습 과정이다. 실전의 무진전 3회 후보를 가져오지 않는다. |

R-01보다 도움 횟수가 많아서 감점하는 사례가 아니다. 관찰된 반복 구조 오류와 독립 적용 유무를 대조한다. 언어 영역 전체 점수는 아직 확정하지 않는다.

</details>

## 판정 경계의 문서 검토 결과 — 미승인 추천

2026-11-09 후속: 아래 추천 1·2의 관찰 범위·안정성은 사용자 동의로 DEC-083에 채택했다. 현행 정책은 [PRD 4.5.2절](../PRD.md#452-언어-세부-기준과-부분점수)을 따른다. 아래 미승인 표현은 검토 당시 상태이며 사례별 등급·점수 후보와 실제 AI 품질은 확정하지 않았다. C1/C2의 종합 능력 미관찰을 이번 미션의 자동 제외 근거로 사용하지 않는다.


2026-11-05 작성한 사례를 PRD와 수동 대조했다. 아래는 문서 검토 결과와 후속 추천이지 모델의 판정 결과가 아니다. 기존 정책의 적용과 새로 구체화할 부분을 구분한다.

### 다섯 가지 추천과 대안

| 항목 | 추천하는 경계 | 기존 합의와의 관계·대안의 영향 |
| --- | --- | --- |
| 1. 관찰 범위 | 각 기준을 **이번 상황에서 실제 필요했던 수행**으로 한정해 판단한다. 쉬운 카페 대화에서도 해당 수행의 충분한 근거가 있으면 C1/C2 선택자의 충족을 인정할 수 있다. | 쉬운 표현 무감점·불필요한 행동 미요구는 기존 합의다. 높은 수준의 폭넓은 능력이 미관찰이라는 이유만으로 이번 수행을 판정 불가로 제외하지 않는 경계를 구체화하는 제안이다. 고급 구문을 필수화하면 불필요한 장문·과제가 생기고, 고수준 항목을 일괄 제외하면 점수 비중이 왜곡된다. |
| 2. 안정성의 근거 | 문법 안정성은 전체 대화에서 실제 사용한 구조가 필요한 의미 관계를 일관되게 유지했는지 본다. 최소 문장 수·여러 고급 구문 사용을 통과 조건으로 두지 않는다. | 전체 대화·수준별 기대·길이 무감점은 유지한다. 짧다는 이유만으로 안정성 항목을 자동 제외하지 않는 구체화다. 반대로 오류 한 번이 없다는 사실만으로 판정하지 않고 요청·설명·응답의 관련 근거와 반대 근거를 검토한다. 한 번의 수락만 남은 경우에는 안정성을 판단하기 어려울 수 있다. |
| 3. 실제 어려움과 근거 부족 | 필요한 응답 기회와 확인 가능한 발화가 있는데 의미·구조 문제가 반복되면 부분 충족/미충족을 검토한다. 기록 누락·불명확 전사·실제 기회 부족은 판정 불가를 검토한다. | PRD의 미충족 제외 금지 적용이다. 잘못 답한 것을 관찰 부족으로 처리하면 만점에서 빠져 오히려 달성률이 오를 수 있다. 반대로 기록 누락을 0점으로 처리하면 기술 문제를 사용자 능력으로 오판한다. |
| 4. 짧은 표현·생략 | 단어·정형 표현도 맥락에서 충분하고 자연스러우면 인정한다. 필요한 문장 관계가 빠져 불안정할 때에만 선택 수준에서의 구조 문제로 판단한다. | A1 설명·짧은 답 무감점의 적용이다. 모든 생략을 정답 또는 오류로 일괄 처리하지 않는다. P-01의 “This iced”는 단순히 짧은 “Decaf.”와 다르므로 A2 구조의 부분 충족 후보를 유지한다. |
| 5. 결과 설명 | 충족/부분 충족/미충족에는 사용자 근거와 영향을, 판정 불가에는 부족한 근거와 이유를 연결한다. 점수 설명은 이번 미션 수행에 한정하고 수준 인증으로 표현하지 않는다. | 실제 근거·미션 결과와 종합 수준 분리는 기존 합의다. 상세 API 필드는 후속이다. 숫자만 보여주는 대안보다 설명·검증 부담은 늘지만 누락과 실제 실패를 구분하기 쉽다. |

추천 1·2는 수준별 관찰 범위를 구체화하는 **미승인** 부분이다. 이는 C1/C2 기준을 A1로 낮추거나 어려운 미션에서도 같은 수행만 요구한다는 제안이 아니다. 선택 수준에서 정확성·정밀성·말투의 적절성을 비교하되 실제 필요하지 않은 고급 행동을 새로 요구하지 않는다는 뜻이다. 미션 난이도가 낮으면 서로 다른 수준의 선택자가 같은 점수를 받을 수 있다. 점수만으로 두 사람의 종합 능력이 같다고 해석하지 않는다.

추천의 비용/일정 영향은 문서·프롬프트·사례 검증 범위이며 별도 매 턴 호출·추가 공급자·새 데이터 보관을 요구하지 않는다. 운영 영향은 판정 불가 남용과 쉬운 미션의 점수 과대 해석을 함께 점검해야 한다는 것이다. 실제 비용·오판율은 측정하지 않았다.

### A2 기본 대화의 12개 기준 판정 초안

전체 입력은 위 A2-1~5다. 이번 미션의 필요한 설명·요청·수락이 충분하다는 추천 해석을 적용했다. 직원의 처리 확정은 목표 합의의 맥락이며 사용자 언어 점수를 대신하지 않는다. 아래 사례별 충족 후보는 실제 평가 전의 수동 초안이며 DEC-083 승인이 개별 등급 승인까지 뜻하지 않는다.

| 기준 | 판정 후보 | 사용자 근거·판단 이유 |
| --- | --- | --- |
| 의미 관계 | 충족 | A2-2에서 원래 주문과 현재 음료·대조가 분명함 |
| 문장 구조 | 충족 | A2-2의 진술·요청과 A2-4의 응답 구조가 필요한 의미를 전달함 |
| 선택 수준 안정성 | 충족 | A2-2·4의 설명·요청·대기 수락에 구조의 충돌이나 반복 불안정이 관찰되지 않음. 광범위한 능력 인증은 아님 |
| 의도에 맞는 단어 | 충족 | A2-2의 온도·카페인 구분과 A2-4의 대기 수락이 일치함 |
| 자연스러운 단어 조합 | 충족 | A2-2의 주문·재제조 표현과 A2-4의 wait five minutes가 적절함 |
| 상황에 적절한 표현 | 충족 | A2-2의 정중한 요청과 A2-4의 수락이 상황에 맞음 |
| 정보 제시 순서 | 충족 | A2-2에서 주문→불일치→처리 요청 순서가 명확함 |
| 필요한 연결 | 충족 | A2-2의 but/and가 대조·병렬을 충분히 나타냄 |
| 간결성과 관련성 | 충족 | A2-2·4가 문제 해결에 필요한 정보를 충분히 제공하고 불필요한 반복이 없음 |
| 상대 말에 맞는 응답 | 충족 | A2-4가 A2-3의 구체 제안과 대기 조건을 수락함 |
| 필요한 설명·확인·수정 | 충족 | A2-2에서 충분히 설명하고 A2-4에서 정확히 수락함. 오해가 없어 추가 수정 불필요 |
| 앞선 대화와 연결 | 충족 | A2-4가 A2-2의 재제조 요청과 A2-3의 대기 조건을 유지함 |

위 후보를 승인된 배점에 매핑하면 언어 40/40이며 목표 여섯 항목도 모두 확인되는 해석에서는 60/60, 합계 100/100이다. 이 계산은 **합성 기본 사례의 추천 판정에 따른 조건부 산술**이며 실제 AI 결과·수준별 평가표 확정이 아니다.

P-01에서 문장 구조만 부분 충족으로 판정하고 다른 독립 문제가 없다면 언어 38.5/40·목표 60/60, 합계 98.5/100이다. 같은 생략을 의미 관계·안정성까지 자동 중복 감점하지 않는 대조다. 실제로 다른 기준의 문제가 확인되면 그 별도 근거를 검토한다.

U-01에서 마지막 수락만 남았다면 위 100점 판정을 그대로 재사용할 수 없다. 남아 있는 질문·제안의 맥락까지 확인해 항목별 판정 불가를 정해야 하므로 일괄 점수는 제시하지 않는다. U-02에서 선택 수준만 C1/C2로 바꿔도 일괄 감점/제외하지 않고 위 12개 기준의 근거와 해당 수준 기대를 각각 검토한다. 최고 수준의 전 항목 만점을 자동 보장하지 않는다.

### 검토 중 발견한 사례의 한계

- 과거 A1-2의 “A hot latte, please. Decaf.”는 원래 주문 설명과 새 주문 요청 양쪽으로 읽힐 수 있다. 2026-11-09 기본 입력을 원래 주문이 명시된 문장으로 교체하고 기존 버전은 모호성 검토 자료로 보존했다. 직원이 맥락상 확인한 것과 사용자가 명시한 것을 분리해야 한다.
- 2026-11-09에 P/F/U/R 변형 8개의 완결 입력과 역할·발화 ID를 고정했다. 이전 개요의 P-02 환불 전환과 재제조 반복 요청의 충돌은 재제조 경로로 해소했다. 표에 없는 기준의 개별 등급과 전체 점수는 후속이다.
- C1/C2 전체 능력을 관찰하지 못한다는 한계는 유지한다. 이번 미션의 자동 제외 사유와 혼동하지 않도록 DEC-083을 반영하고 U-02에 실제 수행의 충족 후보 근거를 연결했다. 개별 등급의 실제 재현성은 미검증이다.
- 현재 문서에는 실제 전사 확신도·저장/재생 사건이 없다. 해당 사건을 확인했다는 가정 아래의 문서 대조이며 기술 경계 검증 결과로 사용하지 않는다.

## 같은 입력을 바꿔 대조할 항목

- A2-2를 한 문장 또는 여러 전사 조각으로 나눠도 의미·실제 전달 범위가 같으면 판단이 달라지지 않는지 확인한다.
- A2-4를 “Yes, please.”로 줄여도 앞선 구체 제안 수락 근거를 유지한다. 불필요하게 긴 수락에 가점을 주지 않는다.
- B1의 최종 환불을 재제조 수락으로 바꾸면 경로별 조건을 대조한다. 정상 경로 선택 때문에 목표 만점·언어 배점을 바꾸지 않는다.
- C1/C2 관찰 기회가 부족하다고 고의 오해·추가 장애·최소 턴을 넣지 않는다.
- 같은 단어 오류가 문법·어휘·상호작용에 등장할 때 각 기준에 독립된 문제·영향이 있는지 설명을 비교한다.

이 대조 목록은 실행 지시·새 호출 예산 승인이 아니다. 실제 시험 전 입력 묶음·호출/표본 수·기존 예산 적용 여부를 정하고, 결과에는 선택 수준·모드·판정·근거 ID·반대 근거·관찰 한계·판단 불일치를 남긴다. 실제 타입·저장 필드는 API/DB 계약에서 정한다.

## 남은 합의와 검증

1. 관찰 범위·안정성 정책은 DEC-083으로 승인됐다. 고정 대본의 사례별 등급 후보와 독립 감점 근거가 남은 항목을 검토한다. 짧은 대화의 판정 불가 비중과 점수 왜곡을 확인한다.
2. 12개 기준 각각의 충족/부분 충족/미충족/판정 불가 사례를 보강한다. 현재 변형 8개는 모든 기준·수준 조합을 덮지 않는다.
3. 최종 평가와 기존 노트를 같은 종료 호출로 생성할지, 평가 실패/부분 성공과 원문 삭제를 어떻게 연결할지 논의한다. 이 문서는 그 구성을 채택하지 않는다.
4. 실제 AI의 동일 입력 반복 판단·근거 정합성·목표/언어 분리·무진전 오판을 검증한다. 문서 대조만으로 B-03/B-12를 완료하지 않는다.
