# Firestore 데이터 모델

Postgres+Prisma 대신 Firestore(Firebase)로 전환. packinbag에서 이미 쓰던 도구를 재사용해서
새 DB 계정/ORM을 배우지 않아도 되게 한 결정 (2026-08-05).

회사(companyId)를 최상위로 두고, 그 아래 서브컬렉션으로 모든 데이터를 스코프한다.
이렇게 하면 "다른 회사 데이터가 섞이지 않게" 하는 규칙이 경로 자체에 자연스럽게 들어간다.

```
companies/{정규화된 회사코드}   // 문서ID = normalizeCompanyCode(입력값) → 대소문자 구분 없이 항상 같은 문서로 매칭 (예: SSG/Ssg/ssg 모두 companies/ssg)
  name: string
  centerLat: number
  centerLng: number
  districtCode?: string   // 관할 구/시청 코드 (제로페이 공공데이터 매칭용)
  createdAt: Timestamp

  users/{nicknameId}       // 문서ID = 정규화된 닉네임(소문자, 공백→하이픈) → 같은 회사 내 중복이 "생성 실패"로 자연스럽게 막힘
    nickname: string       // 원래 표기 그대로 (표시용)
    pinHash: string
    createdAt: Timestamp

  restaurants/{restaurantId}
    name: string
    address: string
    lat: number
    lng: number
    category?: string
    isZeroPay: boolean
    zeroPaySource?: "public_data" | "manual" | "user_vote"
    createdAt: Timestamp

    reviews/{reviewId}
      userId: string        // users 서브컬렉션 문서ID(닉네임ID) 참조
      authorNickname: string
      content: string
      rating?: number
      createdAt: Timestamp

    visits/{visitId}
      userId: string
      visitedAt: Timestamp

    zeroPayVotes/{voteId}   // "여기 제로페이 돼요/안돼요" 사내 제보
      userId: string
      isZeroPay: boolean
      createdAt: Timestamp
```

## 왜 이렇게 짰는지

- **닉네임 유일성**: Postgres였으면 `@@unique([companyId, nickname])` 제약으로 처리했을 것을,
  Firestore에서는 `companies/{companyId}/users/{정규화된 닉네임}` 문서ID 자체를 유일성 키로 씀.
  문서 생성 시 `create()`(존재하면 실패)를 쓰면 동시 가입 race condition도 걱정 없음.
- **회사코드 대소문자 무관 매칭**: 같은 이유로 회사 문서ID도 `normalizeCompanyCode()`(소문자+trim)를
  거친 값을 씀. `where("code","==",...)` 쿼리 대신 `doc(정규화코드).get()`으로 바로 찾을 수 있어 더 단순함.
- **회사 스코프**: 모든 하위 데이터가 `companies/{companyId}` 경로 아래에 있으므로,
  Firestore 보안 규칙에서도 "이 경로의 companyId와 내 세션의 companyId가 같을 때만 허용" 한 줄로 충분.
- **조인이 필요한 조회**(예: "이 회사에서 최근 리뷰 20개")는 리뷰를 회사 레벨의 별도 컬렉션
  (`companies/{companyId}/recentReviews`)에 비정규화해서 복제해두는 방식으로 나중에 최적화 가능.
  지금 규모(식당 몇십 개)에서는 필요 없음.

## 아직 안 만든 것

- Firestore 보안 규칙 (`firestore.rules`) - 지금은 리뷰 신뢰도 검증을 안 하기로 했으므로 초기엔
  "로그인 없이도 읽기/쓰기 가능"한 느슨한 규칙으로 시작해도 무방하지만, 최소한 다른 회사 경로를
  건드리지 못하게 하는 규칙 정도는 배포 전에 추가 권장.
- 회사/식당 시딩 스크립트 (Admin SDK로 일괄 `set`).
