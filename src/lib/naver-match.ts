import {
  isSameFullName,
  isSameRoadAddress,
  parseRoadAddress,
  parseRoadName,
  sharesDistinctiveName,
  validateBrandMatch,
} from "@/lib/zeropay-official";

/**
 * 네이버 플레이스가 DB 식당과 같은 가게인지 판정한다.
 *
 * 네이버 검색은 이름만으로 찾기 때문에 다른 지역의 같은 이름 가게, 이름이 비슷한 다른 업종
 * ("코리아" -> 용인 "팜코리아약국"), 같은 체인의 다른 지점이 첫 결과로 나올 수 있다.
 * 그래서 네이버 정보(이름, 전화, 영업시간, 메뉴)는 "match"일 때만 반영한다.
 *
 * - match: 주소가 같고 상호에 관계가 있다 / 같은 도로에서 건물번호가 조금 다르지만 상호가 지점명까지 같다
 * - mismatch: 지역이 다르거나, 주소가 다르거나, 같은 주소인데 상호가 전혀 다르다
 * - unknown: 비교할 주소/상호가 없어서 판정할 수 없다 (반영하지 않는다)
 *
 * 영문/한글 표기 차이("GTS버거"/"지티에스버거", "DETOXI"/"디톡시")는 다른 가게로 판정된다.
 * 이런 곳은 관리자가 네이버 지도 링크를 직접 넣으면 수동 매칭으로 반영된다.
 */
export type NaverMatchVerdict = "match" | "mismatch" | "unknown";

export interface NaverMatchResult {
  verdict: NaverMatchVerdict;
  reason: string;
}

// 같은 도로 위에서 건물번호가 이만큼까지 다르면 같은 가게일 수 있다고 본다.
// (인허가 데이터와 네이버가 옆 번지나 대표 번지를 서로 다르게 쓰는 경우: 196 / 198, 835 / 837)
const NEAR_BUILDING_NO = 10;

// 같은 주소에서 이 단어만 겹치는 건 같은 가게 근거로 보지 않는다 (zeropay-official의 일반 단어 목록에 더해).
const EXTRA_GENERIC_WORDS = ["도넛", "도너츠", "버거", "노래", "노래방", "꼬치", "와인", "펍", "바"];

/** 서울 밖 주소 비교용: 시/군/구부터 도로명 + 건물번호까지만 남긴다. */
function looseAddressKey(addr: string): string | null {
  const s = addr
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^가-힣A-Za-z0-9\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const m = s.match(/([가-힣]+(?:시|군|구))\s(?:[가-힣]+(?:구|읍|면)\s)?([가-힣A-Za-z0-9]+(?:대로|로|길)(?:\s?\d+[가-힣]?길)?)\s?(\d+(?:-\d+)?)/);
  if (!m) return null;
  return `${m[1]} ${m[2].replace(/\s/g, "")} ${m[3]}`;
}

export function judgeNaverPlaceMatch(
  dbPlace: { name: string; address: string },
  naverPlace: { name: string; address: string }
): NaverMatchResult {
  const dbName = (dbPlace.name ?? "").trim();
  const naverName = (naverPlace.name ?? "").trim();
  if (!dbName || !naverName) {
    return { verdict: "unknown", reason: "비교할 상호가 없음" };
  }
  if (!naverPlace.address?.trim()) {
    return { verdict: "unknown", reason: "네이버 주소가 없음" };
  }
  if (!dbPlace.address?.trim()) {
    return { verdict: "unknown", reason: "DB 주소가 없음" };
  }

  const strongName = validateBrandMatch(dbName, naverName) || isSameFullName(dbName, naverName);
  const relatedName = strongName || sharesDistinctiveName(dbName, naverName, EXTRA_GENERIC_WORDS);

  const dbAddr = parseRoadAddress(dbPlace.address);
  const naverAddr = parseRoadAddress(naverPlace.address);
  const dbRoad = dbAddr ? { gu: dbAddr.gu, road: dbAddr.road } : parseRoadName(dbPlace.address);
  const naverRoad = naverAddr ? { gu: naverAddr.gu, road: naverAddr.road } : parseRoadName(naverPlace.address);

  // 서울 밖 식당 (주소 해석기가 서울만 다룬다): 시/군/구 + 도로명 + 건물번호를 그대로 비교한다.
  if (!dbRoad) {
    const a = looseAddressKey(dbPlace.address);
    const b = looseAddressKey(naverPlace.address);
    if (!a || !b) return { verdict: "unknown", reason: `DB 주소를 해석할 수 없음 ('${dbPlace.address}')` };
    if (a !== b) return { verdict: "mismatch", reason: `주소가 다름 (네이버 '${naverPlace.address}')` };
    return relatedName
      ? { verdict: "match", reason: "상호와 주소가 같음" }
      : { verdict: "mismatch", reason: `같은 주소의 다른 가게 (네이버 '${naverName}')` };
  }
  if (!naverRoad) {
    return { verdict: "mismatch", reason: `다른 지역 주소 (네이버 '${naverPlace.address}')` };
  }
  if (dbRoad.gu !== naverRoad.gu) {
    return { verdict: "mismatch", reason: `지역이 다름 (DB ${dbRoad.gu}, 네이버 ${naverRoad.gu})` };
  }

  if (dbAddr && naverAddr) {
    if (isSameRoadAddress(dbAddr, naverAddr)) {
      return relatedName
        ? { verdict: "match", reason: "상호와 주소가 같음" }
        : { verdict: "mismatch", reason: `같은 주소의 다른 가게 (네이버 '${naverName}')` };
    }
    if (
      dbAddr.road === naverAddr.road &&
      Math.abs(dbAddr.mainNo - naverAddr.mainNo) <= NEAR_BUILDING_NO &&
      isSameFullName(dbName, naverName)
    ) {
      return { verdict: "match", reason: "같은 도로의 가까운 번지, 상호가 지점명까지 같음" };
    }
    return { verdict: "mismatch", reason: `주소가 다름 (네이버 '${naverPlace.address}')` };
  }

  // 한쪽이 건물번호 없이 도로명만 있는 경우: 도로명이 같고 지점명까지 거의 같은 이름일 때만 같은 가게로 본다.
  if (dbRoad.road === naverRoad.road && isSameFullName(dbName, naverName)) {
    return { verdict: "match", reason: "도로명과 지점명까지 같음 (건물번호 없음)" };
  }
  return { verdict: "unknown", reason: "건물번호가 없어 같은 가게인지 확정할 수 없음" };
}
