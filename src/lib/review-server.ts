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
export async function addReview(
  companyCode: string,
  restaurantId: string,
  authorNickname: string,
  content: string
): Promise<ReviewSummary> {
  const createdAt = new Date().toISOString();
  const docRef = await db
    .collection("companies")
    .doc(companyCode)
    .collection("restaurants")
    .doc(restaurantId)
    .collection("reviews")
    .add({ authorNickname, content, createdAt });

  return { id: docRef.id, authorNickname, content, createdAt, rating: null };
}
