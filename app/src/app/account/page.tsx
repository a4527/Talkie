"use client";
import { useEffect, useState } from "react";

import { accountAction, messages } from "../../client/account";
export default function Account() {
  const [email, setEmail] = useState("");
  const [current, setCurrent] = useState<string>();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetch("/api/account").then(async r => { if (r.ok) setCurrent((await r.json()).email); }).catch(() => {}); }, []);
  async function act(action: string, purpose?: string) {
    setBusy(true); setStatus("");
    try {
      await accountAction({ action, purpose, email: current ?? email });
      if (action === "request") setStatus("인증 요청을 접수했습니다. 메일함에서 확인해 주세요.");
      if (action === "logout" || action === "delete") { setCurrent(undefined); setStatus(action === "delete" ? "탈퇴가 접수됐습니다. 계정 접근은 차단됐고 데이터는 정리됩니다." : "로그아웃했습니다."); }
    } catch (error) { setStatus(messages[(error as Error).message] ?? "요청을 처리할 수 없습니다."); }
    finally { setBusy(false); }
  }
  return <main className="shell account-shell"><header className="site-header"><a className="brand" href="/">talkie.</a><a href="/learn">학습·내 기록</a></header>
    <section className="card account-card"><h1>내 계정</h1><p>로컬 인증·저장 시험 · 실제 AI와 음성은 연결 전입니다.</p>
      {current ? <><p>{current} 계정으로 로그인했습니다.</p><a className="primary" href="/learn">학습·기록 보기</a>
        <button className="secondary" disabled={busy} onClick={() => void act("logout")}>로그아웃</button>
        <details><summary>회원 탈퇴</summary><p>이메일로 본인 확인 후 10분 안에 탈퇴를 확정할 수 있습니다.</p>
          <button className="secondary" disabled={busy} onClick={() => void act("request", "account_deletion")}>탈퇴 확인 메일 요청</button>
          <button className="secondary" disabled={busy} onClick={() => void act("delete")}>회원 탈퇴 확정</button></details>
      </> : <form onSubmit={e => { e.preventDefault(); void act("request", "login"); }}>
        <label htmlFor="email">이메일 주소</label><input id="email" type="email" required maxLength={254} placeholder="learner@example.test" value={email} onChange={e => setEmail(e.target.value)} />
        <button className="primary" disabled={busy}>로그인 메일 요청</button><p className="hint">로컬 시험에서는 .test 주소의 메일을 <a href="http://127.0.0.1:8025" rel="noreferrer" target="_blank">테스트 메일함</a>에서 확인합니다.</p>
      </form>}
      <p role="status">{status}</p>
    </section></main>;
}
