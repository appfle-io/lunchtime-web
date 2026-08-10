// 2026-08-09 신규: "가맹점 정보 수정요청" 기능의 요청 유형/입력 필드 정의. Firestore를 쓰지 않는
// 순수 타입/라벨 모듈이라 클라이언트 컴포넌트(EditRequestModal.tsx 등)에서도 바로 import해서 쓴다.
//
// 자유 텍스트 한 칸이 아니라 "유형을 먼저 고르고, 그 유형에 맞는 값을 입력받는" 구조로 설계했다
// (자유 텍스트만 있으면 사용자가 뭘 어떻게 써야 할지 몰라 애매한 요청이 많아지고, 관리자도 매번
// 글을 읽고 해석해야 해서 처리가 느려진다 - 유형별 필드는 관리자 페이지에서 그대로 폼에 채워
// 넣어 바로 반영하기도 쉽다). 다만 어떤 유형에도 안 맞는 사례를 위해 "기타" + 모든 유형에 공통으로
// 붙일 수 있는 note(자유 텍스트, 선택)를 같이 둔다.
export type EditRequestType =
  | "phone"
  | "businessHours"
  | "category"
  | "menu"
  | "closedOrMoved"
  | "zeroPay"
  | "other";

export const EDIT_REQUEST_TYPES: EditRequestType[] = [
  "phone",
  "businessHours",
  "category",
  "menu",
  "closedOrMoved",
  "zeroPay",
  "other",
];

export const EDIT_REQUEST_TYPE_LABELS: Record<EditRequestType, string> = {
  phone: "전화번호가 달라요",
  businessHours: "영업시간이 달라요",
  category: "카테고리가 달라요",
  menu: "메뉴/가격이 달라요",
  closedOrMoved: "폐업했어요 / 이전했어요",
  zeroPay: "제로페이(비플식권) 여부가 달라요",
  other: "기타",
};

// 유형별로 반드시 채워야 하는 값이 있는지(있으면 그 값이 비어있을 때 제출을 막는다).
// note(자유 텍스트)는 모든 유형에서 선택 입력이라 여기 포함하지 않는다.
export const EDIT_REQUEST_REQUIRES_VALUE: Record<EditRequestType, boolean> = {
  phone: true,
  businessHours: true,
  category: true,
  menu: true,
  closedOrMoved: false, // 체크만 하면 되고, 이전한 경우에만 새 주소를 추가로 입력
  zeroPay: true,
  other: false, // note만으로 충분
};

export interface EditRequestPayload {
  // type === "phone"
  phone?: string | null;
  // type === "businessHours"
  businessHours?: string | null;
  // type === "category"
  categoryLabel?: string | null;
  // type === "menu"
  menuName?: string | null;
  menuNewPrice?: string | null;
  menuNewDescription?: string | null;
  // type === "closedOrMoved"
  isClosed?: boolean;
  newAddress?: string | null;
  // type === "zeroPay"
  isZeroPay?: boolean;
  // 모든 유형에 공통으로 붙일 수 있는 선택적 부가설명.
  note?: string | null;
}

// 요청 유형+값을 관리자/요청자 화면에서 한 줄로 보여줄 때 쓰는 요약 문구.
export function summarizeEditRequest(type: EditRequestType, payload: EditRequestPayload): string {
  switch (type) {
    case "phone":
      return `전화번호 → ${payload.phone ?? "-"}`;
    case "businessHours":
      return `영업시간 → ${payload.businessHours ?? "-"}`;
    case "category":
      return `카테고리 → ${payload.categoryLabel ?? "-"}`;
    case "menu":
      return `메뉴 "${payload.menuName ?? "-"}" → ${payload.menuNewPrice ?? "가격 미입력"}${
        payload.menuNewDescription ? ` (${payload.menuNewDescription})` : ""
      }`;
    case "closedOrMoved":
      return payload.isClosed
        ? "폐업했어요"
        : `이전했어요${payload.newAddress ? ` → ${payload.newAddress}` : ""}`;
    case "zeroPay":
      return `제로페이 → ${payload.isZeroPay ? "가능" : "불가능"}`;
    case "other":
      return payload.note ?? "기타 문의";
  }
}
