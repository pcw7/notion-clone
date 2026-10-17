import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { themeOfSessionToken } from "@/lib/settings/theme";
import { readDevicePreferences } from "@/lib/settings/device-preferences-cookie";
import { ROOT_TITLE } from "@/lib/nav/screen-title";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// 화면 제목(10d-7a · F-12-13) — 틀을 정하고 화면이 이름을 준다(`nav/screen-title.ts`). 공개 화면은 틀을 씌우지 않는다.
export const metadata: Metadata = {
  title: ROOT_TITLE,
  description: "문서 · 데이터베이스 · 위키를 한곳에서 — 노션과 같은 워크스페이스",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // 테마(8h · F-12-03) — 첫 페인트 전에 정한다. 계정의 값을 서버가 첫 HTML 에 싣는다(로그인 전은 system · `settings/theme.ts`).
  // 세션 쿠키를 읽으므로 모든 화면이 요청 때 그려진다 — 화면들이 이미 세션을 읽어 그렇게 그려지고 있다.
  const theme = await themeOfSessionToken(await readSessionToken());
  // 이 기기의 고대비 · 움직임 줄이기(10d-2 · F-12-13) — 쿠키가 정본이다(브라우저가 쓰고 여기서는 읽기만). 테마와 같이 첫 페인트 전에 싣는다.
  const device = await readDevicePreferences();
  return (
    <html
      // 화면의 글이 한국어다(10d-7a · WCAG 3.1.1) — 화면 읽기가 이 값으로 발음을 고른다
      lang="ko"
      data-theme={theme}
      data-contrast={device.contrast}
      data-motion={device.motion}
      data-font-scale={device.fontScale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
