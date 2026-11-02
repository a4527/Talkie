import { googleLoginAvailable } from "../../server/google-auth";
import { LoginForm } from "./login-form";
export const dynamic = "force-dynamic";
export default function Login() {
  return <LoginForm googleAvailable={googleLoginAvailable()} mailboxUrl={process.env.NEXT_PUBLIC_MAILPIT_ORIGIN ?? "http://127.0.0.1:8025"} />;
}
