# 📌 점심시간(Lunchtime) 가맹점 데이터 수집 규칙 & 메커니즘

이 문서는 네이버 지도(Naver Map) 및 제로페이 공식 사이트(zeropay.or.kr)로부터 식당 상세 정보와 제로페이 가맹점 여부를 차단 없이 수집하도록 구현된 로직 및 규칙을 기록합니다.

---

## 1. 제로페이(ZeroPay) 공식 가맹점 수집 규칙

### 🚨 불변 원칙 (Unbreakable Rule)
- **네이버 지도의 "제로페이" 배지/결제수단 라벨은 절대로 `isZeroPay: true`를 자동 확정하는 용도로 사용하지 않는다.** (네이버 표기 데이터의 불확실성 때문)
- **제로페이 가맹점 판단 최종 기준 3가지**:
  1. `zeropay.or.kr` 공식 조회결과 일치 (`TRX_TP=01`) 및 **브랜드 상호 정합성 검증 (`validateBrandMatch`) 통과**
  2. 사내 사용자 엄지척/거꾸로엄지척 투표 집계 결과
  3. 관리자 직접 수동 설정 (`isZeroPay: true/false`)

---

### 🔀 상호명 불일치 해결: 검색어 다각도 자동 변형 (Query Variants)
우리가 가진 식당 이름(예: *"영등포 아바이 순대국"*)과 제로페이 공식 등록 사업자 상호명(예: *"아바이순대국"*, *"(주)아바이순대 문래점"*)이 다를 수 있으므로, `generateQueryVariants` 함수가 아래 순서로 **검색어 변형을 자동 생성하여 제로페이 API에 순차적으로 조회**합니다:

1. **공백 제거 및 원본**: `영등포 아바이 순대국` ➔ `영등포아바이순대국`
2. **지역명/행정구역 접두사 제거**: `서울특별시`, `영등포구`, `영등포`, `여의도` 등 제거 ➔ `아바이순대국`
3. **법인격/지점명/괄호 제거**: `(주)`, `주식회사`, `[본점]`, `문래역점`, `1호점`, `직영점` 등 제거 ➔ `아바이순대`
4. **브랜드/한영표기 변환 매핑**:
   - `GS25` ↔ `지에스25`, `CU` ↔ `씨유`, `서브웨이` ↔ `써브웨이`, `천씨씨` ↔ `1000cc`, `삼삼` ↔ `33`
5. **대형 건물/시설명 키워드 제외 규칙**:
   - `타임스퀘어`, `홈플러스`, `성심`, `하이테크시티`, `백화점`, `빌딩`, `타워` 등 시설 키워드가 메인 브랜드명을 대체하여 단독 검색어로 전달되는 오탐 방지.
6. **핵심 단어(2글자 이상 한글) 분리 키워드 추출**: `아바이`, `순대국`

---

### 📍 상호명이 달라도 동일 가맹점인지 검증하는 방식 (`isAddressMatched` & `validateBrandMatch`)
검색 결과로 여러 가맹점이 검색되거나 상호명이 약간 다를 경우, **DB의 가맹점 주소(`dbAddress`) 및 브랜드 상호 정합성**을 교차 검증하여 동일 매장인지 최종 판정합니다:

1. **브랜드 상호 정합성 필수 검증 (`validateBrandMatch`) [2026-08-14 강화]**:
   - DB 상호명(예: `스타벅스`, `배스킨라빈스`, `파리바게뜨`, `CU`)과 제로페이 매칭 상호명(예: `강창구찹쌀진순대`, `스시이안앤`, `통영굴밥`, `세븐일레븐`)의 핵심 브랜드 단어가 불일치하면 **주소나 건물 번호가 같더라도 제로페이 매칭을 엄격히 차단 (`isZeroPay: false`)**.
2. **도로명/길 이름 교차 검증 (`extractRoadName`)**:
   - DB 주소와 제로페이 등록 주소의 `XX로` 또는 `XX길`이 완전 일치하는지 확인 (예: `영중로14길` === `영중로14길`)
3. **건물 번호 엄격 오차 매칭 (`extractBuildingNum`) [2026-08-14 축소]**:
   - 건물 본번 차이가 **±5 이내**인 경우에만 표기 오차 감안하여 매칭 허용 (기존 ±20에서 축소하여 인근 동종 업체 오매칭 방지).
4. **법정동/행정동 매칭 (`extractDong`)**:
   - `XX동` 정보가 서로 일치하는지 보조 검증
5. **업종코드 필터링 (`isFoodBizType`)**:
   - 등록 업종(`BIZ_TYPE`)이 음식점, 카페, 제과, 주점, 편의점 등 식생활 관련 업종 키워드(`FOOD_BIZ_KEYWORDS`)일 때만 제로페이 식당으로 승인 (동일 상호의 부동산/미용실 등 오매칭 방지)

---

### 📡 수집 API & 환경별 차이점 (로컬 vs 운영)

- **엔드포인트**: `POST https://www.zeropay.or.kr/UI_HP_009_03.act`
- **요청 파라미터**: `AFLT_ADDR_CITY=서울특별시`, `AFLT_ADDR_GU=${구}`, `AFLT_NM=${변형검색어}`, `TRX_TP=01`

| 구분 | 로컬 (개발 환경 / 사내망) | 운영기 (Vercel Production) |
| :--- | :--- | :--- |
| **네트워크 환경** | 사내망 보안 정책으로 인해 로컬 PC에서 `zeropay.or.kr` 직접 접속 시 `ECONNRESET` / 404 에러 발생 가능 (사내망 특성) | 방화벽 제약이 없어 Vercel 서버에서 `zeropay.or.kr` Pure HTTP 호출 시 **100% 정상 수집 완료 (약 0.2초)** |
| **수집 엔진** | Pure HTTP 우선 사용 (필요시 브라우저 디버깅 지원) | 크롬 브라우저(`chromium.launch`)를 절대 호출하지 않고 **100% Pure HTTP `fetch()` 폴백**으로 0.2초 만에 즉시 수집 |

---

## 2. 관리자 점검 & 선택형 일괄 반영 (Batch Update) 메커니즘 [2026-08-14 신규]

### 🛡️ 관리자 페이지 상단 액션 버튼
1. **`🛡️ 제로페이 가맹점 전체 점검`** (`/api/admin/zeropay/check-all`)
   - 강화된 `validateBrandMatch` 로직으로 전 가맹점을 수집/스캔하여 브랜드 불일치 오매칭(`isZeroPay: true ➔ false`) 및 오매칭 찌꺼기 텍스트 정리 대상을 추려 변경 사항 목록(Diff) 반환.
2. **`🔄 네이버 정보 갱신`** (`/api/admin/naver/check-all`)
   - 전 가맹점의 전화번호, 네이버 상호, 도로명 주소 등 네이버 최신 데이터 변경 사항 목록(Diff) 반환.

### 📋 변경 내역 프리뷰 및 선택 반영 모달 UI (Inspection Diff Preview Modal)
- **비파괴적 점검**: 버튼 클릭 시 즉시 DB에 변경을 적용하지 않음.
- **Diff 시각화**: `기존 (Before) ➔ 변경 예정 (After)` 차이점 및 이유(예: `브랜드 상호 불일치 오매칭`)를 미리보기 카드로 명확히 표시.
- **다중/전체 선택**: `전체 선택 / 전체 해제` 및 개별 체크박스로 사용자가 승인한 항목만 선택.
- **안전한 일괄 반영**: `선택한 N개 항목 DB 반영하기` 클릭 시 `/api/admin/batch-update` API를 호출하여 선택된 데이터만 Firestore에 Batch Commit으로 안전하게 업데이트.

---

## 3. 네이버 지도(Naver Map) 데이터 수집 규칙 & 항목

### 🔍 1단계: 네이버 Place ID 검색 (`lookupNaverPlaceDetail`)
- **기존 방식의 한계**: `map.naver.com/p/api/search/allSearch` API는 서버 간 HTTP 요청 시 네이버 보안 캡차(`ncaptcha-all-search-no-result`)로 차단됨.
- **최종 성공 방식**: **네이버 통합 검색 페이지(`https://search.naver.com/search.naver?where=nexsearch&query=${query}`) HTML 파싱**.
  - 캡차 차단 없이 통합 검색 HTML 내 `map.naver.com/p/entry/place/(\d+)` URL 패턴에서 Place ID(예: `37778669`)를 0.1초 만에 안전하게 추출.

### 🏢 2단계: 네이버 Place 상세 정보 수집 (`fetchNaverPlaceFullDetails`)
- `https://map.naver.com/p/entry/place/${placeId}` HTML 수신 후 `window.__APOLLO_STATE__` JSON을 정규식으로 파싱하여 추출.

### 📋 수집 항목 & Apollo 스키마 파싱 위치
1. **전화번호 (`phone`)**: `PlaceDetailBase.phone` 또는 `ROOT_QUERY.placeDetail.phone`
2. **주간 영업시간표 (`businessHours`)**:
   - **핵심 위치**: `apollo['ROOT_QUERY'][placeDetailKey]['newBusinessHours({"format":"restaurant"})']`
   - 요일별 운용시간(예: `월: 07:30 - 21:00`), 라스트오더(`20:05 라스트오더`), 정기휴무일(`매달 3번째 일요일 정기 휴무`) 포함 추출.
3. **편의시설 (`facilities`)**: `PlaceDetailBase.facilityInfo.names` (예: `['포장', '단체 이용 가능']`)
4. **결제수단 (`paymentMethods`)**: `PlaceDetailBase.paymentInfo.paymentMethods` (예: `['제로페이', '신용카드']`)
5. **메뉴 목록 (`menus`)**: `PlaceDetailBase.menus` (메뉴명, 가격 콤마 포맷팅, 메뉴 이미지 URL, 설명, 대표/인기 태그)
6. **AI 한줄 요약 (`aiBriefing`)**: `PlaceDetailBase.aiBriefing`
7. **매칭 상호명/주소**: `matchedName`, `matchedAddress`

### 🌐 환경별 차이점 (로컬 vs 운영)
| 구분 | 로컬 (개발 환경) | 운영기 (Vercel Production) |
| :--- | :--- | :--- |
| **크롤링 엔진** | Pure HTTP `fetch()`로 동일하게 작동 (수초 소요되는 Playwright 미사용) | Vercel Serverless Function 특성상 Playwright 실행 파일이 없으므로 **100% Pure HTTP `fetch()`로만 구동** |
| **속도 & 안정성** | ~0.5초 내 추출 | 서버리스 타임아웃 및 캡차 걱정 없이 **~0.5초 내 수집 완수** |

---

## 4. 핵심 관련 소스 코드 파일

- [`src/lib/zeropay-official.ts`](file:///c:/Users/user/Desktop/SSG/workspace/lunchtime/src/lib/zeropay-official.ts) : 제로페이 공식 API 연동, `validateBrandMatch` 브랜드 정합성 검증, 건물번호 오차 축소(±5), 시설 키워드 제외
- [`src/app/api/admin/zeropay/check-all/route.ts`](file:///c:/Users/user/Desktop/SSG/workspace/lunchtime/src/app/api/admin/zeropay/check-all/route.ts) : 제로페이 오매칭 전수 점검 API
- [`src/app/api/admin/naver/check-all/route.ts`](file:///c:/Users/user/Desktop/SSG/workspace/lunchtime/src/app/api/admin/naver/check-all/route.ts) : 네이버 정보 갱신 점검 API
- [`src/app/api/admin/batch-update/route.ts`](file:///c:/Users/user/Desktop/SSG/workspace/lunchtime/src/app/api/admin/batch-update/route.ts) : 선택 항목 DB 일괄 반영 API
- [`src/components/AdminDashboard.tsx`](file:///c:/Users/user/Desktop/SSG/workspace/lunchtime/src/components/AdminDashboard.tsx) : 관리자 상단 점검 버튼 및 Diff 프리뷰 선택 모달 UI
- [`src/lib/naver-place-detail.ts`](file:///c:/Users/user/Desktop/SSG/workspace/lunchtime/src/lib/naver-place-detail.ts) : 네이버 Place ID 검색, Apollo 스키마 영업시간/메뉴/전화 파싱
- [`src/lib/enrich-server.ts`](file:///c:/Users/user/Desktop/SSG/workspace/lunchtime/src/lib/enrich-server.ts) : 통합 가맹점 엔리치먼트 실행기 (`enrichRestaurantById`)
- [`src/app/api/admin/restaurants/enrich/route.ts`](file:///c:/Users/user/Desktop/SSG/workspace/lunchtime/src/app/api/admin/restaurants/enrich/route.ts) : 수동 수집 관리자 POST API
