import type { Config } from "tailwindcss";

// 트렌디하지만 과하지 않은 톤을 위해 팔레트를 2~3색으로 제한.
// primary: 포인트 컬러(버튼/마커/선택 상태), ink: 텍스트, surface: 카드/바텀시트 배경.
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#FF5D39", // 포인트 컬러 (임시값, 브랜드 확정 시 교체)
          light: "#FFE7E0",
          dark: "#D6431F",
        },
        ink: {
          DEFAULT: "#1B1B1F",
          soft: "#6B6B75",
        },
        surface: {
          DEFAULT: "#FFFFFF",
          muted: "#F5F5F7",
        },
      },
      fontFamily: {
        sans: ["Pretendard", "system-ui", "sans-serif"],
      },
      borderRadius: {
        xl2: "1.25rem",
      },
      boxShadow: {
        soft: "0 8px 24px -8px rgba(0,0,0,0.12)",
      },
    },
  },
  plugins: [],
};

export default config;
