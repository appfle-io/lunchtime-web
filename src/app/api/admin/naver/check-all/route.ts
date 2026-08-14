import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth-server";
import { isAdminUser } from "@/lib/admin-server";
import { db } from "@/lib/firebase";
import { searchNaverLocal, stripHtmlTags } from "@/lib/naver-local-search";
import { validateBrandMatch } from "@/lib/zeropay-official";
import { enrichRestaurantById } from "@/lib/enrich-server";

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
    naverMatchedName?: string | null;
    naverMatchedAddress?: string | null;
    category?: string;
    naverEnrichedAt?: string;
  };
  reason: string;
}

export async function POST(request: NextRequest) {
  let body: { companyCode?: string; limit?: number; targetIds?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const { companyCode, limit = 30, targetIds } = body;
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

    const targetSet = targetIds && targetIds.length > 0 ? new Set(targetIds) : null;
    const docsToScan = targetSet ? snap.docs.filter((d) => targetSet.has(d.id)) : snap.docs;

    // 갱신 우선순위: 전화번호나 네이버 정보가 없거나 갱신 필요 대상 우선, 최대 limit건
    const pendingDocs = docsToScan
      .filter((d) => {
        const data = d.data();
        return !data.phone || !data.naverMatchedName || !data.naverEnrichedAt;
      })
      .slice(0, limit);

    const docsToProcess = targetSet
      ? docsToScan
      : pendingDocs.length > 0
      ? pendingDocs
      : snap.docs.slice(0, limit);

    const companySnap = await db.collection("companies").doc(companyCode).get();
    const districtCode = companySnap.data()?.districtCode ?? "";
    const districtKeyword = districtCode.replace(/(구|시|군)$/, "").trim();

    const diffs: NaverRefreshDiffItem[] = [];

    // 1단계: 기존 DB에 남아있는 네이버 브랜드 오매칭(예: 스타벅스 ➔ 강창구찹쌀진순대 오탐) 감지 및 정리
    for (const doc of docsToScan) {
      const data = doc.data();
      const id = doc.id;
      const name = (data.name as string) ?? "";
      const address = (data.address as string) ?? "";
      const currentNaverMatchedName = (data.naverMatchedName as string) ?? null;
      const currentNaverMatchedAddress = (data.naverMatchedAddress as string) ?? null;

      if (currentNaverMatchedName) {
        // 브랜드 상호 정합성 검증 (서해쭈꾸미 ↔ 서해쭈꾸미처럼 동일 브랜드인 경우는 정상 매칭으로 취급)
        const isBrandValid = validateBrandMatch(name, currentNaverMatchedName);

        if (!isBrandValid) {
          diffs.push({
            id,
            name,
            address,
            currentPhone: (data.phone as string) ?? null,
            proposedPhone: (data.phone as string) ?? null,
            currentNaverMatchedName,
            proposedNaverMatchedName: null,
            currentNaverMatchedAddress,
            proposedNaverMatchedAddress: null,
            patch: {
              naverMatchedName: null,
              naverMatchedAddress: null,
              naverEnrichedAt: new Date().toISOString(),
            },
            reason: `네이버 브랜드 상호 불일치 오매칭 (DB: '${name}' != 네이버: '${currentNaverMatchedName}') ➔ 오매칭 초기화`,
          });
        }
      }
    }

    // 2단계: 대상 가맹점들의 네이버 플레이스 상세 수집기(enrichRestaurantById) 실시간 실행 (3개씩 병렬)
    // 💡 수동수집 버튼과 동일한 고성능 수집 엔진을 사용하여 메뉴, 영업시간, 전화번호, 제로페이, 플레이스 링크까지 완벽하게 수집합니다.
    const BATCH_SIZE = 3;
    for (let i = 0; i < docsToProcess.length; i += BATCH_SIZE) {
      const chunk = docsToProcess.slice(i, i + BATCH_SIZE);

      await Promise.all(
        chunk.map(async (doc) => {
          const data = doc.data();
          const id = doc.id;
          const name = (data.name as string) ?? "";
          const address = (data.address as string) ?? "";
          const currentPhone = (data.phone as string) ?? null;
          const currentNaverMatchedName = (data.naverMatchedName as string) ?? null;
          const currentNaverMatchedAddress = (data.naverMatchedAddress as string) ?? null;
          const currentMenus = Array.isArray(data.menus) ? data.menus : [];
          const currentZeroPay = Boolean(data.isZeroPay);

          try {
            const enrichRes = await enrichRestaurantById(companyCode, id);
            const newRest = enrichRes.restaurant;

            const proposedPhone = newRest.phone ?? null;
            const proposedNaverMatchedName = newRest.naverMatchedName ?? null;
            const proposedNaverMatchedAddress = (data.naverMatchedAddress as string) ?? null;
            const proposedMenus = newRest.menus ?? [];

            const changes: string[] = [];

            if (proposedPhone && proposedPhone !== currentPhone) {
              changes.push(`전화번호: ${currentPhone ?? "(없음)"} ➔ ${proposedPhone}`);
            }

            if (proposedNaverMatchedName && proposedNaverMatchedName !== currentNaverMatchedName) {
              changes.push(`네이버상호: ${currentNaverMatchedName ?? "(없음)"} ➔ ${proposedNaverMatchedName}`);
            }

            if (proposedMenus.length !== currentMenus.length) {
              changes.push(`메뉴: ${currentMenus.length}개 ➔ ${proposedMenus.length}개 수집`);
            }

            if (newRest.isZeroPay !== currentZeroPay) {
              changes.push(`제로페이: ${currentZeroPay ? "가능" : "불가"} ➔ ${newRest.isZeroPay ? "가능" : "불가"}`);
            }

            if (newRest.naverPlaceUrl && !data.naverPlaceUrl) {
              changes.push(`네이버지도 링크 연동 완료`);
            }

            const patch: Record<string, any> = {
              phone: proposedPhone,
              naverMatchedName: proposedNaverMatchedName,
              naverPlaceUrl: newRest.naverPlaceUrl ?? null,
              categoryLabel: newRest.categoryLabel ?? null,
              businessHours: newRest.businessHours ?? null,
              facilities: newRest.facilities ?? [],
              paymentMethods: newRest.paymentMethods ?? [],
              menus: proposedMenus,
              isZeroPay: newRest.isZeroPay,
              naverEnrichedAt: new Date().toISOString(),
            };

            // 선택 수집이거나 변경사항이 있는 경우 diff 목록에 추가
            if (changes.length > 0 || targetSet) {
              diffs.push({
                id,
                name,
                address,
                currentPhone,
                proposedPhone,
                currentNaverMatchedName,
                proposedNaverMatchedName,
                currentNaverMatchedAddress,
                proposedNaverMatchedAddress: currentNaverMatchedAddress,
                patch,
                reason: changes.length > 0 ? changes.join(", ") : "네이버 플레이스 최신 정보 수집 완료",
              });
            }
          } catch (enrichErr) {
            console.warn(`[check-all] "${name}" 수동수집 엔진 실행 실패:`, enrichErr);
          }
        })
      );
    }

    return NextResponse.json({ diffs, totalChecked: snap.size, totalCount: snap.size });
  } catch (err) {
    console.error("[admin/naver/check-all] 갱신 점검 실패:", err);
    return NextResponse.json({ error: "네이버 정보 갱신 점검 중 오류가 발생했습니다." }, { status: 500 });
  }
}
