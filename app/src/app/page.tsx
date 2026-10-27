"use client";
import { useState } from "react";
import { FakeProvider, type DemoScenario } from "../learning/fake-provider";
import { LearningSession } from "../learning/session";
import { Conversation } from "../components/conversation";
export default function Home() {
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
    <header className="site-header"><a className="brand" href="/" aria-label="Talkie 처음으로"><span className="brand-icon" aria-hidden="true">t</span>talkie<span className="brand-dot">.</span></a><span className="demo-badge">LOCAL DEMO <span aria-hidden="true">↗</span></span></header>
    <div className="demo-notice"><span aria-hidden="true">◌</span><p><strong>가짜 AI로 확인하는 첫 학습 흐름</strong> · 텍스트와 현재 화면의 메모리만 사용합니다. 실제 AI·음성·로그인·영구 저장은 연결하지 않았습니다.</p></div>
    {!runtime ? <section className="welcome">
      <div className="welcome-copy"><span className="eyebrow">A LITTLE ENGLISH, EVERY DAY</span><h1>어제의 이야기로,<br />오늘의 영어 한 걸음<span>.</span></h1><p>짧게 대화하고, 표현 하나를 연습하고,<br />나만의 학습 노트로 남겨 보세요.</p>
        <div className="scenario-picker"><label htmlFor="scenario">학습 시나리오</label><select id="scenario" value={scenario} onChange={e => setScenario(e.target.value as DemoScenario)}><option value="correction">교정 · 첫 재시도 실패 · 두 번째 성공</option><option value="conversation">교정 없는 일반 대화</option></select><p className="hint">입력과 관계없이 정해진 순서를 재생합니다.<br />실제 영어의 정확도를 판정하지 않습니다.</p></div>
        <button className="primary start" onClick={start}>대화 시작 <span aria-hidden="true">↗</span></button><p className="hint">설치 후 인터넷·API 키 없이 대화할 수 있어요.</p><p className="hint"><a href="/account">로그인하고 기록 저장하기</a></p>
      </div>
      <div className="welcome-card"><div className="card-top"><span>오늘의 주제</span><span aria-hidden="true">✳</span></div><span className="topic-number">01 / EVERYDAY LIFE</span><h2>A little story<br />about yesterday.</h2><p>어제 무엇을 했나요?</p><div className="sample-question">“What did you do yesterday?”</div><div className="flow-preview"><span>대화</span><span aria-hidden="true">→</span><span>표현 연습</span><span aria-hidden="true">→</span><span>학습 노트</span></div></div>
    </section> : <Conversation session={runtime.session} provider={runtime.provider} onReset={() => setRuntime(undefined)} />}
    <footer className="site-footer"><span>Small conversations. Lasting progress.</span><span>Talkie · 첫 학습 흐름</span></footer>
  </main>;
}
