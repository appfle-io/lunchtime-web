import { db } from "@/lib/firebase";

// 2026-08-06 신규: "제로페이 되나요?" 사내 투표 기능 - 사용자 제안으로, 공공데이터/크롤링 대신
// 엄지척(👍 됨)/거꾸로엄지척(👎 재확인 필요)으로 실사용자들이 직접 확정해가는 방식을 채택.
//
// - companies/{code}/restaurants/{id}/zeroPayVotes/{nicknameId} : 사람마다 최신 투표 1건만 유지.
//   같은 버튼을 다시 누르면 취소(토글), 반대 버튼을 누르면 투표를 바꾼다.
// - 누적 엄지척이 ZERO_PAY_UP_THRESHOLD 이상이면 "제로페이 됨"으로 인식(effectiveIsZeroPay).
// - 원래 isZeroPay:true로 등록되어 있던(또는 엄지척으로 확정된) 곳도, 최근
//   RECENT_DOWN_WINDOW_DAYS 이내 거꾸로엄지척이 ZERO_PAY_NEEDS_REVIEW_THRESHOLD 이상이면
//   "확인 필요" 상태(needsReview)로 표시한다 - 실제로 제로페이가 끊겼거나 잘못 등록된 경우를
//   빠르게 잡아내기 위함.
// - 매 투표마다 votes 서브컬렉션을 전부 읽어서 메모리에서 집계한다(popular-server.ts와 동일한
//   방식) - 토이 프로젝트 규모(식당 하나당 투표 수십 건 이하)에서는 충분하고, 복합 인덱스가
//   필요 없다는 장점도 있다.
export const ZERO_PAY_UP_THRESHOLD = 3;
const RECENT_DOWN_WINDOW_DAYS = 14;
export const ZERO_PAY_NEEDS_REVIEW_THRESHOLD = 2;

export type ZeroPayVoteValue = "up" | "down";

export interface ZeroPayStatus {
  upCount: number;
  downCount: number;
  needsReview: boolean;
  myVote: ZeroPayVoteValue | null;
  effectiveIsZeroPay: boolean;
}

function restaurantRef(companyCode: string, restaurantId: string) {
  return db.collection("companies").doc(companyCode).collection("restaurants").doc(restaurantId);
}

function votesRef(companyCode: string, restaurantId: string) {
  return restaurantRef(companyCode, restaurantId).collection("zeroPayVotes");
}

export async function getZeroPayStatus(
  companyCode: string,
  restaurantId: string,
  nicknameId?: string | null
): Promise<ZeroPayStatus> {
  const [restaurantSnap, votesSnap] = await Promise.all([
    restaurantRef(companyCode, restaurantId).get(),
    votesRef(companyCode, restaurantId).get(),
  ]);

  const registeredIsZeroPay = Boolean(restaurantSnap.data()?.isZeroPay);
  const recentCutoffMs = Date.now() - RECENT_DOWN_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  let upCount = 0;
  let downCount = 0;
  let recentDownCount = 0;
  let myVote: ZeroPayVoteValue | null = null;

  for (const doc of votesSnap.docs) {
    const data = doc.data();
    if (data.vote === "up") {
      upCount += 1;
    } else if (data.vote === "down") {
      downCount += 1;
      const createdAtMs = new Date(data.createdAt).getTime();
      if (!Number.isNaN(createdAtMs) && createdAtMs >= recentCutoffMs) recentDownCount += 1;
    }
    if (nicknameId && doc.id === nicknameId) {
      myVote = data.vote === "up" || data.vote === "down" ? data.vote : null;
    }
  }

  const effectiveIsZeroPay = registeredIsZeroPay || upCount >= ZERO_PAY_UP_THRESHOLD;
  const needsReview = effectiveIsZeroPay && recentDownCount >= ZERO_PAY_NEEDS_REVIEW_THRESHOLD;

  return { upCount, downCount, needsReview, myVote, effectiveIsZeroPay };
}

// 같은 버튼을 다시 누르면 투표를 취소(토글)하고, 다른 버튼을 누르면 투표를 바꾼다.
// 계산된 결과를 restaurants 문서의 isZeroPay / isZeroPayNeedsReview 필드에도 그대로 반영해둔다 -
// listRestaurants(지도/리스트 전체 조회)는 매번 votes 서브컬렉션까지 읽지 않고 이 캐시된 필드만
// 쓰기 때문에, 투표가 일어난 시점에 미리 계산해서 저장해둬야 지도/리스트에도 바로 반영된다.
export async function setZeroPayVote(
  companyCode: string,
  restaurantId: string,
  nicknameId: string,
  vote: ZeroPayVoteValue
): Promise<ZeroPayStatus> {
  const voteRef = votesRef(companyCode, restaurantId).doc(nicknameId);
  const existing = await voteRef.get();

  if (existing.exists && existing.data()?.vote === vote) {
    await voteRef.delete();
  } else {
    await voteRef.set({ vote, createdAt: new Date().toISOString() });
  }

  const status = await getZeroPayStatus(companyCode, restaurantId, nicknameId);

  await restaurantRef(companyCode, restaurantId).set(
    { isZeroPay: status.effectiveIsZeroPay, isZeroPayNeedsReview: status.needsReview },
    { merge: true }
  );

  return status;
}
