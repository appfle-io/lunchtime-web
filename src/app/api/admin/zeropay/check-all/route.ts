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

    // 1단계: 기존 DB 정합성 전수 스캔 (브랜드 불일치 오매칭 즉시 감지)
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
    }

    // 2단계: isZeroPay === false 매장 중 제로페이 공식 사이트(zeropay.or.kr) 실시간 교차 조회 (Vercel 타임아웃 방지를 위해 20개 배치 병렬 수행)
    const unverifiedDocs = snap.docs
      .filter((d) => !d.data().isZeroPay && !d.data().zeroPayOfficialName)
      .slice(0, 20);

    const BATCH_SIZE = 5;
    for (let i = 0; i < unverifiedDocs.length; i += BATCH_SIZE) {
      const chunk = unverifiedDocs.slice(i, i + BATCH_SIZE);
      await Promise.all(
        chunk.map(async (doc) => {
          const data = doc.data();
          const id = doc.id;
          const name = (data.name as string) ?? "";
          const address = (data.address as string) ?? "";

          try {
            const res = await checkZeroPayOfficial(name, address);
            if (res && res.isZeroPay && res.officialName) {
              const isBrandValid = validateBrandMatch(name, res.officialName);
              if (isBrandValid) {
                diffs.push({
                  id,
                  name,
                  address,
                  currentIsZeroPay: false,
                  proposedIsZeroPay: true,
                  currentOfficialName: null,
                  proposedOfficialName: res.officialName,
                  currentOfficialAddress: null,
                  proposedOfficialAddress: res.officialAddress ?? null,
                  patch: {
                    isZeroPay: true,
                    zeroPayOfficialName: res.officialName,
                    zeroPayOfficialAddress: res.officialAddress ?? null,
                    zeroPaySource: "official_zeropay_api",
                    zeroPayEnrichedAt: new Date().toISOString(),
                  },
                  reason: `제로페이 공식 사이트 실시간 조회 매칭 성공 ('${res.officialName}')`,
                });
              }
            }
          } catch (_) {}
        })
      );
    }

    return NextResponse.json({ diffs, totalChecked: snap.size });
  } catch (err) {
    console.error("[admin/zeropay/check-all] 점검 실패:", err);
    return NextResponse.json({ error: "제로페이 점검 중 오류가 발생했습니다." }, { status: 500 });
  }
}
