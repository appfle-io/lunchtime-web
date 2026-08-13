import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth-server";
import { isAdminUser } from "@/lib/admin-server";
import { db } from "@/lib/firebase";
import { validateBrandMatch, checkZeroPayOfficial } from "@/lib/zeropay-official";

async function requireAdmin(companyCode: string) {
  const sessionToken = cookies().get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(sessionToken);
  if (!session || session.companyCode !== companyCode) return null;
  const admin = await isAdminUser(companyCode, session.nicknameId);
  if (!admin) return null;
  return session;
}

export interface ZeroPayAuditDiffItem {
  id: string;
  name: string;
  address: string;
  currentIsZeroPay: boolean;
  proposedIsZeroPay: boolean;
  currentOfficialName: string | null;
  proposedOfficialName: string | null;
  currentOfficialAddress: string | null;
  proposedOfficialAddress: string | null;
  patch: {
    isZeroPay: boolean;
    zeroPayOfficialName: string | null;
    zeroPayOfficialAddress: string | null;
    zeroPaySource?: string;
    zeroPayEnrichedAt?: string;
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

    const diffs: ZeroPayAuditDiffItem[] = [];

    for (const doc of snap.docs) {
      const data = doc.data();
      const id = doc.id;
      const name = (data.name as string) ?? "";
      const address = (data.address as string) ?? "";
      const currentIsZeroPay = Boolean(data.isZeroPay);
      const currentOfficialName = (data.zeroPayOfficialName as string) ?? (data.naverMatchedName as string) ?? null;
      const currentOfficialAddress = (data.zeroPayOfficialAddress as string) ?? (data.naverMatchedAddress as string) ?? null;

      // Case 1: isZeroPay === true 이지만 공식 상호명이 존재하고 브랜드가 완전히 불일치하는 경우 (False Positive 오매칭)
      if (currentIsZeroPay && currentOfficialName) {
        const isBrandValid = validateBrandMatch(name, currentOfficialName);
        if (!isBrandValid) {
          diffs.push({
            id,
            name,
            address,
            currentIsZeroPay: true,
            proposedIsZeroPay: false,
            currentOfficialName,
            proposedOfficialName: null,
            currentOfficialAddress,
            proposedOfficialAddress: null,
            patch: {
              isZeroPay: false,
              zeroPayOfficialName: null,
              zeroPayOfficialAddress: null,
              zeroPaySource: "audit_cleared",
              zeroPayEnrichedAt: new Date().toISOString(),
            },
            reason: `브랜드 상호 불일치 오매칭 (DB: '${name}' != 제로페이: '${currentOfficialName}')`,
          });
          continue;
        }
      }

      // Case 2: isZeroPay === false 이나 zeroPayOfficialName에 엉뚱한 브랜드가 찌꺼기로 남아있는 경우
      if (!currentIsZeroPay && data.zeroPayOfficialName) {
        const isBrandValid = validateBrandMatch(name, data.zeroPayOfficialName as string);
        if (!isBrandValid) {
          diffs.push({
            id,
            name,
            address,
            currentIsZeroPay: false,
            proposedIsZeroPay: false,
            currentOfficialName: data.zeroPayOfficialName as string,
            proposedOfficialName: null,
            currentOfficialAddress: (data.zeroPayOfficialAddress as string) ?? null,
            proposedOfficialAddress: null,
            patch: {
              isZeroPay: false,
              zeroPayOfficialName: null,
              zeroPayOfficialAddress: null,
              zeroPaySource: "audit_cleared",
              zeroPayEnrichedAt: new Date().toISOString(),
            },
            reason: "오매칭 찌꺼기 텍스트 필드 삭제 정리",
          });
          continue;
        }
      }

      // Case 3: isZeroPay === false 매장 중 Pure HTTP 조회가 가능한 경우 신규 검증시도
      if (!currentIsZeroPay) {
        const res = await checkZeroPayOfficial(name, address);
        if (res.isZeroPay && res.officialName) {
          const isBrandValid = validateBrandMatch(name, res.officialName);
          if (isBrandValid) {
            diffs.push({
              id,
              name,
              address,
              currentIsZeroPay: false,
              proposedIsZeroPay: true,
              currentOfficialName,
              proposedOfficialName: res.officialName,
              currentOfficialAddress,
              proposedOfficialAddress: res.officialAddress ?? null,
              patch: {
                isZeroPay: true,
                zeroPayOfficialName: res.officialName,
                zeroPayOfficialAddress: res.officialAddress ?? null,
                zeroPaySource: "official_zeropay_api",
                zeroPayEnrichedAt: new Date().toISOString(),
              },
              reason: `공식 제로페이 가맹점 매칭 성공 ('${res.officialName}')`,
            });
          }
        }
      }
    }

    return NextResponse.json({ diffs, totalChecked: snap.size });
  } catch (err) {
    console.error("[admin/zeropay/check-all] 점검 실패:", err);
    return NextResponse.json({ error: "제로페이 점검 중 오류가 발생했습니다." }, { status: 500 });
  }
}
