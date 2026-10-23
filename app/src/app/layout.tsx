import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Talkie · 오늘의 작은 영어 대화",
  description: "가짜 AI와 함께 첫 학습 흐름을 확인하는 로컬 텍스트 데모",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
