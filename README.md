# 밥시간 (lunchtime)

회사 점심 메뉴 추천 서비스 초안. 프로젝트/브랜드명은 **"밥시간"**, 도메인은 `lunchtime.seeuson.com`으로 배포 예정.
Claude Project **"밥시간"**의 기획/아키텍처 논의를 바탕으로 만든 코드 스캐폴드입니다.

## 핵심 설계 원칙

- **멀티테넌트**: 모든 데이터는 `companies/{companyId}` 를 최상위로 두고 그 아래 서브컬렉션으로 스코프. 새 회사가 붙어도 코드 변경 없이 데이터(company 문서 + 식당 시딩)만 추가하면 됨. 자세한 컬렉션 구조는 `docs/firestore-data-model.md` 참고.
- **가벼운 인증**: OAuth 없이 "회사코드 + 닉네임 + PIN 4자리"로 계정 생성. 닉네임은 회사 내에서만 유일해야 함 (Firestore 문서ID로 유일성 보장).
- **제로페이 필터 & 정합성 검증**: 초기엔 공공데이터/공식 API 자동 매칭 + 수동 보완으로 시딩하며, 브랜드 상호 무차별 오매칭(False Positive) 방지를 위해 엄격한 브랜드명 일치(`validateBrandMatch`) 및 건물 번호 검증을 적용합니다. 관리자 화면에서 전체 점검 및 변경 내역 프리뷰 후 선택적 일괄 반영(Batch Update)이 가능합니다.
- **지도**: 네이버 지도(NCP Maps)를 쓰되 Map Style Editor 커스텀 스타일 + 커스텀 SVG 마커로 기본 네이버지도 느낌을 지운다.
- **UI**: 지도를 전체 배경으로 깔고 리스트/필터는 바텀시트(모바일)/플로팅 카드(데스크톱)로 얹는 구성. "좌측 리스트 + 우측 지도"라는 전형적인 틀을 피한다.
- **리뷰 신뢰도 검증 장치는 의도적으로 넣지 않음** — 회사 내부 인원만 쓰는 토이 프로젝트라 어뷰징 리스크를 감수하기로 결정.

## 스택

- Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **Firebase / Firestore** (packinbag에서 이미 쓰던 도구를 재사용 - 처음엔 Postgres+Prisma로 제안했다가, 이미 익숙한 Firebase로 전환 결정)
- 네이버 지도 JavaScript API v3 (NCP Maps)
- Gemini API (`@google/generative-ai`) - 추천/리뷰 요약
- 배포: Vercel

> packinbag 프로젝트와 계정(Vercel 팀 / Google 계정)은 공유해도 되지만, **Firebase 프로젝트 / Gemini API 키는 이 서비스 전용으로 새로 발급**하는 걸 권장합니다 (데이터·쿼터·보안 격리). Firebase는 콘솔에서 "프로젝트 추가"로 packinbag과 별개의 새 프로젝트를 만들고, Firestore Database를 서울 리전(asia-northeast3)으로 생성하세요.

## 시작하기

```bash
npm install
cp .env.example .env.local   # 값 채우기 (Firebase config + 서비스계정 키, 네이버 지도 Client ID/Secret, Gemini API 키)
npm run dev
```

`npm run dev`는 **3300번 포트**로 뜹니다 (3000번은 packinbag, 5000번은 macOS AirPlay Receiver가 기본으로
쓰고 있어서 충돌 방지용으로 `-p 3300` 지정해둠). 브라우저에서 `http://localhost:3300`으로 접속하세요.
네이버 지도 Application의 Service URL도 `http://localhost:3300`으로 맞춰줘야 지도가 정상적으로 뜹니다.

Firestore는 스키마 마이그레이션이 따로 없어서(스키마리스) `prisma migrate` 같은 단계가 없습니다.
처음 실행 전에 회사 문서 하나(`companies/{companyId}`)를 콘솔에서 직접 만들어두면 바로 접속 테스트가 가능합니다.

## 폴더 구조

```
src/
  app/
    page.tsx                      # 진입점: 회사코드 입력
    [companyCode]/page.tsx        # 회사별 메인 화면 (지도 + 리스트)
    [companyCode]/admin/page.tsx  # 회사별 관리자 페이지 (가맹점 표 편집 + 전체 점검 + 문의하기)
    api/
      admin/zeropay/check-all/    # 제로페이 가맹점 전체 점검 API (브랜드 불일치 오매칭 검출)
      admin/naver/check-all/      # 네이버 정보 갱신 전체 점검 API
      admin/batch-update/         # 점검 모달 선택 항목 DB 일괄 반영 API
      nickname/suggest/           # 닉네임 후보 제안 API (Firestore 조회)
  components/
    AdminDashboard.tsx            # 관리자 대시보드 (엑셀형 표 편집 + 🛡️제로페이 점검 / 🔄네이버 갱신 모달)
    MapView.tsx                   # 네이버 지도 렌더링 + 커스텀 마커
    RestaurantList.tsx            # 필터 + "오늘 뭐 먹지?" 버튼 + 식당 목록
    BottomSheet.tsx               # 바텀시트/플로팅 카드 공용 셸
  lib/
    zeropay-official.ts           # 제로페이 공식 API 연동 및 브랜드 상호 정합성 검증 (`validateBrandMatch`)
    firebase.ts                   # Firebase Admin SDK 초기화 (서버용 Firestore 클라이언트)
    nickname.ts                   # 닉네임 후보 생성/중복 처리 (문서ID 정규화 포함)
    gemini.ts                     # Gemini 추천/리뷰요약 호출
  types/index.ts
docs/firestore-data-model.md       # 멀티테넌트 컬렉션 구조 문서 (companies/users/restaurants/reviews/visits/zeroPayVotes)
```

## 아직 안 된 것 (다음 단계)

- [ ] 회사 생성/관리자 온보딩 화면 (회사코드, 중심좌표, 관할 구청 코드 입력)
- [ ] 식당 시딩 스크립트 (네이버 지도 검색 API + 제로페이 공공데이터 퍼지 매칭)
- [ ] 회사코드+닉네임+PIN 실제 가입/로그인 플로우 (세션 쿠키, `users/{닉네임ID}.create()`로 유일성 보장)
- [ ] 리뷰 작성 UI + API
- [ ] "오늘 뭐 먹지?" 룰렛 인터랙션 + `/api/recommend` (Gemini) 연동
- [ ] 방문 히스토리 저장/캘린더 뷰
- [ ] 네이버 지도 Map Style Editor로 커스텀 스타일 ID 발급 후 적용
- [ ] 네이버 지역검색/플레이스 API 응답에 제로페이 필드가 실제로 있는지 검증
- [ ] Firestore 보안 규칙(`firestore.rules`) 작성 - 최소한 다른 회사 경로 접근은 막기

자세한 기획/아키텍처 논의 배경은 Claude Project "밥시간"의 `기획/서비스아이디어_초안.md` 문서 참고.
