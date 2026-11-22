# 밥시간 (lunchtime) v2.0.0

회사 단위로 쓰는 점심 메뉴 추천 서비스. 운영 주소: `lunchtime.seeuson.com`

작업 지침과 변경 이력은 `_secret/agent.md`, `_secret/history.md`에 있습니다 (git 미포함, 루트 `AGENTS.md` 참고).

## 스택

- Next.js 14 (App Router) + TypeScript + Tailwind CSS, 배포: Vercel (`main` 브랜치 push 시 자동 배포)
- Firebase
  - Firestore: 서버(Admin SDK)에서만 읽고 쓴다. 클라이언트 접근은 `firestore.rules`로 전면 차단
  - Realtime Database: 실시간 배틀 전용. 서버가 발급한 커스텀 토큰으로 로그인, `database.rules.json`으로 권한 제한
  - Authentication: 배틀용 커스텀 토큰 로그인에만 사용
- 네이버 지도 JavaScript API v3, Gemini API, 기상청 API

## 시작하기

```bash
npm install
cp .env.example .env.local   # 값 채우기
npm run dev                  # http://localhost:3300
```

Firebase 규칙/색인 배포 (대상 프로젝트는 `.firebaserc`에 `lunchtime-d2364`로 고정):

```bash
npx firebase-tools deploy --only database,firestore --project lunchtime-d2364
```

## 폴더 구조

```
src/app/                      페이지와 API 라우트
  [companyCode]/              회사별 메인 화면, admin/ 관리자 화면
  api/                        서버 API (인증, 식당, 투표, 배틀 토큰, 관리자 점검 등)
src/components/               화면 컴포넌트 (battle/, games/ 포함)
src/hooks/useBattleRoom.ts    실시간 배틀 (RTDB)
src/lib/                      서버/클라이언트 로직
  zeropay-official.ts         제로페이 공식 사이트 조회·판정 (판정 기준)
  naver-place-detail.ts       네이버 플레이스 정보 수집 (참고 정보, 제로페이 판정에 사용 금지)
  enrich-server.ts            식당 정보 수집기 (네이버 + 제로페이)
scripts/                      운영용 데이터 스크립트 (package.json에 등록된 것만)
database.rules.json           RTDB 보안 규칙
firestore.rules               Firestore 보안 규칙 (클라이언트 전면 차단)
firestore.indexes.json        Firestore 복합 색인
```

## 데이터 구조

모든 데이터는 `companies/{companyCode}` 아래에 회사별로 나뉜다 (users, restaurants, votes, hourlyStats, cache 등).
