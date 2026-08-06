# lunchtime (점메추)

회사 점심 메뉴 추천 서비스 초안. `lunchtime.seeuson.com`으로 배포 예정.
Claude Project **"밥시간"**의 기획/아키텍처 논의를 바탕으로 만든 코드 스캐폴드입니다.
(내부 코드네임 "밥시간" ↔ 외부 브랜드/도메인 "점메추"/"lunchtime" 병행 사용)

## 핵심 설계 원칙

- **멀티테넌트**: 모든 데이터는 `Company`를 최상위로 두고 `companyId`로 스코프. 새 회사가 붙어도 코드 변경 없이 데이터(Company row + 식당 시딩)만 추가하면 됨.
- **가벼운 인증**: OAuth 없이 "회사코드 + 닉네임 + PIN 4자리"로 계정 생성. 닉네임은 회사 내에서만 유일해야 함.
- **제로페이 필터**: 초기엔 공공데이터 자동 매칭 + 수동 보완으로 시딩하고, 운영 중에는 "여기 제로페이 돼요/안돼요" 사내 투표로 계속 보정 (`ZeroPayVote` 모델).
- **지도**: 네이버 지도(NCP Maps)를 쓰되 Map Style Editor 커스텀 스타일 + 커스텀 SVG 마커로 기본 네이버지도 느낌을 지운다.
- **UI**: 지도를 전체 배경으로 깔고 리스트/필터는 바텀시트(모바일)/플로팅 카드(데스크톱)로 얹는 구성. "좌측 리스트 + 우측 지도"라는 전형적인 틀을 피한다.
- **리뷰 신뢰도 검증 장치는 의도적으로 넣지 않음** — 회사 내부 인원만 쓰는 토이 프로젝트라 어뷰징 리스크를 감수하기로 결정.

## 스택

- Next.js 14 (App Router) + TypeScript + Tailwind CSS
- Prisma + PostgreSQL (Supabase/Neon 등 매니지드 권장)
- 네이버 지도 JavaScript API v3 (NCP Maps)
- Gemini API (`@google/generative-ai`) - 추천/리뷰 요약
- 배포: Vercel

> packinbag 프로젝트와 계정(Vercel 팀 / Google 계정)은 공유해도 되지만, **Firebase 프로젝트 / Gemini API 키는 이 서비스 전용으로 새로 발급**하는 걸 권장합니다 (데이터·쿼터·보안 격리).

## 시작하기

```bash
npm install
cp .env.example .env.local   # 값 채우기 (DB, 네이버 지도 클라이언트 ID, Gemini API 키)
npx prisma generate
npx prisma migrate dev --name init
npm run dev
```

## 폴더 구조

```
src/
  app/
    page.tsx                 # 진입점: 회사코드 입력
    [companyCode]/page.tsx   # 회사별 메인 화면 (지도 + 리스트)
    api/nickname/suggest/    # 닉네임 후보 제안 API
  components/
    MapView.tsx              # 네이버 지도 렌더링 + 커스텀 마커
    RestaurantList.tsx       # 필터 + 점메추 버튼 + 식당 목록
    BottomSheet.tsx          # 바텀시트/플로팅 카드 공용 셸
  lib/
    db.ts                    # Prisma client
    nickname.ts              # 닉네임 후보 생성/중복 처리
    gemini.ts                # Gemini 추천/리뷰요약 호출
  types/index.ts
prisma/schema.prisma          # 멀티테넌트 스키마 (Company/User/Restaurant/Review/Visit/ZeroPayVote)
```

## 아직 안 된 것 (다음 단계)

- [ ] 회사 생성/관리자 온보딩 화면 (회사코드, 중심좌표, 관할 구청 코드 입력)
- [ ] 식당 시딩 스크립트 (네이버 지도 검색 API + 제로페이 공공데이터 퍼지 매칭)
- [ ] 회사코드+닉네임+PIN 실제 가입/로그인 플로우 (세션 쿠키)
- [ ] 리뷰 작성 UI + API
- [ ] "오늘 뭐 먹지?" 룰렛 인터랙션 + `/api/recommend` (Gemini) 연동
- [ ] 방문 히스토리 저장/캘린더 뷰
- [ ] 네이버 지도 Map Style Editor로 커스텀 스타일 ID 발급 후 적용
- [ ] 네이버 지역검색/플레이스 API 응답에 제로페이 필드가 실제로 있는지 검증

자세한 기획/아키텍처 논의 배경은 Claude Project "밥시간"의 `기획/서비스아이디어_초안.md` 문서 참고.
