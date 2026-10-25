import type { Metadata, Viewport } from "next";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { themeOfSessionToken } from "@/lib/settings/theme";
import { readDevicePreferences } from "@/lib/settings/device-preferences-cookie";
import { APP_NAME, ROOT_TITLE } from "@/lib/nav/screen-title";
import { supportCheckScript } from "@/lib/platform/browser-support";
import "./globals.css";

// 글꼴은 시스템 글꼴 묶음이다(디자인-1 · `globals.css` 의 `--font-sans` · `--font-mono`) — 웹 글꼴을 내려받지 않는다.

// 화면 제목(10d-7a · F-12-13) — 틀을 정하고 화면이 이름을 준다(`nav/screen-title.ts`). 공개 화면은 틀을 씌우지 않는다.
export const metadata: Metadata = {
  title: ROOT_TITLE,
  description: "문서 · 데이터베이스 · 위키를 한곳에서 — 노션과 같은 워크스페이스",
  // 홈 화면에 설치했을 때(10m-3 · F-12-12 · 정본 §3.10 끝 [보강] 좁은 화면 ⑩ⓐ) — 매니페스트(`manifest.ts`)는 Next 가 링크를 단다. iOS 는
  // 매니페스트 대신 이 머리표와 `apple-icon.tsx` 를 본다.
  appleWebApp: { title: APP_NAME, statusBarStyle: "default" },
};

// 화면 머리(주소 줄 · 설치한 앱의 제목 막대)의 색 — 밝은 · 어두운 테마의 배경(`globals.css` 의 --background). OS 의 설정을 따른다 — 계정의
// 테마(data-theme)는 서버가 HTML 에 싣지만 이 머리표는 미디어 쿼리로만 고를 수 있다.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#191919" },
  ],
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
      className="h-full antialiased"
    >
      <head>
        {/* 지원 브라우저(10i-1 · F-12-15) — 기능 감지 · 못 미치면 안내 띠(앱은 막지 않는다). 앱의 JS 보다 먼저 · ES5 */}
        <script dangerouslySetInnerHTML={{ __html: supportCheckScript() }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
