import { db } from "@/lib/firebase";

// companies/{code}/users/{nicknameId}/favorites/{restaurantId} 서브컬렉션으로 관리.
// 문서 존재 여부 자체가 "즐겨찾기 여부"라서, 별도 boolean 필드 없이 문서만 만들면 충분하다.
export async function listFavoriteIds(companyCode: string, nicknameId: string): Promise<string[]> {
  const snapshot = await db
    .collection("companies")
    .doc(companyCode)
    .collection("users")
    .doc(nicknameId)
    .collection("favorites")
    .select()
    .get();

  return snapshot.docs.map((doc) => doc.id);
}

export async function setFavorite(
  companyCode: string,
  nicknameId: string,
  restaurantId: string,
  isFavorite: boolean
): Promise<void> {
  const ref = db
    .collection("companies")
    .doc(companyCode)
    .collection("users")
    .doc(nicknameId)
    .collection("favorites")
    .doc(restaurantId);

  if (isFavorite) {
    await ref.set({ createdAt: new Date().toISOString() });
  } else {
    await ref.delete();
  }
}
