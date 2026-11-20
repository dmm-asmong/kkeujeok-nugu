import type { Metadata, Viewport } from "next";
import { Black_Han_Sans, IBM_Plex_Sans_KR, Nanum_Pen_Script } from "next/font/google";
import "./globals.css";

const display = Black_Han_Sans({ weight: "400", subsets: ["latin"], variable: "--f-display", preload: false, display: "swap" });
const body = IBM_Plex_Sans_KR({ weight: ["400", "500", "700"], subsets: ["latin"], variable: "--f-body", preload: false, display: "swap" });
const hand = Nanum_Pen_Script({ weight: "400", subsets: ["latin"], variable: "--f-hand", preload: false, display: "swap" });

export const metadata: Metadata = {
  title: "끄적누구 · 낙서로 맞히는 자기소개",
  description: "폰으로 내 얼굴을 끄적이고 TMI 세 줄을 적으면, 큰 화면에서 누군지 맞히는 아이스브레이킹 게임. 앱 설치·가입 없이 QR로 30명이 함께.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f4efe4" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${display.variable} ${body.variable} ${hand.variable}`}>
      <body>{children}</body>
    </html>
  );
}
