import { NextResponse } from "next/server";
import { getCompanyByCode } from "@/lib/company-server";
import { addRestaurantFromCandidate } from "@/lib/restaurant-server";
import { db } from "@/lib/firebase";

// POST /api/restaurants
//
// "직접 추가" 2단계 플로우의 2단계. 사용자가 POST /api/restaurants/search 결과 중 직접 고른 후보를
// 검증 없이 그대로 저장한다(사용자가 이미 상호명+주소를 보고 확인했으므로). 이미 같은 식당(같은 id)이
// 있으면 새로 만들지 않고 existing:true로 기존 데이터를 돌려준다.
//
// 저장 직후 응답을 돌려준 뒤, 백그라운드(fire-and-forget)로 대한민국 제로페이 공식 서버(zeropay.or.kr)
// 및 네이버 플레이스 조회를 수행해 isZeroPay, phone, categoryLabel을 채워 넣는다.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { companyCode, candidate } = body ?? {};

    if (!companyCode || typeof companyCode !== "string") {
      return NextResponse.json({ error: "companyCode가 필요해요." }, { status: 400 });
    }

    if (
      !candidate ||
      typeof candidate.title !== "string" ||
      typeof candidate.address !== "string" ||
      typeof candidate.lat !== "number" ||
      typeof candidate.lng !== "number"
    ) {
      return NextResponse.json(
        { error: "candidate(title, address, lat, lng) 정보가 유효하지 않아요." },
        { status: 400 }
      );
    }

    const result = await addRestaurantFromCandidate(companyCode, candidate);

    // 새로 만들어진 경우에만 백그라운드로 공식 제로페이 검증 및 정보 보완
    if (!result.existing) {
      const companySnap = await db.collection("companies").doc(companyCode).get();
      const rawDistrict: string = companySnap.data()?.districtCode ?? "";
      const districtKeyword = rawDistrict.replace(/(구|시|군)$/, "").trim() || undefined;

      enrichRestaurantInBackground(
        companyCode,
        result.restaurant.id,
        candidate.title,
        districtKeyword,
        candidate.category
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    const msg = (err as Error).message ?? "식당을 추가하지 못했어요.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function enrichRestaurantInBackground(
  companyCode: string,
  restaurantId: string,
  name: string,
  districtKeyword?: string,
  rawCategory?: string | null
) {
  Promise.all([
    // 1. 네이버 맵 검색으로 placeId 및 전화번호 수집
    import("@/lib/naver-place-detail")
      .then(({ lookupNaverPlaceDetail }) => lookupNaverPlaceDetail(name, { districtKeyword }))
      .catch(() => null),

    // 2. 대한민국 제로페이 공식 서버(zeropay.or.kr) 조회로 100% 정합성 검증
    import("@/lib/zeropay-official")
      .then(({ checkZeroPayOfficial }) => checkZeroPayOfficial(name))
      .catch(() => null),
  ])
    .then(async ([naverDetail, officialZeroPay]) => {
      const docRef = db
        .collection("companies")
        .doc(companyCode)
        .collection("restaurants")
        .doc(restaurantId);

      const update: Record<string, unknown> = {};

      if (naverDetail) {
        update.naverPlaceId = naverDetail.naverPlaceId;
        update.naverMatchedName = naverDetail.matchedName;
        if (naverDetail.phone) update.phone = naverDetail.phone;
      }

      if (officialZeroPay) {
        update.isZeroPay = officialZeroPay.isZeroPay;
        update.zeroPaySource = "zeropay_official";
        update.zeroPayEnrichedAt = new Date().toISOString();
        if (officialZeroPay.officialName) update.zeroPayOfficialName = officialZeroPay.officialName;
        if (officialZeroPay.officialAddress) update.zeroPayOfficialAddress = officialZeroPay.officialAddress;

        console.log(
          `[ZeroPay-Official] "${name}" → 제로페이: ${officialZeroPay.isZeroPay} (공식상호: ${officialZeroPay.officialName ?? "없음"})`
        );
      }

      // 3. Gemini 카테고리 분류
      try {
        const { CATEGORY_LABELS } = await import("@/lib/restaurant-category");
        const apiKey = process.env.GEMINI_API_KEY;
        if (apiKey) {
          const GEMINI_ENDPOINT =
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent";
          const prompt = `한국 식당 이름과 업종을 보고 아래 라벨 중 하나로만 분류하세요.
라벨: ${CATEGORY_LABELS.join(", ")}
식당 이름: ${name}
업종: ${rawCategory ?? "(없음)"}
JSON으로만 답하세요: {"label": "라벨"}`;

          const res = await fetch(GEMINI_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: { responseMimeType: "application/json" },
            }),
          });

          if (res.ok) {
            const data = await res.json();
            const text: string =
              data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
            const parsed = JSON.parse(text.replace(/^```json\s*/i, "").replace(/```\s*$/, ""));
            if (parsed?.label && CATEGORY_LABELS.includes(parsed.label)) {
              update.categoryLabel = parsed.label;
            }
          }
        }
      } catch (catErr) {
        console.warn(`[category-enrich] "${name}" 분류 실패:`, catErr);
      }

      if (Object.keys(update).length > 0) {
        await docRef.update(update);
      }
    })
    .catch((err) => {
      console.error(`[enrich] "${name}" 백그라운드 수집 실패:`, err);
    });
}
