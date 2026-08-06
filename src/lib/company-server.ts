import { db } from "@/lib/firebase";
import { normalizeCompanyCode } from "@/lib/company";
import type { CompanySummary } from "@/types";

// companies/{정규화된코드} 문서를 읽어서 회사 중심좌표 등을 가져온다.
// 서버(Server Component / API route)에서만 import한다 (firebase-admin 기반이라 클라이언트 번들에 들어가면 깨짐).
// 문서가 없으면 null을 반환하니, 호출하는 쪽에서 존재하지 않는 회사코드 처리를 해줘야 한다.
export async function getCompanyByCode(
  rawCode: string
): Promise<CompanySummary | null> {
  const code = normalizeCompanyCode(rawCode);
  const snapshot = await db.collection("companies").doc(code).get();

  if (!snapshot.exists) return null;

  const data = snapshot.data() ?? {};
  return {
    id: snapshot.id,
    code,
    name: data.name ?? code,
    centerLat: data.centerLat,
    centerLng: data.centerLng,
    districtCode: data.districtCode,
    landmarks: Array.isArray(data.landmarks) ? data.landmarks : undefined,
  };
}
