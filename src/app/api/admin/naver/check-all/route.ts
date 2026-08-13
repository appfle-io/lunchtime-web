import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth-server";
import { isAdminUser } from "@/lib/admin-server";
import { db } from "@/lib/firebase";
import { searchNaverLocal, stripHtmlTags } from "@/lib/naver-local-search";

async function requireAdmin(companyCode: string) {
  const sessionToken = cookies().get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(sessionToken);
  if (!session || session.companyCode !== companyCode) return null;
  const admin = await isAdminUser(companyCode, session.nicknameId);
  if (!admin) return null;
  return session;
}

export interface NaverRefreshDiffItem {
  id: string;
  name: string;
  address: string;
  currentPhone: string | null;
  proposedPhone: string | null;
  currentNaverMatchedName: string | null;
  proposedNaverMatchedName: string | null;
  currentNaverMatchedAddress: string | null;
  proposedNaverMatchedAddress: string | null;
  patch: {
    phone?: string;
    naverMatchedName?: string;
    naverMatchedAddress?: string;
    category?: string;
    naverEnrichedAt?: string;
  };
  reason: string;
}

export async function POST(request: NextRequest) {
  let body: { companyCode?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const { companyCode } = body;
  if (!companyCode) {
    return NextResponse.json({ error: "companyCode가 필요합니다." }, { status: 400 });
  }

  const session = await requireAdmin(companyCode);
  if (!session) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  try {
    const snap = await db
      .collection("companies")
      .doc(companyCode)
      .collection("restaurants")
      .get();

    const diffs: NaverRefreshDiffItem[] = [];

    // 회사 지역명 정보 가져오기 (예: 영등포)
    const companySnap = await db.collection("companies").doc(companyCode).get();
    const districtCode = companySnap.data()?.districtCode ?? "";
    const districtKeyword = districtCode.replace(/(구|시|군)$/, "").trim();

    for (const doc of snap.docs) {
      const data = doc.data();
      const id = doc.id;
      const name = (data.name as string) ?? "";
      const address = (data.address as string) ?? "";
      const currentPhone = (data.phone as string) ?? null;
      const currentNaverMatchedName = (data.naverMatchedName as string) ?? null;
      const currentNaverMatchedAddress = (data.naverMatchedAddress as string) ?? null;

      try {
        const query = `${districtKeyword} ${name}`.trim();
        const items = await searchNaverLocal(query, 3, "random");

        if (items && items.length > 0) {
          const item = items[0];
          const matchedName = stripHtmlTags(item.title);
          const matchedAddress = item.roadAddress || item.address;
          const phone = item.telephone || null;

          const patch: Record<string, any> = {
            naverEnrichedAt: new Date().toISOString(),
          };
          const changes: string[] = [];

          if (phone && phone !== currentPhone) {
            patch.phone = phone;
            changes.push(`전화번호: ${currentPhone ?? "(없음)"} ➔ ${phone}`);
          }

          if (matchedName && matchedName !== currentNaverMatchedName) {
            patch.naverMatchedName = matchedName;
            changes.push(`네이버 검색 상호: ${currentNaverMatchedName ?? "(없음)"} ➔ ${matchedName}`);
          }

          if (matchedAddress && matchedAddress !== currentNaverMatchedAddress) {
            patch.naverMatchedAddress = matchedAddress;
            changes.push(`네이버 주소: ${currentNaverMatchedAddress ?? "(없음)"} ➔ ${matchedAddress}`);
          }

          if (changes.length > 0) {
            diffs.push({
              id,
              name,
              address,
              currentPhone,
              proposedPhone: phone,
              currentNaverMatchedName,
              proposedNaverMatchedName: matchedName,
              currentNaverMatchedAddress,
              proposedNaverMatchedAddress: matchedAddress,
              patch,
              reason: changes.join(", "),
            });
          }
        }
      } catch (_) {
        // API 한도 또는 에러 발생시 건너뜀
      }
    }

    return NextResponse.json({ diffs, totalChecked: snap.size });
  } catch (err) {
    console.error("[admin/naver/check-all] 갱신 점검 실패:", err);
    return NextResponse.json({ error: "네이버 정보 갱신 점검 중 오류가 발생했습니다." }, { status: 500 });
  }
}
