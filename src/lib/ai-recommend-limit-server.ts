import { db } from "@/lib/firebase";

// 2026-08-12 신규: "오늘 뭐 먹지?"(recommendLunch)는 이 프로젝트에서 실제로 Gemini를 호출하는
// 유일한 기능이다(gemini.ts에 summarizeReviews도 있지만 어디서도 호출되지 않는 죽은 코드 -
// review-server.ts/api/reviews/route.ts 확인 결과 미사용). Gemini 호출 1번마다 비용/쿼터가
// 드니까, 사용자 1명이 하루에 실제로 Gemini를 부를 수 있는 횟수를 제한한다.
//
// 요구사항: 한도를 넘겨도 기능 자체가 막히거나 "한도 초과"라는 티가 나면 안 되고, 그냥 조용히
// 랜덤 추천으로 넘어가야 한다(사용자에게 몇 번 남았는지도 노출 안 함) - 그래서 이 파일은 "지금
// AI를 불러도 되는지"만 boolean으로 알려주고, 실제 랜덤 폴백 처리는 호출부(api/recommend/route.ts)가
// 원래 갖고 있던 "Gemini 실패 시 랜덤" 로직을 그대로 재사용한다 - 사용자 입장에서는 어쩌다
// Gemini가 살짝 삐끗한 것처럼 보일 뿐, 한도 때문인지 구분할 방법이 없다.
export const DAILY_AI_RECOMMEND_LIMIT = 10;

function usageCollection(companyCode: string) {
  return db.collection("companies").doc(companyCode).collection("aiRecommendUsage");
}

// 매일 자정(KST)에 리셋되도록 날짜 키를 KST 기준으로 만든다. 서버(Vercel)는 UTC로 돌아가므로
// 서버 로컬 타임존에 의존하면 리셋 시점이 오전 9시로 밀린다(weather.ts의 KST 변환과 동일한 트릭).
function kstDateKey(date: Date): string {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kst.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

// 오늘 이 사용자가 이미 한도를 다 썼으면 false(=AI 호출 금지, 랜덤으로 진행)를 반환하고 카운트는
// 건드리지 않는다. 아직 한도가 남았으면 카운트를 1 늘리고 true를 반환한다(=이번 호출로 AI 쿼터
// 하나를 "예약"해두는 것 - Gemini 응답이 나중에 실패하더라도 이미 호출은 시도했으니 그대로 소진
// 처리한다). 트랜잭션으로 처리해서 같은 사람이 거의 동시에 여러 번 눌러도 한도를 넘겨서
// 카운트되는 레이스가 없게 한다.
export async function tryConsumeAiRecommendQuota(
  companyCode: string,
  nicknameId: string
): Promise<boolean> {
  const ref = usageCollection(companyCode).doc(`${nicknameId}_${kstDateKey(new Date())}`);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = (snap.data()?.count as number | undefined) ?? 0;

    if (current >= DAILY_AI_RECOMMEND_LIMIT) {
      return false;
    }

    tx.set(ref, { count: current + 1, updatedAt: new Date().toISOString() }, { merge: true });
    return true;
  });
}
