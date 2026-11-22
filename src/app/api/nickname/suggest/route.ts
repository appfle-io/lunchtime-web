import { NextRequest, NextResponse } from "next/server";
import { generateNicknameCandidates, resolveUniqueNickname } from "@/lib/nickname";
import { normalizeCompanyCode } from "@/lib/company";
import { getCompanyByCode } from "@/lib/company-server";
import { listCompanyUsers } from "@/lib/user-server";

// GET /api/nickname/suggest?companyCode=xxx
// 계정 생성 화면에서 "닉네임 제안" / "다시 추천" 버튼이 호출하는 API.
// Firestore 경로: companies/{정규화된 회사코드}/users/{정규화된 닉네임}
// 회사 문서ID 자체를 정규화된 코드로 쓰기 때문에, 대소문자 상관없이 항상 같은 회사 문서를 찾는다.
export async function GET(req: NextRequest) {
  const rawCompanyCode = req.nextUrl.searchParams.get("companyCode");
  if (!rawCompanyCode) {
    return NextResponse.json({ error: "companyCode가 필요합니다." }, { status: 400 });
  }
  const companyCode = normalizeCompanyCode(rawCompanyCode);

  // 로그인 전 화면에서 호출되는 공개 API라, 예전처럼 호출마다 회사 문서 + 전체 사용자 문서를
  // 읽으면 "다시 추천" 연타만으로 사용자 수만큼 읽기가 계속 과금됐다. 회사/사용자 목록 모두
  // 서버 TTL 캐시(company-server.ts, user-server.ts)를 거치게 한다.
  const company = await getCompanyByCode(companyCode);
  if (!company) {
    return NextResponse.json({ error: "존재하지 않는 회사코드입니다." }, { status: 404 });
  }

  const existingNicknameIds = new Set((await listCompanyUsers(companyCode)).map((u) => u.nicknameId));

  const candidates = generateNicknameCandidates(3).map((c) =>
    resolveUniqueNickname(c, existingNicknameIds)
  );

  return NextResponse.json({ candidates });
}

// 참고: 실제 계정 생성 API(/api/signup 등)에서는 lib/nickname.ts의 toNicknameId()로 만든 값을
// 문서ID로 써서 companyRef.collection("users").doc(toNicknameId(nickname)).create({ nickname, pinHash, createdAt })
// 처럼 create()를 쓰면, 문서가 이미 있을 때 자동으로 실패하기 때문에
// 동시 가입 race condition 걱정 없이 유일성이 보장된다.
