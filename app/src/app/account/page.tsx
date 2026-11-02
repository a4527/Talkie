"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { requestAccountAction } from "../../client/account";
import { errorMessage, useAccount } from "../../client/app";
import { AppFooter, AppHeader } from "../../components/app-header";

const googleResults: Record<string, string> = {
  linked: "Google 계정을 연결했습니다. 다음부터 Google로도 로그인할 수 있어요.",
  reauthenticated: "Google로 본인 확인을 마쳤습니다. 10분 안에 탈퇴를 확정할 수 있어요.",
};

export default function Account() {
  const [account, reload] = useAccount();
  const [statusMessage, setStatusMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const google = params.get("google"), code = params.get("error");
    if (google && googleResults[google]) setStatusMessage(googleResults[google]);
    if (google === "reauthenticated") setDeleteOpen(true);
    if (code) setStatusMessage(errorMessage(new Error(code), "요청을 처리할 수 없습니다."));
    if (google || code) window.history.replaceState(null, "", "/account");
  }, []);
  const info = account.status === "ready" && !signedOut ? account.value : undefined;
  async function act(action: string, purpose?: string) {
    if (!info) return;
    setBusy(true); setStatusMessage("");
    try {
      await requestAccountAction({ action, purpose, emailAddress: info.emailAddress });
      if (action === "request") setStatusMessage("인증 요청을 접수했습니다. 메일함에서 확인해 주세요.");
      if (action === "unlink_google") { setStatusMessage("Google 연결을 해제했습니다."); await reload(); }
      if (action === "logout" || action === "delete") { setSignedOut(true); setStatusMessage(action === "delete" ? "탈퇴가 접수됐습니다. 계정 접근은 차단됐고 데이터는 정리됩니다." : "로그아웃했습니다."); }
    } catch (error) { setStatusMessage(errorMessage(error, "요청을 처리할 수 없습니다.")); }
    finally { setBusy(false); }
  }
  return <main className="shell">
    <AppHeader />
    <section className="page-title"><span className="eyebrow">ACCOUNT</span><h1>내 계정<span>.</span></h1></section>
    {account.status === "loading" && <p className="loading" role="status">불러오는 중…</p>}
    {account.status === "error" && <p role="status" className="form-status">{account.message}</p>}
    <div className="account-grid">
      {info && <>
        <section className="card account-section">
          <h2>로그인 정보</h2>
          <p>{info.emailAddress} 계정으로 로그인했습니다.</p>
          <ul className="method-list">
            <li><span>이메일 링크</span><span className="pill">{info.emailLoginAvailable ? "사용 가능" : "로컬 데모 미지원 주소"}</span></li>
            <li><span>Google</span>{info.google ? <span className="pill on">연결됨 · {info.google.googleEmailAddress}</span> : <span className="pill">연결 안 됨</span>}</li>
          </ul>
          <div className="button-row">
            {!info.google && info.googleLoginAvailable && <a className="secondary" href="/api/auth/google/start?purpose=link">Google 계정 연결</a>}
            {info.google && info.emailLoginAvailable && <button className="secondary" disabled={busy} onClick={() => void act("unlink_google")}>Google 연결 해제</button>}
            <button className="secondary" disabled={busy} onClick={() => void act("logout")}>로그아웃</button>
          </div>
          {info.google && !info.emailLoginAvailable && <p className="hint">Google로 가입한 계정은 로그인 수단을 유지하기 위해 연결을 해제할 수 없어요.</p>}
        </section>
        <section className="card account-section danger-zone">
          <details open={deleteOpen} onToggle={e => setDeleteOpen((e.target as HTMLDetailsElement).open)}><summary>회원 탈퇴</summary>
            <p>탈퇴하면 계정 접근이 바로 차단되고 학습 기록과 노트가 정리됩니다. 먼저 본인 확인을 한 뒤 10분 안에 확정해 주세요.</p>
            <ol className="steps-inline">
              <li>본인 확인 {info.emailLoginAvailable && <button className="secondary" disabled={busy} onClick={() => void act("request", "account_deletion")}>탈퇴 확인 메일 요청</button>}
                {info.google && <a className="secondary" href="/api/auth/google/start?purpose=reauth">Google로 본인 확인</a>}</li>
              <li>확정 <button className="secondary danger" disabled={busy} onClick={() => void act("delete")}>회원 탈퇴 확정</button></li>
            </ol>
          </details>
        </section>
      </>}
      {signedOut && <section className="card account-section"><p>다시 이용하려면 로그인해 주세요.</p><Link className="primary" href="/login">로그인 화면으로 <span aria-hidden="true">↗</span></Link></section>}
    </div>
    <p role="status" className="form-status">{statusMessage}</p>
    <AppFooter />
  </main>;
}
