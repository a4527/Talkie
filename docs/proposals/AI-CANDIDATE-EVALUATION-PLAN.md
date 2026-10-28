# AI 후보 평가 계획 초안

2026-10-27 후속: **DEC-055로 Gemini Live 로컬 E2E를 먼저 구현하고 후보 비교는 후속으로 옮겼다. DEC-056으로 개인정보 없는 합성·본인 음성의 비공개 시험은 공급자 학습·표준 보관을 허용한다. 아래 비교 순서·학습 금지 선행 조건은 당시 계획이며 후속 결정이 우선한다.** 최종 공급자 선택과 유료 호출 배분은 미확정이다.

작성일: 2026-10-26. 상태: **후보 구성 변경은 2026-10-26 승인되어 DEC-050·053으로 기록했다. 예산 배분·표본 수·월 한도·통과 기준·역할 B 후보는 미승인 제안이며 호출·구현은 미착수다.** 관련 작업: D-03, V-05. 관련 결정: DEC-016/025/029/030/050/051/052/053. 측정·기록 방법은 [엔지니어링 검증 설계](../design/ENGINEERING-VALIDATION.md)를 따른다.

표기: **관찰**은 공식 문서·페이지에서 확인한 사실, **2차**는 블로그·집계 사이트·뉴스 등 공식이 아닌 자료, **추정**은 가정에 따른 계산, **미확인**은 확인하지 못한 것이다. 외부 자료는 2026-10-26에 조회했고 가격·모델명은 자주 바뀐다.

## 후보와 제외 사유

사용자는 **저가형 분리형, Gemini Live, OpenAI Realtime** 세 구성의 비교를 승인했고 비용이 낮은 순서로 시험한다(DEC-050·053). 저가형 분리형은 음성 인식·텍스트 모델·음성 합성을 저비용 서비스로 조합한 구성이며 구체 모델은 아래 '저가형 분리형 후보 구성'의 제안을 검토해 확정한다. AWS 분리형(Transcribe + Bedrock 텍스트 모델 + Polly)은 2026-10-26 사용자 결정으로 후보에서 제외했고 조사한 AWS 약관·가격은 참고로 남긴다.

- 제외 — Bedrock Nova 2 Sonic: 공식 언어 표에 한국어가 없다(en·fr·it·de·es·pt·hi). 지원하지 않는 언어 입력의 동작은 문서에서 찾지 못했다. 영어 전용 + 한국어 텍스트 번역 방식은 PRD 4.3의 "학습자가 한국어로 말하면 영어 표현 제시"와 충돌하고 비용 이점도 입증되지 않았다(음성 토큰 단가는 Gemini와 같은 $3/$12, 2차).
- 제외 — 사용자 ChatGPT 구독 연결: 플랜 사용은 오픈소스·로컬 실행 앱 대상이고 호스팅 앱은 선택된 파트너 대상 제한 시범이며 **오디오 입력은 미지원**이다(공식). PRD 10절의 "고객 API 키·ChatGPT 구독 연결 제외"를 유지한다.

## 하드 필터 현황 (역할 A: 실시간 음성)

| 조건 | OpenAI Realtime (gpt-realtime-2.1) | Gemini Live | AWS 분리형(제외, 참고) |
| --- | --- | --- | --- |
| 학습 미사용 (DEC-025) | 관찰: 기본 미사용. 서비스 계약 4.2는 고객 동의 없이 서비스 개발·개선에 고객 콘텐츠를 쓰지 않는다고 규정 | 관찰: 유료 티어만(무료는 학습·사람 검토 가능). Cloud Billing 계정을 활성화하면 무료 할당량 사용도 유료로 취급(약관) | 관찰(서비스 약관 50.3): Transcribe·Polly는 AWS가 AI 콘텐츠를 서비스 개선에 이용·저장하고 다른 AWS 리전에 저장할 수 있으며 **AWS Organizations의 AI 서비스 옵트아웃 정책으로 제외**할 수 있음. Bedrock·Nova는 50.3 대상 목록에 없음 |
| 보관 최대 30일 (DEC-025) | 관찰: 남용 모니터링 로그 최대 30일(법적 요구 시 연장 가능). Realtime ZDR은 승인 시 가능 | **Developer API는 미충족**: 악용 감시 로그 55일(공식 usage-policies, 사용자 제공 표와 일치). Vertex(사용자 제공 표, 직접 미확인): 일반 모델 최대 90일, Frontier 지정 모델 최대 30일, Cloud Master Agreement 고객은 감시용 로깅 기본 제외. 세션 재개를 켜면 최대 24시간 | 관찰: Bedrock 오용 탐지 대상 모델은 입출력을 최대 30일 저장(서비스 약관 50.12.2, 대상 모델은 별도 페이지). Transcribe·Polly 보관 일수는 약관에 없어 **미확인** |
| 이용 연령 조건 | 관찰(공식 under-18 가이드): 18세 미만 서비스를 금지하지 않음. 단 COPPA 등 아동·청소년 보호법 준수, 필요 시 연령 확인, 연령별 콘텐츠 필터·모니터링을 요구하고 13세 미만 또는 해당 국가의 디지털 동의 연령 미만의 개인정보는 ZDR 없이 처리하지 않도록 안내. 서비스 계약 3.3(c)은 부모·법정대리인 동의 없이 미성년자가 서비스를 사용하도록 허용하는 행위를 금지(사용자가 붙여 넣은 본문, 효력 2026-01-01). 18세 이상 전용(DEC-051)이면 미성년 접근을 막을 책임이 남음 | 관찰(약관, 2026-03-23 시행): API 사용자는 만 18세 이상이며 **만 18세 미만 대상이거나 미만이 접근할 가능성이 있는 서비스의 일부로 사용할 수 없음** | 관찰(서비스 약관 50.4, 고객 계약): Polly·Transcribe·Bedrock에는 연령 제한 조항이 없음. 고객이 최종 사용자에게 개인정보 고지를 제공하고 AI 콘텐츠 처리·저장·이전 동의를 받을 책임이 있음. COPPA 조항은 Lex에만 있음. 고객 계약은 계약 체결자가 미성년자가 아니어야 함 |
| 처리 지역·정보 수집 | 관찰: 데이터 거주 옵션은 미국·유럽(EEA+스위스)이며 한국은 거주 옵션에 없음. 지원 국가 목록에는 South Korea가 있음(페이지가 "our services"로 표기해 API 한정 여부는 불명확) | 관찰(약관): 유료 서비스도 프롬프트·응답이 Google 또는 대리인이 시설을 둔 국가에 일시 저장·캐시될 수 있음. 프롬프트·응답은 데이터 처리 부록(Google이 처리자)에 따르지만 토큰 수·식별자·IP 등 사용 세부정보는 Google이 별도 컨트롤러로 수집 | 관찰(고객 계약 1.4): 콘텐츠를 저장할 AWS 리전을 지정할 수 있고 선택한 리전 밖으로 옮기지 않음(법적 명령 예외). 단 옵트아웃을 적용하지 않으면 50.3에 따라 다른 리전에 저장될 수 있음. 2차(문서 미러): Transcribe 스트리밍·Bedrock runtime 서울 리전 지원, Polly 서울 지원은 **미확인** |
| 한국어 | **미확인**: 모델 페이지·가이드에 언어 목록 없음. 한국어 음성은 ChatGPT용 GPT-Live-1.1이 먼저, API는 추후라는 2차 보도 | 관찰: 한국어(`ko`) 지원, 언어는 모델이 자동 선택 | 관찰: Transcribe 스트리밍 한국어 지원. Polly 한국어 음성 Seoyeon(생성형·뉴럴·표준), Jihye(뉴럴), Hyunduk(생성형). 대화는 영어가 기본이라 영어 음성이면 충분할 가능성 |
| 브라우저 직접 연결 (DEC-030) | 관찰: 단기 키 발급(기본 600초, 최대 7,200초) + WebRTC | 관찰: 단기 토큰(시작 1분·연결 30분, `v1beta` 한정) | **미확인** |
| 끼어들기 | 관찰: VAD 감지 시 응답 취소 | 관찰: VAD 감지 시 생성 취소 + `interrupted` 신호 | 직접 구현 |
| 실제 재생 위치 | 관찰: WebRTC·SIP는 서버가 재생량을 알고 미재생 오디오를 자동 절단. WebSocket은 클라이언트가 `audio_end_ms`로 절단. **절단된 전사문은 제공하지 않음**(정밀 정렬 불가) | 문서에 재생 위치 없음. 중단 시 클라이언트가 재생을 멈춤 | 앱이 재생을 직접 제어 |
| 컨텍스트 | 128k 토큰, 최대 출력 32k(공식 모델 페이지) | 미확인 | 텍스트 모델별 확인 |

기록: 전사문의 미재생 부분을 어떻게 근거에서 제외할지(PRD 6절)는 어느 후보든 앱이 보정해야 할 가능성이 크며 측정 항목에 포함한다.

**OpenAI 서비스 계약·이용정책 확인**(사용자가 붙여 넣은 본문. 서비스 계약 효력 2026-01-01, 이용정책 시행 2026-11-20으로 현재는 시행 전): 고객 콘텐츠는 서비스 제공·법 준수·정책 집행·남용 방지에 필요한 경우에만 쓰고 고객 동의 없이는 서비스 개선에 쓰지 않는다(4.2). 개인정보는 DPA를 따르고(5.3), 해지 후 30일 내 고객 콘텐츠를 삭제하며(11.3), 지원 국가·지역 밖에서는 접근·제공할 수 없다(16.12). 베타 표시 서비스는 지원·신뢰성을 보장하지 않는다(12.3). 이용정책은 18세 미만 보호 금지 항목, 교육 등 민감 분야에서 사람의 검토 없는 중대 영향 자동 조치 금지, 직장·교육 환경의 감정 추론 금지, OpenAI 모델·결과물로 대체 모델의 학습 자료·평가 기준을 만드는 행위 금지를 담는다. 노트·교정은 학습 보조이고 합격·평가 같은 결정이 아니며 음성 감정 추론·자체 모델 학습 기능이 없어 해당 가능성이 낮다고 추정하지만 법적 판단은 아니다.

**AWS 서비스 약관·고객 계약 확인**(사용자가 제공한 한국어 번역 PDF: 서비스 약관 2026-09-15 개정본, 고객 계약 2026-08-14. 번역본은 정보 제공용이며 영문본이 우선): Transcribe·Polly는 서비스 약관 50.3에 따라 **옵트아웃 정책을 적용하지 않으면** AWS가 AI 콘텐츠를 서비스 개선에 쓰고 다른 리전에 저장할 수 있다. DEC-025의 학습 금지를 충족하려면 AWS Organizations의 AI 서비스 옵트아웃 정책을 적용한 계정이 필요하다. 50.4는 고객이 최종 사용자에게 개인정보 고지를 하고 AI 콘텐츠의 처리·저장·이전 동의를 받을 책임, 법에 따라 삭제가 필요할 때 AWS에 고지할 책임을 둔다(탈퇴 삭제와 연결). 50.5는 AI 서비스로 AI 모델 학습용 콘텐츠를 생성하는 행위를 금지한다. Bedrock은 오용 탐지 대상 모델에 한해 입출력을 최대 30일 저장하며 대상 모델은 별도 페이지에서 확인해야 한다(50.12.2). Transcribe·Polly의 보관 일수는 약관에 없다. 고객 계약 1.4는 콘텐츠 저장 리전을 고객이 지정할 수 있고 그 밖으로 옮기지 않는다고 한다.

**DEC-025와 Gemini**: DEC-025는 조건 미충족 후보에 음성을 전달하지 않도록 정했다. Gemini Developer API는 55일로 현재 미충족이지만 DEC-052에 따라 합성·본인 음성 스모크에는 포함한다(학습 금지 확인 전제). 제품 적용을 위한 선택지는 (a) Gemini를 이번 비교에서 보류, (b) Vertex 경로를 확인(Live 모델이 30일 상한 대상인지, 감시 로깅 제외 계약이 가능한지)하고 재편입, (c) DEC-025의 30일 상한 변경이다. (c)는 사용자 고지와 PRD 8절의 기한 설명에 영향이 있어 별도 논의가 필요하며 이 문서는 변경을 제안하지 않는다. 참고: Gemini 데이터 로깅 문서(2026-10-14 갱신)의 7·14·28·55일 설정은 개발자 소유 프로젝트 로그에 대한 것이며 악용 감시 로그와 별개다. 악용 감시 로그는 55일이고 설정 변경 가능 여부는 정책 페이지에 없다. 데이터 세트 공유와 참여자 등급은 학습 사용이라 사용하지 않는다.

## 경제성 제약

구독료 가정(사용자): 기본 **월 1만 원**, 경쟁 앱 대비 품질이 충분하면 **최대 월 2만 원**이다. 요금제 결정이 아니다. 참고로 Speak 한국 앱스토어 목록에는 월 ₩29,000, 연 ₩129,000(월 환산 약 10,750원), Premium Plus 월 ₩69,000·연 ₩299,000이 보인다(항목이 중복되고 등급 매핑은 불명확). 미국 가격은 월 $17.99, 연 $83.99(2차).

결제 수수료 가정: Talkie는 반응형 웹이라 PG 결제를 가정한다. 토스페이먼츠 카드 3.4%와 연 관리비 11만 원(포트원 블로그, 2차. 가입 경로에 따라 면제 가능), 수수료의 부가세 10% 별도(공식). 정기결제 전용 수수료와 과세 구분은 미확인이다. 앱스토어 결제라면 15%(Apple 소규모 사업자 프로그램, 2차) 수준이다.

분당 AI 비용(환율 1,400원/$ 가정, 10분 세션 20턴 가정):

| 구성 | 분당 | 근거 | 수준 |
| --- | --- | --- | --- |
| OpenAI Realtime | 약 $0.066 (약 92원), **캐시가 맞지 않으면 약 $0.29 (약 400원)** | 공식: 오디오 입력 $32·출력 $64·캐시 $0.40(1M). 공식 환산: 사용자 오디오 1토큰/100ms, AI 오디오 1토큰/50ms, 매 응답마다 대화 전체를 입력으로 재전송, 캐시는 best-effort. 가정: 턴당 사용자 9초·AI 15초, 지시문 500토큰, 전사 텍스트 재과금 제외 | 추정. 업체 측정치 약 $0.057(2차)과 같은 규모. 캐시 적중률이 핵심 변수 |
| Gemini Live | 최대 약 $0.023 (약 32원) | 공식 가격표(입력 $0.005/분, 출력 $0.018/분)를 입출력 모두 연속 과금으로 가정. AI 발화 5분이면 약 $0.014 | 추정(상한). 무음 과금·맥락 재과금 미포함. 보관 조건 미충족 |
| AWS 분리형(제외, 참고) | 약 $0.018~$0.034 (약 25~48원) | Transcribe $0.01(공식 US East 예시)~0.024(2차)/분, Polly 뉴럴 $16/1M자(공식, 생성형은 $30), 텍스트 모델 약 $0.01/세션. 분당 900자·AI 발화 5분 가정. 생성형 음성이면 최대 약 $0.04 | 추정. 서울 리전 가격·보관 미확인 |

AI 비용만으로 순수익이 0이 되는 월 사용량 상한(부가세 포함가의 10% 제외, PG 수수료 3.4%+부가세, 연 관리비·인프라 고정비·무료 체험·마진 제외):

| 월 구독료 | 순수익(가정) | OpenAI | Gemini | AWS 분리형(제외, 참고) |
| --- | --- | --- | --- | --- |
| 1만 원 | 약 8,700원 | 약 95분 (캐시 미적중 시 약 22분) | 약 270분 이상 | 약 180~340분 |
| 2만 원 | 약 17,400원 | 약 190분 (캐시 미적중 시 약 44분) | 약 540분 이상 | 약 370~690분 |

앱스토어 수수료 15%를 적용하면 순수익은 약 7,600원·15,200원으로 줄어 위 상한이 약 13% 낮아진다.

시사점: 월 1만 원 요금제는 사용 시간 한도 없이는 손익을 보장할 수 없다. 매일 10분(월 300분)은 OpenAI 구성에서 성립하지 않는다. OpenAI는 캐시 적중 여부에 따라 비용이 4배 넘게 달라질 수 있어 측정 대상이다. 실제 한도는 위 상한보다 낮게 정해야 한다(고정비, 무료 체험, 헤비 사용자). 한도 설계는 측정 후 별도 제안한다.

## 저가형 분리형 후보 구성 (2026-10-26 조사, 제안·미승인)

구성은 음성 인식(STT) → 텍스트 모델(LLM) → 음성 합성(TTS)이다. 아래 가격은 조회 시점 값이고 **한국어 품질·정확도는 어느 항목도 확인하지 못했다**(스모크 대상). 한국어 설명을 음성이 아니라 화면 텍스트로 주면 한국어 음성 합성은 필수가 아니다(제품 결정).

**음성 인식 (한국어 스트리밍)**

| 후보 | 가격 | 한국어 | 데이터 조건 | 수준 |
| --- | --- | --- | --- | --- |
| Soniox 실시간 | $0.12/시간(약 $0.002/분), 언어 무관 | 관찰(벤더 FAQ): 한국어 실시간 스트리밍, 말이 끝났는지 판정 | 학습 미사용. 보안 문서상 기본은 무보관이고 Async API 저장분만 30일 후 삭제. 한국어 페이지의 "지역 내 저장" 서술과 어긋나 DPA로 **확인 필요** | 벤더 페이지. 한국어 정확도 수치 없음 |
| Deepgram Nova-3 | 스트리밍 약 $0.0077/분(2차) | 관찰(공식 언어표): Nova-3에 `ko` 포함. 스트리밍 지원 구분은 문서에 없음 | 기본은 학습 비참여, `mip_opt_out=true`로 요청 단위 제외(2차). 보관 일수 **미확인** | 가격 2차 |
| ElevenLabs Scribe v2 Realtime | $0.39/시간(공식) | 90개 이상 언어, 한국어 포함 여부 미확인 | 미확인(제로 리텐션은 Medical만 명시) | |
| Gemini 3.5 Transcribe Live | 입력 $0.005/분 + 출력 $0.004/분(공식) | 미확인 | 학습 미사용(유료), 로그 55일 | 공식 가격 |
| OpenAI 전사 | gpt-realtime-whisper $0.017/분, gpt-4o-transcribe $0.006/분, gpt-4o-mini-transcribe $0.003/분(공식 가격 페이지. 스트리밍을 지원하는 모델 구분은 미확인) | 한국어 지원 미확인 | 학습 미사용·보관 30일 | 공식 가격 |
| AssemblyAI Universal-Streaming | $0.15/시간(공식, 연결 시간 기준) | 한국어 스트리밍 목록 미확인 | 미확인 | 후순위 |

**텍스트 모델**: 비용은 10분 세션당 약 $0.02(가정: 입력 4만·출력 2천 토큰)로 총비용에서 비중이 작다. 가격보다 한국어 품질과 데이터 조건으로 고른다.

| 후보 | 가격(1M 토큰) | 데이터 조건·비고 |
| --- | --- | --- |
| Gemini 3.5 Flash-Lite | 입력 $0.30·출력 $2.50(공식) | 학습 미사용(유료), 로그 55일 |
| Gemini 3.1 Flash-Lite | 입력 $0.25·출력 $1.50(공식) | 같음 |
| OpenAI gpt-6-luna | 입력 $0.10·출력 $0.50(공식 가격 페이지). gpt-5.6-luna는 $0.20/$1.20 | 학습 미사용·보관 30일로 조건이 명확. 한국어 품질 미확인 |
| Claude Haiku 5.5 | 입력 $0.10·출력 $0.50(100K 토큰 이하 프롬프트, 초과 시 $0.50/$2.50. Anthropic API 가격표, 2026-10-06 캐시) | 학습 미사용(기본). 보관은 고객센터 "30일 이내 삭제"와 개발자 문서 "기본 미보관(Covered Model만 30일)"이 달라 **확인 필요**. 한국어는 공식 다국어 표에 Haiku 4.5가 영어 대비 93.3%(번역 MMLU 기준)이고 Haiku 5.5는 표에 없어 **미확인** |
| 오픈웨이트(Qwen, DeepSeek V4 Flash 등) | DeepSeek V4 Flash 입력 $0.14·출력 $0.28(2차) | 호스팅 제공자별 데이터 조건과 서버 위치를 확인해야 해 후순위. Duolingo의 비용 절감 사례(2차)가 이 방향 |

**음성 합성**

| 후보 | 가격 | 한국어 | 데이터 조건 |
| --- | --- | --- | --- |
| Gemini 3.8 Flash-Lite TTS | 출력 오디오 $6/1M 토큰(2026-12-31까지), 2027-01-01부터 $12(공식) | 관찰(공식 문서): 한국어 지원, `stream: true` 스트리밍 지원, 기본 음성 30개 | 학습 미사용(유료), 로그 55일 |
| Cartesia Sonic 3.6 | 공식 가격 미확인(2차 $20~47/1M자) | 관찰(공식 문서): 한국어 포함 44개 언어 | ZDR은 Enterprise만 제공. 기본 학습·보관 조건은 **미확인** |
| ElevenLabs Flash/Turbo | $0.04/1K자 = $40/1M자(공식) | 32개 언어, 한국어 포함 여부 미확인 | 미확인 |
| OpenAI gpt-4o-mini-tts | 입력 텍스트 $0.60/1M 토큰, 출력 오디오 $12/1M 토큰(공식 가격 페이지). tts-1은 $15/1M자 | 한국어·스트리밍 미확인 | 학습 미사용·보관 30일 |
| Google Cloud TTS(Chirp 3 HD) | 공식 페이지 열람 실패(2차 $30/1M자) | 미확인 | 미확인 |
| Deepgram Aura-2 | 2차 $30/1M자 | 한국어 미확인 | 미확인 |

**조합별 10분 세션 비용 (추정, 환율 1,400원/$)**: 가정은 마이크 10분 연속 과금, AI 발화 5분(4,500자, Gemini TTS는 25토큰/초 가정으로 7,500토큰), 텍스트 모델 입력 4만·출력 2천 토큰이다.

| 조합 | 세션 비용 | 분당 | 월 1만 원 순수익(약 8,700원)으로 쓸 수 있는 시간 |
| --- | --- | --- | --- |
| A. Soniox + Gemini 3.5 Flash-Lite + Gemini 3.8 Flash-Lite TTS | 약 $0.082 | 약 11.5원(TTS 단가 인상 후 약 17.8원) | 약 760분 |
| B. Soniox + Gemini 3.5 Flash-Lite + Cartesia Sonic 3.6 | 약 $0.13~$0.25 | 약 18~35원 | 약 250~490분 |
| C. Soniox + Gemini 3.5 Flash-Lite + ElevenLabs Flash | 약 $0.22 | 약 30원 | 약 290분 |
| D. Gemini 3.5 Transcribe Live + Gemini 3.5 Flash-Lite + Gemini 3.8 Flash-Lite TTS(공급자 일원화) | 약 $0.152 | 약 21원 | 약 410분 |

모든 조합이 목표 월 150분(분당 약 58원 이하)을 충족하며 OpenAI Realtime(분당 약 92원, 캐시 미적중 시 약 400원)보다 3~8배 이상 저렴하다.

**주의**
- 분리형은 실시간 모델보다 지연이 300~800ms 길 수 있다(2차). 끼어들기(재생 중단)·전사 정렬·재생 위치를 앱이 직접 구현해야 한다.
- 여러 서비스를 이어 주는 서버(Pipecat, LiveKit Agents 등 오픈소스 프레임워크)가 필요해 DEC-030의 "브라우저 직접 경로"와 다르다. 제품 적용 시 음성 중계 서버 도입이라는 구조 변경이므로 스모크 결과 후 결정한다.
- Gemini 구성 요소를 쓰는 조합은 Gemini API 로그 55일이 적용돼 DEC-025의 30일 상한을 넘으며 DEC-052의 시험 한정 유예 대상이다. 30일 상한을 지키는 조합은 아직 찾지 못했다(Soniox·Cartesia·ElevenLabs·Deepgram의 학습·보관 조건이 미확인).
- Gemini TTS의 2027-01-01 가격 인상, 구성 요소별 한국어 품질 편차, 여러 업체의 데이터 조건 확인 부담이 늘어난다.

**제안 순위**는 아래 '구성 요소별 교체 시험 설계'로 대체한다(DEC-054).

**무료 확인 목록**: Soniox DPA의 보관 조항, Deepgram·Cartesia·ElevenLabs의 학습·보관 조건, OpenAI 전사·TTS의 한국어·스트리밍 지원, Claude Haiku 5.5의 Covered Model 여부와 한국어 품질, Gemini Transcribe의 한국어 지원, Cartesia·Google Cloud TTS 공식 가격.

### 구성 요소별 교체 시험 설계 (DEC-054, 제안·미승인)

**후보 세트 (요소별 3개)**

| 요소 | 기본(baseline) | 교체 1 | 교체 2 | 예비 |
| --- | --- | --- | --- | --- |
| 음성 인식 | Soniox | Deepgram Nova-3 | OpenAI 전사(gpt-4o-transcribe 또는 gpt-realtime-whisper) | Gemini 3.5 Transcribe Live, ElevenLabs Scribe v2 Realtime |
| 텍스트 모델 | Claude Haiku 5.5 | Gemini 3.5 Flash-Lite | OpenAI gpt-6-luna | OpenAI gpt-5.6-luna, 오픈웨이트 |
| 음성 합성 | Gemini 3.8 Flash-Lite TTS | Cartesia Sonic 3.6 | OpenAI gpt-4o-mini-tts | ElevenLabs Flash |

기본 조합은 Soniox + Claude Haiku 5.5 + Gemini 3.8 Flash-Lite TTS다. 텍스트 모델은 세 후보 모두 10분 세션당 약 $0.01~0.02라 비용 차이가 작고, 한국어 설명의 자연스러움·교정 판단·대화 톤을 들어 보고 고른다. Claude Haiku 5.5를 기본으로 둔 이유는 가격이 가장 낮고 학습 미사용·보관 30일 이내(고객센터 기준)로 DEC-025에 가장 가깝기 때문이며 한국어 품질은 미확인이다.

**시험 구성 (9개)**: 기본 1개 + 요소별 교체 6개(음성 인식 2·텍스트 모델 2·음성 합성 2) + Gemini Live 1개 + OpenAI Realtime 1개. 한 번에 한 요소만 바꿔 원인을 분리한다. 구성마다 같은 시나리오로 3분 세션을 2회 진행한다. 시험 순서는 비용이 낮은 순(기본 → 음성 인식 교체 → 텍스트 모델 교체 → 음성 합성 교체 → Gemini Live → OpenAI Realtime)이다.

**비용 (추정, 환율 1,400원/$)**: 3분 세션당 분리형은 약 $0.01~0.12(구성별), Gemini Live는 최대 약 $0.07, OpenAI Realtime은 캐시 미적중 최악 약 $0.33이다. 약 18개 세션의 합계는 최악 약 3,400원으로 DEC-016의 3만 원에 크게 못 미친다. 제안: 1라운드 지출 상한을 5,000원으로 두고 나머지는 예비로 둔다. 모든 구성은 3분 세션 상한으로 최대 비용을 계산한 뒤 호출한다.

**평가 방식 (직접 청취)**: 성능 기준은 사전에 정하지 않는다. 사용자가 같은 시나리오로 직접 말하고 듣고 구성별로 아래를 점수나 한 줄로 메모한다: 내 말을 알아듣는가(한국어·한국인 억양 영어), AI의 말투와 교정이 자연스러운가, 음성 품질, 체감 지연, 끼어들기. 앱이 측정한 지연(발화 종료→첫 소리)과 비용을 함께 남기되 발화 내용은 기록하지 않는다(DEC-040). 모든 구성을 들은 뒤 사용자가 기준을 정하고 최종 결정한다.

**하니스**: Pipecat 공식 문서의 지원 서비스 표에 Soniox, Deepgram, OpenAI(전사·TTS·텍스트), Anthropic, Gemini 텍스트, Cartesia, Google 음성, Gemini Live, OpenAI Realtime이 모두 공식 유지 통합으로 올라 있다. 한 하니스에서 설정으로 구성 요소를 교체할 수 있을 것으로 보이며 Gemini TTS가 'Google' 통합에 포함되는지는 개별 확인이 필요하다. 제품 코드와 분리한 시험용 코드로 두고 제품 적용은 별도 결정한다.

**준비물**: 계정과 키는 Soniox, Deepgram, Anthropic, Cartesia(신규), Google AI Studio(결제 활성), OpenAI다. 신규 계정을 줄이려면 음성 인식을 Soniox·OpenAI, 음성 합성을 Gemini·OpenAI로 두고 Deepgram·Cartesia를 예비로 돌리는 축소안이 있다.

## 역할 구분

| 역할 | 비교 대상 | 비고 |
| --- | --- | --- |
| A. 실시간 음성 대화(대화 중 교정 포함) | 위 세 구성 | 세션 시간에 비례하는 비용. 이 문서의 평가 대상 |
| B. 종료 후 노트 생성(텍스트) | Bedrock 텍스트 모델(Claude·Nova 2 Lite 등), OpenAI·Gemini 텍스트 모델 | 별도 평가. 한국어 요약 품질과 근거 인용 정확성이 핵심. 후보 선정은 후속 제안 |

## 측정 항목

공통 시나리오(합성 대화·개발자 본인 음성, DEC-016)를 후보별로 같은 조건에서 실행한다. 시나리오 수·반복 수는 미정이다.

| 항목 | 방법 |
| --- | --- |
| 10분 세션 비용 | 세션당 실제 사용 토큰·초·문자 수와 청구 단가로 계산. 입출력·텍스트·음성 구분. OpenAI는 응답별 `input_tokens`·`output_tokens`·`cached_tokens`로 캐시 적중률 기록. Gemini는 무음 구간 과금 확인 |
| 한국어·한국인 억양 영어 인식 | 같은 발화 목록의 인식 결과 비교. 채점 기준은 호출 전 확정 |
| 교정 품질 | 고정 시나리오·루브릭. 오인식 시 확인·보류 동작 포함(PRD 4.3) |
| 지연 | 발화 종료→첫 응답 음성 재생. 브라우저 측 시점 기준. 공급자 내부 시간이 없으면 외부 호출 전체 대기로 기록 |
| 끼어들기 | 감지→재생 중단 지연, 취소 실패, 늦은 이벤트 |
| 기록 동기화 | 전사문과 실제 재생 범위의 일치. 미재생 전사문 보정 방법 포함 |
| 긴 세션 | 10분 이상에서 컨텍스트 한도·비용 증가 |

## 예산과 단계

총 지출 상한은 DEC-016의 3만 원(세금·환율·수수료 포함)이다. 아래는 제안이며 미합의 값은 비워 둔다.

1. **문서·문의 단계(무료)**: 아래 선행 확인 목록을 처리한다. 하드 필터를 통과하지 못한 후보에는 음성을 전달하지 않는다(DEC-025).
2. **스모크(소량)**: 후보당 짧은 시나리오로 한국어 품질·단가 확인. 후보별 배분·시나리오 수·호출 상한·중단 기준은 호출 전에 합의한다(체크리스트 L23·L24). 최대 비용을 계산할 수 없으면 호출하지 않는다. DEC-053에 따라 비용이 낮은 순서(저가형 분리형 → Gemini Live → OpenAI Realtime)로 시험하되 모든 후보를 시험한 뒤 최종 결정한다(DEC-054, 성능 기준은 직접 청취로 정함). DEC-052에 따라 시험 전 조건: 저가형 분리형의 각 구성 요소는 학습 미사용을 확인하고, Gemini는 Cloud Billing이 활성화된 유료 프로젝트에서 로깅 데이터 세트 공유·참여자 등급을 쓰지 않으며, OpenAI는 입출력 데이터 공유를 사용하지 않는다. 모두 합성 대화·개발자 본인 음성으로 한정하고 실제 사용자 음성은 DEC-025를 그대로 따른다.
3. **본 비교**: 스모크 통과 후보만. 통과 기준 수치는 호출 전에 정한다.

비용 차단은 집행액·진행 중 예약·다음 호출의 최대 비용을 합산해 한도를 넘으면 신규 호출을 막는 방식이다(PRD 9.2). 구현 여부와 방식은 미정이다.

## 선행 확인 목록

완료(공식 또는 사용자 제공):
- Gemini 보관 일수(Developer API 55일), OpenAI 모델(gpt-realtime-2.1 단일 스냅샷)·단기 키 수명·오디오 토큰 환산·재생 절단 동작, Polly 한국어 음성·가격, Transcribe 한국어 스트리밍 지원, 경쟁 앱 한국 가격, PG 카드 수수료.

남음:
1. Gemini: Vertex에서 Gemini Live 모델이 어느 보관 규칙을 따르는지, 감시 로깅 제외 계약 가능 여부, Vertex 가격.
2. OpenAI: 한국어 지원 공식 확인(없으면 스모크로 확인), 한국어 음성 품질, 이용정책 시행분(2026-11-20)의 Talkie 해당 여부 검토.
3. AWS(분리형은 제외, 역할 B 후보 검토용으로 남김): Transcribe·Polly의 서비스별 데이터 보관 일수(약관에 없어 Data Privacy FAQ 등 확인), Bedrock 오용 탐지 대상 모델 목록, 옵트아웃 정책 적용 계정 구성, Polly 서울 리전 지원, Transcribe 서울 리전 가격, Transcribe·Polly의 AI 서비스 옵트아웃 필요성(공식 확인), 브라우저 직접 연결 가능 여부, 한국인 억양 영어 인식, Bedrock 텍스트 모델의 한국어 품질(역할 B).
4. 정기결제 PG 수수료, 과세 구분, 한국 앱스토어 경쟁 앱 가격의 등급 매핑.
5. 가입 시 연령 확인 방식과 국외 처리 고지: 대상 연령은 만 18세 이상 전용으로 결정했다(DEC-051). Gemini 약관의 18세 미만 접근 가능 서비스 금지와 국외 일시 저장·캐시는 가입 절차와 개인정보 고지에 영향을 준다. 제품·법무 검토가 필요하며 이 문서는 법률 자문이 아니다. D-02의 "대상 연령·처리 지역 등 공급자 이용 조건" 항목과 연결한다.

## 열린 질문

- 후보 세트와 기본 조합은 2026-10-26 사용자가 확정했고 하니스 뼈대를 작성했다([하니스 README](../../harness/voice-eval/README.md), [키·결제 안내](../harness/voice-eval/PROVIDERS.md)). 남은 것은 공급자 키·결제 설정과 신규 계정 범위(전체 또는 축소안)다. 성능 기준은 사전에 정하지 않고 직접 듣고 정한다(DEC-054).
- 저가형 분리형에 필요한 오케스트레이션 서버(Pipecat, LiveKit Agents 등)를 스모크 하니스로 쓸지. 제품 적용 시에는 음성 중계 서버 도입이라는 구조 변경이 된다.
- 보관 상한 완화(미채택): OpenAI 비용이 과도하다고 판단하는 기준과 완화 한도. 제안: 월 1만 원 요금제에서 목표 월 사용 시간(예: 일 5분, 월 150분)을 순수익 안에서 감당하지 못하는 분당 비용(약 58원, 약 $0.041 초과)을 기준으로 하고, 완화 한도는 측정 후 55일 등을 논의. 단 AWS 분리형이 비용·품질·보관 조건을 통과하면 완화가 필요 없을 수 있다. 목표 월 사용 시간은 사용자 확인이 필요하다.
- Gemini의 DEC-025 대응: 스모크는 DEC-052로 허용. 제품 적용은 보류 / Vertex 경로 확인 / 상한 변경 중에서 측정 후 논의.
- 후보별 예산 배분과 시나리오·반복 수.
- 월 사용 시간 한도와 무료 체험량(DEC-014 후속).
- 사용자 수 가정과 월 5만 원 예산(AI 포함)의 인프라·AI 몫.
- 역할 B 후보 구성.

## 출처

- [OpenAI gpt-realtime-2.1](https://developers.openai.com/api/docs/models/gpt-realtime-2.1), [gpt-realtime-1.5](https://developers.openai.com/api/docs/models/gpt-realtime-1.5), [비용·캐시](https://developers.openai.com/api/docs/guides/realtime-costs), [대화·중단](https://developers.openai.com/api/docs/guides/realtime-conversations), [WebRTC](https://developers.openai.com/api/docs/guides/realtime-webrtc), [단기 키](https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create), [데이터 통제](https://developers.openai.com/api/docs/guides/your-data)
- [Sign in with ChatGPT 플랜 사용](https://developers.openai.com/siwc/token-sharing-open-source), [제한](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [Gemini API 가격](https://ai.google.dev/gemini-api/docs/pricing), [Live API 가이드](https://ai.google.dev/gemini-api/docs/live-guide), [단기 토큰](https://ai.google.dev/gemini-api/docs/ephemeral-tokens), [ZDR](https://ai.google.dev/gemini-api/docs/zdr), [악용 감시](https://ai.google.dev/gemini-api/docs/usage-policies), [Vertex 데이터 거버넌스](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/data-governance)
- [Nova 2 Sonic 언어](https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-language-support.html), [Bedrock 데이터 보호](https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html), [Transcribe 지원 언어](https://docs.aws.amazon.com/transcribe/latest/dg/supported-languages.html), [Transcribe 가격](https://aws.amazon.com/transcribe/pricing/), [Polly 가격](https://aws.amazon.com/polly/pricing/), [Polly 음성 목록](https://docs.aws.amazon.com/polly/latest/dg/available-voices.html)
- 저가형 분리형 조사: [Soniox 한국어 실시간](https://soniox.com/speech-to-text/korean), [Deepgram 모델·언어](https://developers.deepgram.com/docs/models-languages-overview), [ElevenLabs API 가격](https://elevenlabs.io/pricing/api), [Cartesia 최신 TTS 모델](https://docs.cartesia.ai/build-with-cartesia/tts-models/latest), [AssemblyAI 가격](https://www.assemblyai.com/pricing), [Gemini API 가격(Flash-Lite·TTS·Transcribe)](https://ai.google.dev/gemini-api/docs/pricing)
- [토스페이먼츠 요금 안내](https://www.tosspayments.com/about/fee), [Speak 한국 앱스토어](https://apps.apple.com/kr/app/id1286609883)
- 2차: [AWS AI 서비스 옵트아웃 정책 안내](https://docs.amazonaws.cn/en_us/organizations/latest/userguide/orgs_manage_policies_ai-opt-out_all.md), [포트원 PG 비교](https://blog.portone.io/opi_pg-comparison2026/), [RevenueCat 수수료](https://revenuecat.com/docs/dashboard-and-metrics/taxes-and-commissions), [Nova 2 Sonic 가격](https://www.getmaxim.ai/bifrost/llm-cost-calculator/provider/bedrock/model/amazon.nova-2-sonic-v1-0), [Nova 2 Lite 가격](https://www.getmaxim.ai/bifrost/llm-cost-calculator/provider/bedrock/model/us.amazon.nova-2-lite-v1-0), [Fora Soft OpenAI Realtime 가격](https://www.forasoft.com/blog/article/openai-realtime-api-pricing), [Synthorai 음성 에이전트 비용](https://synthorai.io/blog/voice-agent-api-cost/), [Cartesia 실시간 대 분리형](https://www.cartesia.ai/learn/speech-to-speech-vs-cascaded), [Speak 가격](https://recurdash.com/subscription-pricing/speak), [Speak Live Roleplays](https://speak.com/blog/live-roleplays)

한계: 가격·모델명은 조회 시점 기준이며 출처 간 충돌이 있다. 분당 비용은 실측이 아닌 가정 계산이다. Vertex 보관 일수는 사용자가 제공한 표를 기준으로 했고 직접 확인하지 않았다. 앱 3곳(Speak·Duolingo·Praktika)의 내부 구조와 사용량 제한은 공개 자료로 확인하지 못했다.
