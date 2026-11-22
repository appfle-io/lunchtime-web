import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 확대를 막지 않는다(작은 글씨를 키워 볼 수 있어야 함). 입력창을 눌렀을 때 iOS가 자동 확대하는
  // 문제는 globals.css에서 모바일 입력창 글자를 16px로 맞춰 해결한다.
};

export const metadata: Metadata = {
  title: "밥시간 | lunchtime",
  description: "회사 동료들과 함께 쓰는 점심 메뉴 추천 서비스",
  icons: {
    icon: "/apple-touch-icon.png",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        {/* Pretendard - 국문 UI에 가장 무난하고 트렌디한 웹폰트 */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css"
        />
      </head>
      <body className="bg-surface-muted text-ink font-sans antialiased">{children}</body>
    </html>
  );
}
