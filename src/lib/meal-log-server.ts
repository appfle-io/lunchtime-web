import { db } from "@/lib/firebase";

// 2026-08-06 저녁 신규: "내가 언제 어디서 밥 먹었는지" 개인 기록(캘린더뷰) 기능.
// companies/{code}/users/{nicknameId}/mealLogs/{autoId} - 하루에 여러 건도 기록할 수 있다
// (회식처럼 하루에 두 끼 이상 기록하는 경우가 있어서, 문서ID를 날짜로 고정하지 않고 자동 id를
// 쓴다). 대신 date 필드로 날짜를 구분하고, 조회는 이 필드로 필터링한다.
// restaurantId가 있으면 기존 restaurants 목록에서 고른 것이고, 없으면 직접 입력한 이름이라는 뜻.
// restaurantName/category는 항상 같이 저장해두는 스냅샷이라, 나중에 그 식당이 목록에서 지워지거나
// 정보가 바뀌어도 그날 먹었던 기록 자체는 그대로 남는다.
export interface MealLogEntry {
  id: string;
  date: string; // "YYYY-MM-DD"
  restaurantId: string | null;
  restaurantName: string;
  category: string | null;
  memo: string;
  createdAt: string;
  updatedAt: string;
}

function mealLogsRef(companyCode: string, nicknameId: string) {
  return db
    .collection("companies")
    .doc(companyCode)
    .collection("users")
    .doc(nicknameId)
    .collection("mealLogs");
}

// 이 사용자의 특정 월(yearMonth: "YYYY-MM") 기록 전체(하루에 여러 건 포함). 개인 기록이라
// 규모가 작아서(길게 써도 1년에 수백 건 수준) 컬렉션 전체를 가져와 날짜 접두어로 걸러내는
// 방식을 쓴다 - 이 프로젝트의 다른 목록 조회들과 같은 "orderBy/복합인덱스 없이 메모리에서
// 필터링" 패턴을 그대로 따른다.
export async function listMealLogsForMonth(
  companyCode: string,
  nicknameId: string,
  yearMonth: string
): Promise<MealLogEntry[]> {
  const snapshot = await mealLogsRef(companyCode, nicknameId).get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() } as MealLogEntry))
    .filter((entry) => entry.date.startsWith(yearMonth))
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
}

// 특정 하루의 기록 전체(여러 건일 수 있음). 식당 상세모달의 "오늘 여기서 먹었어요" 버튼이
// 오늘 이미 뭘 기록했는지 보여줄 때 쓴다.
export async function listMealLogsForDate(
  companyCode: string,
  nicknameId: string,
  date: string
): Promise<MealLogEntry[]> {
  const snapshot = await mealLogsRef(companyCode, nicknameId).where("date", "==", date).get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() } as MealLogEntry))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// 새 기록 추가(하루에 여러 번 호출해도 각각 별도 건으로 쌓인다 - 회식 등으로 하루 여러 끼 기록 가능).
export async function addMealLog(
  companyCode: string,
  nicknameId: string,
  entry: {
    date: string;
    restaurantId?: string | null;
    restaurantName: string;
    category?: string | null;
    memo?: string;
  }
): Promise<MealLogEntry> {
  const now = new Date().toISOString();
  const data = {
    date: entry.date,
    restaurantId: entry.restaurantId ?? null,
    restaurantName: entry.restaurantName,
    category: entry.category ?? null,
    memo: entry.memo ?? "",
    createdAt: now,
    updatedAt: now,
  };
  const ref = await mealLogsRef(companyCode, nicknameId).add(data);
  return { id: ref.id, ...data };
}

// 기존 기록 한 건 수정(캘린더뷰에서 날짜를 클릭해 특정 기록을 고쳤을 때).
export async function updateMealLog(
  companyCode: string,
  nicknameId: string,
  id: string,
  updates: {
    restaurantId?: string | null;
    restaurantName?: string;
    category?: string | null;
    memo?: string;
  }
): Promise<void> {
  await mealLogsRef(companyCode, nicknameId)
    .doc(id)
    .set({ ...updates, updatedAt: new Date().toISOString() }, { merge: true });
}

export async function deleteMealLog(
  companyCode: string,
  nicknameId: string,
  id: string
): Promise<void> {
  await mealLogsRef(companyCode, nicknameId).doc(id).delete();
}
