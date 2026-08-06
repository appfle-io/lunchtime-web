/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 네이버 지도 스크립트를 next/script로 로드하기 때문에 별도 rewrites는 필요 없음.
  // 회사 로고/식당 사진 등 외부 이미지 도메인은 필요 시 images.remotePatterns에 추가.
  images: {
    remotePatterns: [],
  },
};

export default nextConfig;
