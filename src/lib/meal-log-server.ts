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

// "YYYY-MM" 다음 달의 "YYYY-MM-01"을 계산한다 (range 쿼리의 배타적 상한으로 씀).
function nextMonthStart(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const nextMonth = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? y + 1 : y;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
}

// 2026-08-11 수정(firestore 과잉사용 분석 반영): 예전엔 전체 컬렉션을 다 읍고 JS에서
// date.startsWith(yearMonth)로 걸러냈다 - 개인 기록이 누적될수록(달을 이동할 때마다 매번
// 전체를 다시 읍는 구조라) 비용이 계속 커지는 문제가 있었다. date 필드가 "YYYY-MM-DD" 형식의
// 사전순 정렬 가능한 문자열이라는 걸 이용해서, [이 달 1일, 다음 달 1일) range 쿼리로 서버에서
// 바로 그 달 것만 좁혀서 읍는다(단일 필드 range 쿼리라 복합 인덱스도 필요 없음).
export async function listMealLogsForMonth(
  companyCode: string,
  nicknameId: string,
  yearMonth: string
): Promise<MealLogEntry[]> {
  const monthStart = `${yearMonth}-01`;
  const monthEnd = nextMonthStart(yearMonth);
  const snapshot = await mealLogsRef(companyCode, nicknameId)
    .where("date", ">=", monthStart)
    .where("date", "<", monthEnd)
    .get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() } as MealLogEntry))
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

// 2026-08-08 신규: "오늘 뭐 먹지?" 룰렛 기능이 Gemini에게 "최근에 다녀온 곳은 피해줘"라고
// 알려주기 위해 최근 방문 식당 이름 목록이 필요하다.
// 2026-08-11 수정(firestore 과잉사용 분석 반영): 예전엔 mealLogs 전체를 가져와 메모리에서
// date >= cutoffStr로 걸러냈다 - 룰렛 호출 시 참가자마다(최대 15명) 병렬로 호출되는 함수라,
// "전체 스캔"이 참가자 수만큼 동시에 곱해지는 게 가장 부담이 큰 지점이었다. date 필드가
// 사전순 정렬 가능한 문자열이라는 걸 이용해서 where("date", ">=", cutoffStr) range 쿼리로
// 서버에서 바로 최근 daysBack일 것만 좁혀서 읍는다(단일 필드 range라 복합 인덱스 불필요).
export async function getRecentRestaurantNames(
  companyCode: string,
  nicknameId: string,
  daysBack = 14,
  limit = 8
): Promise<string[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const snapshot = await mealLogsRef(companyCode, nicknameId).where("date", ">=", cutoffStr).get();

  const entries = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() } as MealLogEntry))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.restaurantName) continue;
    if (names.includes(entry.restaurantName)) continue;
    names.push(entry.restaurantName);
    if (names.length >= limit) break;
  }
  return names;
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
