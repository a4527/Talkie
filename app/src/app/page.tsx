"use client";
import Link from "next/link";
import { useOptionalAccount } from "../client/app";
import { AppFooter, Brand } from "../components/app-header";

const steps = [
  { no: "01", title: "짧게 대화해요", body: "어제 있었던 일, 좋아하는 것 같은 일상 주제로 AI 튜터와 영어로 이야기해요. 한 문장이면 충분해요." },
  { no: "02", title: "표현 하나를 다시 말해요", body: "대화 흐름을 끊지 않고 가장 쓸모 있는 표현 하나만 짚어 주고, 다시 말해 볼 기회를 줘요." },
  { no: "03", title: "노트로 남겨요", body: "대화가 끝나면 실제로 말한 문장을 근거로 오늘의 표현과 복습할 내용을 노트로 정리해요." },
];

export default function Landing() {
  const email = useOptionalAccount();
  return <main className="shell">
    <header className="site-header"><Brand />
      {email ? <Link className="secondary" href="/home">내 홈으로</Link> : <Link className="secondary" href="/login">로그인</Link>}
    </header>
    <section className="welcome">
      <div className="welcome-copy"><span className="eyebrow">A LITTLE ENGLISH, EVERY DAY</span>
        <h1>어제의 이야기로,<br />오늘의 영어 한 걸음<span>.</span></h1>
        <p>목소리로 짧게 대화하고, 표현 하나를 연습하고,<br />나만의 학습 노트로 남겨 보세요.</p>
        <div className="cta-row">
          <Link className="primary start" href={email ? "/home" : "/login"}>{email ? "오늘 대화 이어가기" : "시작하기"} <span aria-hidden="true">↗</span></Link>
          <Link className="text-link" href="/try">로그인 없이 체험하기</Link>
        </div>
      </div>
      <div className="welcome-card"><div className="card-top"><span>오늘의 주제</span><span aria-hidden="true">✳</span></div><span className="topic-number">01 / EVERYDAY LIFE</span><h2>A little story<br />about yesterday.</h2><p>어제 무엇을 했나요?</p><div className="sample-question">“What did you do yesterday?”</div><div className="flow-preview"><span>대화</span><span aria-hidden="true">→</span><span>표현 연습</span><span aria-hidden="true">→</span><span>학습 노트</span></div></div>
    </section>
    <section className="steps" aria-label="Talkie 학습 방법">
      {steps.map(step => <article key={step.no} className="step"><span className="topic-number">{step.no}</span><h2>{step.title}</h2><p>{step.body}</p></article>)}
    </section>
    <AppFooter />
  </main>;
}
