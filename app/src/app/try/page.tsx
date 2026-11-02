"use client";
import Link from "next/link";
import { useState } from "react";
import { FakeProvider, type DemoScenario } from "../../learning/fake-provider";
import { LearningSession } from "../../learning/session";
import { Conversation } from "../../components/conversation";
import { AppFooter, Brand } from "../../components/app-header";

/** Login-free text trial with a scripted fake tutor; nothing leaves this tab's memory. */
export default function Try() {
  const [scenario, setScenario] = useState<DemoScenario>("correction");
  type LearningRuntime = { session: LearningSession; provider: FakeProvider };
  const [runtime, setRuntime] = useState<LearningRuntime>();
  function start() {
    const provider = new FakeProvider(scenario);
    const session = new LearningSession(provider);
    setRuntime({ session, provider });
    session.start();
  }
  return <main className="shell">
    <header className="site-header"><Brand /><Link className="secondary" href="/login">로그인</Link></header>
    <div className="demo-notice"><span aria-hidden="true">◌</span><p><strong>로그인 없이 체험하기</strong> · 정해진 순서로 답하는 가짜 튜터와 텍스트로 대화합니다. 기록은 이 화면의 메모리에만 남습니다.</p></div>
    {!runtime ? <section className="welcome">
      <div className="welcome-copy"><span className="eyebrow">TRY IT FIRST</span><h1>대화 → 표현 연습 →<br />학습 노트<span>.</span></h1><p>Talkie의 학습 흐름을 텍스트로 먼저 살펴보세요.<br />실제 음성 대화와 기록 저장은 로그인 후 이용할 수 있어요.</p>
        <div className="scenario-picker"><label htmlFor="scenario">학습 시나리오</label><select id="scenario" value={scenario} onChange={e => setScenario(e.target.value as DemoScenario)}><option value="correction">교정 · 첫 재시도 실패 · 두 번째 성공</option><option value="conversation">교정 없는 일반 대화</option></select><p className="hint">입력과 관계없이 정해진 순서를 재생합니다.<br />실제 영어의 정확도를 판정하지 않습니다.</p></div>
        <button className="primary start" onClick={start}>대화 시작 <span aria-hidden="true">↗</span></button><p className="hint">설치 후 인터넷·API 키 없이 대화할 수 있어요.</p>
      </div>
      <div className="welcome-card"><div className="card-top"><span>오늘의 주제</span><span aria-hidden="true">✳</span></div><span className="topic-number">01 / EVERYDAY LIFE</span><h2>A little story<br />about yesterday.</h2><p>어제 무엇을 했나요?</p><div className="sample-question">“What did you do yesterday?”</div><div className="flow-preview"><span>대화</span><span aria-hidden="true">→</span><span>표현 연습</span><span aria-hidden="true">→</span><span>학습 노트</span></div></div>
    </section> : <Conversation session={runtime.session} provider={runtime.provider} onReset={() => setRuntime(undefined)} />}
    <AppFooter />
  </main>;
}
