import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth-server";
import { recommendLunch } from "@/lib/gemini";
import { getRecentRestaurantNames } from "@/lib/meal-log-server";
import type { RestaurantSummary } from "@/types";

// 참가자 한 명당 최근 방문 이력을 이 개수까지만 가져온다(기본 8개보다 살짝 좁힘) - 인원이
// 여러 명이면 합쳤을 때 프롬프트가 너무 길어지는 걸 막기 위함. 합친 뒤 전체 상한은
// MAX_TOTAL_RECENT_NAMES로 한 번 더 자른다.
const RECENT_NAMES_PER_PERSON = 5;
const MAX_TOTAL_RECENT_NAMES = 15;
// 초대 인원이 지나치게 많아지는 걸 막는 안전장치(사고로 회사 전체를 초대하는 경우 등).
const MAX_PARTICIPANTS = 15;

// POST /api/recommend
// body: { companyCode, candidates: RestaurantSummary[], excludeIds?: string[], participantNicknameIds?: string[] }
//
// "오늘 뭐 먹지?" 룰렛 기능. 클라이언트가 지금 화면(조건 선택 후 걸러진)에 보이는 식당 목록을
// 그대로 candidates로 보내준다 - 서버가 다시 Firestore 전체를 읽을 필요가 없고, 사용자가 지금
// 보고 있는 후보 중에서만 추천되는 게 UX상 맞다.
//
// 2026-08-08 신규: 룰렛에 친구를 초대해서 같이 돌릴 수 있게 되면서, participantNicknameIds가
// 있으면 그 사람들의 최근 방문 이력도 같이 모아서 Gemini에게 "이 사람들 전체가 최근에 다녀온
// 곳"으로 넘긴다 - 나 혼자만 회피하는 게 아니라 초대된 모두를 고려해서 추천하라는 의도.
//
// 2026-08-07 문서(기획/서비스아이디어_초안.md)에 기록된 대로, 회사 오피스 네트워크에서
// generativelanguage.googleapis.com으로의 API키 기반 direct REST 호출이 막혀 있을 수 있다
// (Vercel 배포 환경에서는 정상 동작 확인됨). 그래서 Gemini 호출이 실패하면(네트워크 차단,
// 타임아웃, 응답 파싱 실패 등 무엇이든) 조용히 랜덤 추천으로 폴백한다 - "오늘 뭐 먹지?"는
// 실패해도 사용자에게 항상 뭔가는 골라줘야 하는 기능이라, 에러를 그대로 보여주는 것보다
// 랜덤 픽으로 대체하는 쪽이 낫다고 판단.
export async function POST(request: NextRequest) {
  let body: {
    companyCode?: string;
    candidates?: RestaurantSummary[];
    excludeIds?: string[];
    participantNicknameIds?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const { companyCode, candidates, excludeIds, participantNicknameIds } = body;
  if (!companyCode || !Array.isArray(candidates) || candidates.length === 0) {
    return NextResponse.json(
      { error: "companyCode, candidates(1개 이상)가 필요합니다." },
      { status: 400 }
    );
  }

  const sessionToken = cookies().get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(sessionToken);
  if (!session || session.companyCode !== companyCode) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const excludeSet = new Set(excludeIds ?? []);
  const pool = candidates.filter((c) => !excludeSet.has(c.id));

  if (pool.length === 0) {
    return NextResponse.json(
      { error: "추천할 후보가 남아있지 않아요. 필터를 조금 넓혀볼까요?" },
      { status: 400 }
    );
  }

  // 나(session.nicknameId) 자신은 초대 목록에 중복으로 들어와도 한 번만 세도록 Set으로 합친다.
  const participantIds = Array.from(
    new Set([session.nicknameId, ...(participantNicknameIds ?? [])])
  ).slice(0, MAX_PARTICIPANTS);
  const participantCount = participantIds.length;

  // 후보가 1개뿐이면 Gemini까지 부를 필요 없이 그 하나를 바로 돌려준다(비용/시간 절약).
  if (pool.length === 1) {
    return NextResponse.json({
      restaurant: pool[0],
      reason:
        participantCount > 1
          ? `지금 조건에 맞는 곳이 여기 하나뿐이에요! ${participantCount}명이 다 같이 가면 되겠네요.`
          : "지금 조건에 맞는 곳이 여기 하나뿐이에요!",
      isFallback: false,
    });
  }

  // 참가자 전원(나 포함)의 최근 방문 이력을 병렬로 모아서 하나로 합친다 - 한 명이 실패해도
  // (예: 아직 밥 먹은 기록이 없는 신규 유저) 나머지는 계속 진행한다.
  const recentNameLists = await Promise.all(
    participantIds.map((nicknameId) =>
      getRecentRestaurantNames(companyCode, nicknameId, 14, RECENT_NAMES_PER_PERSON).catch(() => [])
    )
  );
  const recentRestaurantNames = Array.from(new Set(recentNameLists.flat())).slice(
    0,
    MAX_TOTAL_RECENT_NAMES
  );

  try {
    const raw = await recommendLunch({ recentRestaurantNames, candidates: pool, participantCount });
    const parsed = parseRecommendationResponse(raw);
    if (!parsed) throw new Error("Gemini 응답을 파싱하지 못했습니다.");

    const matched = matchRestaurantByName(pool, parsed.restaurantName);
    if (!matched) throw new Error(`Gemini가 추천한 "${parsed.restaurantName}"을 후보에서 못 찾았습니다.`);

    return NextResponse.json({
      restaurant: matched,
      reason: parsed.reason,
      isFallback: false,
    });
  } catch (err) {
    console.error("[api/recommend] Gemini 추천 실패, 랜덤으로 대체:", err);
    const randomPick = pool[Math.floor(Math.random() * pool.length)];
    return NextResponse.json({
      restaurant: randomPick,
      reason: "AI 추천을 잠깐 불러오지 못해서 랜덤으로 골라봤어요! 🎲",
      isFallback: true,
    });
  }
}

// Gemini가 ```json 코드블록으로 감싸서 답하는 경우가 있어 벗겨내고 파싱한다.
function parseRecommendationResponse(raw: string): { restaurantName: string; reason: string } | null {
  try {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned) as { restaurantName?: unknown; reason?: unknown };
    if (typeof parsed.restaurantName !== "string" || typeof parsed.reason !== "string") return null;
    if (!parsed.restaurantName.trim() || !parsed.reason.trim()) return null;
    return { restaurantName: parsed.restaurantName.trim(), reason: parsed.reason.trim() };
  } catch {
    return null;
  }
}

// 정확히 이름이 같은 후보를 먼저 찾고, 없으면(모델이 살짝 다르게 표기한 경우) 서로 포함관계인
// 이름을 찾는다. 그래도 없으면 null - 호출부가 랜덤 폴백으로 처리한다.
function matchRestaurantByName(pool: RestaurantSummary[], name: string): RestaurantSummary | null {
  const normalized = name.replace(/\s/g, "").toLowerCase();
  const exact = pool.find((r) => r.name.replace(/\s/g, "").toLowerCase() === normalized);
  if (exact) return exact;

  const partial = pool.find((r) => {
    const rName = r.name.replace(/\s/g, "").toLowerCase();
    return rName.includes(normalized) || normalized.includes(rName);
  });
  return partial ?? null;
}
