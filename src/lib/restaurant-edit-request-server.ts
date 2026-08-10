import { db } from "@/lib/firebase";
import type { EditRequestType, EditRequestPayload } from "@/lib/restaurant-edit-request";

// 2026-08-09 신규(구조 변경): 가맹점 정보 수정요청. 처음엔 식당 하위 서브컬렉션
// (companies/{code}/restaurants/{restaurantId}/editRequests/{id})으로 만들었는데, 관리자
// 페이지에서 "이 회사의 모든 대기중 요청"을 한 번에 보려면 모든 식당을 가로질러 훑어야 해서
// collectionGroup 쿼리를 썼다가, collectionGroup은 필터가 하나뿐이어도(등호 하나) Firestore가
// 별도의 "컬렉션 그룹" 스코프 인덱스를 요구한다는 걸 실사용 중 발견했다(콘솔에서 수동으로 인덱스를
// 만들어야 함 - FAILED_PRECONDITION 에러 2번 재현). 인덱스를 만드는 대신 구조를 바꿔서 아예
// collectionGroup을 안 쓰게 했다: 이제 companies/{code}/editRequests/{id}라는 회사 최상위의
// "평평한" 컬렉션 하나에 전부 저장한다(restaurantId 필드로 어느 식당 것인지 구분). 이러면:
// - "이 식당의 요청 목록" 조회는 이 컬렉션에서 restaurantId 등호 필터 하나만 쓰면 되고
// - "이 회사의 대기중 요청 전체" 조회는 같은 컬렉션에서 status 등호 필터 하나만 쓰면 된다
// 둘 다 일반 컬렉션의 단일 등호 필터라 자동 인덱스로 바로 동작한다(복합/컬렉션그룹 인덱스 불필요).
export interface RestaurantEditRequest {
  id: string;
  restaurantId: string;
  restaurantName: string;
  type: EditRequestType;
  payload: EditRequestPayload;
  status: "pending" | "resolved" | "rejected";
  requestedByNicknameId: string;
  requestedByNickname: string;
  createdAt: string;
  resolvedAt?: string | null;
  resolvedByNickname?: string | null;
  adminNote?: string | null;
}

function editRequestsRef(companyCode: string) {
  return db.collection("companies").doc(companyCode).collection("editRequests");
}

export async function createEditRequest(
  companyCode: string,
  restaurantId: string,
  restaurantName: string,
  requestedByNicknameId: string,
  requestedByNickname: string,
  type: EditRequestType,
  payload: EditRequestPayload
): Promise<RestaurantEditRequest> {
  const data = {
    restaurantId,
    restaurantName,
    type,
    payload,
    status: "pending" as const,
    requestedByNicknameId,
    requestedByNickname,
    createdAt: new Date().toISOString(),
  };
  const ref = await editRequestsRef(companyCode).add(data);
  return { id: ref.id, ...data };
}

// 식당 상세모달에서 "내가 보낸 요청" 상태를 보여주기 위한 조회 - 그 식당의 요청 전체(최신순).
// restaurantId 등호 필터 하나뿐이라 일반 컬렉션 자동 인덱스로 바로 동작한다.
export async function listEditRequestsForRestaurant(
  companyCode: string,
  restaurantId: string
): Promise<RestaurantEditRequest[]> {
  const snap = await editRequestsRef(companyCode).where("restaurantId", "==", restaurantId).get();
  return snap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<RestaurantEditRequest, "id">) }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

// 관리자가 승인/거절 처리한 뒤 요청자에게 알림을 보낼 때, 이미 status가 바뀌기 전에 그 요청의
// 원본 내용(누가 보냈는지 등)을 확인하기 위한 단건 조회.
export async function getEditRequest(
  companyCode: string,
  requestId: string
): Promise<RestaurantEditRequest | null> {
  const doc = await editRequestsRef(companyCode).doc(requestId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...(doc.data() as Omit<RestaurantEditRequest, "id">) };
}

// 관리자 페이지용 - 이 회사의 대기중인 요청 전체(최신순). status 등호 필터 하나뿐이라
// 일반 컬렉션 자동 인덱스로 바로 동작한다(orderBy 없이 조회하고 정렬은 메모리에서 - 프로젝트 표준).
export async function listPendingEditRequests(companyCode: string): Promise<RestaurantEditRequest[]> {
  const snap = await editRequestsRef(companyCode).where("status", "==", "pending").get();
  return snap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<RestaurantEditRequest, "id">) }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function resolveEditRequest(
  companyCode: string,
  requestId: string,
  status: "resolved" | "rejected",
  resolvedByNickname: string,
  adminNote?: string | null
): Promise<void> {
  await editRequestsRef(companyCode)
    .doc(requestId)
    .set(
      {
        status,
        resolvedAt: new Date().toISOString(),
        resolvedByNickname,
        adminNote: adminNote ?? null,
      },
      { merge: true }
    );
}
