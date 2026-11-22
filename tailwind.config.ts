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
        // 상태 표시용 의미 색. 배지/안내 박스는 light 배경 + dark 글자 조합으로 쓴다.
        // emerald/amber/rose를 직접 쓰던 곳은 이 토큰으로 옮긴다.
        success: {
          DEFAULT: "#059669",
          light: "#ECFDF5",
          dark: "#065F46",
        },
        warning: {
          DEFAULT: "#D97706",
          light: "#FEF3C7",
          dark: "#92400E",
        },
        danger: {
          DEFAULT: "#E11D48",
          light: "#FFE4E6",
          dark: "#9F1239",
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
        xs: "0 1px 2px 0 rgba(0,0,0,0.05)",
      },
      // 아래는 코드에서 이미 쓰고 있었지만 Tailwind 3 기본값에 없어 적용되지 않던 값들.
      zIndex: {
        60: "60",
      },
      backdropBlur: {
        xs: "2px",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
      },
      animation: {
        "fade-in": "fade-in 150ms ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
