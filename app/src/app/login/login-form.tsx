"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { requestAccountAction } from "../../client/account";
import { errorMessage } from "../../client/app";
import { AppFooter, Brand } from "../../components/app-header";

export function LoginForm({ googleAvailable, mailboxUrl }: { googleAvailable: boolean; mailboxUrl: string }) {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("error");
    if (code) { setStatusMessage(errorMessage(new Error(code), "로그인하지 못했습니다.")); window.history.replaceState(null, "", "/login"); }
    void fetch("/api/account").then(r => { if (r.ok) window.location.replace("/home"); }).catch(() => {});
  }, []);
  async function request(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setStatusMessage("");
    try { await requestAccountAction({ action: "request", purpose: "login", emailAddress: email }); setSentTo(email); setStatusMessage("인증 요청을 접수했습니다. 메일함에서 확인해 주세요."); }
    catch (error) { setStatusMessage(errorMessage(error, "요청을 처리할 수 없습니다.")); }
    finally { setBusy(false); }
  }
  return <main className="shell">
    <header className="site-header"><Brand /><Link className="text-link" href="/try">로그인 없이 체험하기</Link></header>
    <section className="auth-layout">
      <div className="auth-copy"><span className="eyebrow">WELCOME TO TALKIE</span><h1>매일 조금씩,<br />기록이 쌓이는 영어<span>.</span></h1>
        <p>로그인하면 대화가 저장되고, 끊겨도 이어서 할 수 있고,<br />날짜별 학습 노트를 다시 볼 수 있어요.</p></div>
      <div className="card auth-card">
        <h2>로그인 · 가입</h2>
        {googleAvailable && <><a className="google-button" href="/api/auth/google/start?purpose=login"><span className="google-mark" aria-hidden="true">G</span>Google로 계속하기</a>
          <div className="divider"><span>또는 이메일</span></div></>}
        {sentTo ? <div className="sent-box">
          <p><strong>{sentTo}</strong>로 로그인 링크를 보냈어요.</p>
          <p className="hint">링크는 10분 동안 한 번만 사용할 수 있어요. 로컬 데모에서는 <a href={mailboxUrl} target="_blank" rel="noreferrer">테스트 메일함</a>에서 확인합니다.</p>
          <button className="text-button" onClick={() => { setSentTo(""); setStatusMessage(""); }}>다른 주소로 받기</button>
        </div> : <form onSubmit={request} className="stack">
          <label htmlFor="email">이메일 주소</label>
          <input id="email" type="email" required maxLength={254} placeholder="learner@example.test" value={email} onChange={e => setEmail(e.target.value)} />
          <button className="primary wide" disabled={busy}>로그인 메일 요청 <span aria-hidden="true">↗</span></button>
          <p className="hint">로컬 데모는 실제 메일을 보내지 않아요. <code>.test</code> 주소를 쓰고 <a href={mailboxUrl} target="_blank" rel="noreferrer">테스트 메일함</a>에서 링크를 열어 주세요.</p>
        </form>}
        <p role="status" className="form-status">{statusMessage}</p>
      </div>
    </section>
    <AppFooter />
  </main>;
}
