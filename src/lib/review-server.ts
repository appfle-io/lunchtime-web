import { db } from "@/lib/firebase";
import type { ReviewSummary } from "@/types";

// companies/{code}/restaurants/{restaurantId}/reviews 서브컬렉션 헬퍼.
export async function listReviews(companyCode: string, restaurantId: string): Promise<ReviewSummary[]> {
  const snapshot = await db
    .collection("companies")
    .doc(companyCode)
    .collection("restaurants")
    .doc(restaurantId)
    .collection("reviews")
    .orderBy("createdAt", "desc")
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      authorNickname: data.authorNickname,
      content: data.content,
      rating: data.rating ?? null,
      createdAt: data.createdAt,
    };
  });
}

// authorNickname은 호출하는 쪽(API route)에서 세션으로 검증한 값을 넘겨받는다 - 클라이언트가
// 임의로 다른 사람 이름을 대신 넣지 못하게 하기 위함.
//
// 2026-08-11 수정(firestore 과잉사용 분석 반영 - RestaurantDetail 재오픈 캐시 개선): 댓글이
// 새로 달렸다는 걸 나중에 가볍게(식당 문서 1건만 읍어서) 감지할 수 있도록, 댓글 추가와 함께
// 식당 문서의 lastActivityAt 필드도 같은 시각으로 갱신해둔다. zeropay-server.ts의
// setZeroPayVote도 투표가 있을 때마다 이 필드를 갱신하므로, "이 필드가 마지막으로 본 값과
// 같은가"만 확인하면 reviews/제로페이 투표 둘 중 뭐든 변경이 있었는지 한 번에 알 수 있다
// (RestaurantDetail.tsx의 캐시 로직 참고). 반환값에 이 시각을 같이 담아서, 방금 내가 남긴
// 댓글로 인한 변경은 클라이언트가 별도 확인 없이 캐시에 바로 반영할 수 있게 한다.
export async function addReview(
  companyCode: string,
  restaurantId: string,
  authorNickname: string,
  content: string
): Promise<{ review: ReviewSummary; lastActivityAt: string }> {
  const createdAt = new Date().toISOString();
  const restaurantDocRef = db.collection("companies").doc(companyCode).collection("restaurants").doc(restaurantId);

  const docRef = await restaurantDocRef.collection("reviews").add({ authorNickname, content, createdAt });
  await restaurantDocRef.set({ lastActivityAt: createdAt }, { merge: true });

  return {
    review: { id: docRef.id, authorNickname, content, createdAt, rating: null },
    lastActivityAt: createdAt,
  };
}
