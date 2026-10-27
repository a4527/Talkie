"use client";
import { apiErrorMessages } from "../../../client/api-error-messages";
import { useEffect, useRef, useState } from "react";
import { requestAccountAction } from "../../../client/account";
export default function Confirm() {
  const [authLinkToken, setAuthLinkToken] = useState("");
  const [target, setTarget] = useState<{ emailAddress: string; purpose: string }>();
  const [statusMessage, setStatusMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const original = useRef<string | undefined>(undefined);
  useEffect(() => {
    const value = original.current ?? window.location.hash.slice(1);
    original.current = value;
    window.history.replaceState(null, "", window.location.pathname);
    if (!value) { setStatusMessage("유효한 인증 링크가 아닙니다."); return; }
    setAuthLinkToken(value);
    requestAccountAction({ action: "inspect", authLinkToken: value }).then(setTarget)
      .catch(error => setStatusMessage(apiErrorMessages[error.message] ?? "링크를 확인할 수 없습니다."));
  }, []);
  async function confirm() {
    setBusy(true);
    try {
      const result = await requestAccountAction({ action: "confirm", authLinkToken: authLinkToken });
      setAuthLinkToken(""); setTarget(undefined);
      setStatusMessage(result.purpose === "account_deletion" ? "본인 확인을 마쳤습니다. 내 계정에서 10분 안에 탈퇴를 확정해 주세요." : "로그인했습니다. 학습을 시작할 수 있습니다.");
    } catch (error) { setStatusMessage(apiErrorMessages[(error as Error).message] ?? "확인할 수 없습니다."); }
    finally { setBusy(false); }
  }
  return <main className="shell account-shell"><section className="card account-card"><h1>이메일 본인 확인</h1>
    {target && <><p><strong>{target.emailAddress}</strong></p><p>{target.purpose === "account_deletion" ? "이 계정의 탈퇴 본인 확인을 진행합니다." : "이 브라우저에서 위 계정으로 로그인합니다. 본인이 요청한 계정인지 확인해 주세요."}</p>
      <button className="primary" disabled={busy} onClick={() => void confirm()}>확인하고 계속</button></>}
    <p role="status">{statusMessage}</p><a href="/account">내 계정</a><a href="/learn">학습·내 기록</a>
  </section></main>;
}
