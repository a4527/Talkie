import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Talkie · 오늘의 작은 영어 대화",
  description: "짧은 영어 음성 대화와 표현 연습, 근거 기반 학습 노트를 제공하는 로컬 데모",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
