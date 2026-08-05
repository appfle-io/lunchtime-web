import { NextRequest, NextResponse } from "next/server";
import { generateNicknameCandidates, resolveUniqueNickname } from "@/lib/nickname";
import { normalizeCompanyCode } from "@/lib/company";
import { db } from "@/lib/firebase";

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

  const companyRef = db.collection("companies").doc(companyCode);
  const companySnap = await companyRef.get();

  if (!companySnap.exists) {
    return NextResponse.json({ error: "존재하지 않는 회사코드입니다." }, { status: 404 });
  }

  // 문서 본문은 필요 없고 문서ID(=정규화된 닉네임)만 필요하므로 select()로 필드 전송을 줄인다.
  const usersSnap = await companyRef.collection("users").select().get();
  const existingNicknameIds = new Set(usersSnap.docs.map((d) => d.id));

  const candidates = generateNicknameCandidates(3).map((c) =>
    resolveUniqueNickname(c, existingNicknameIds)
  );

  return NextResponse.json({ candidates });
}

// 참고: 실제 계정 생성 API(/api/signup 등)에서는 lib/nickname.ts의 toNicknameId()로 만든 값을
// 문서ID로 써서 companyRef.collection("users").doc(toNicknameId(nickname)).create({ nickname, pinHash, createdAt })
// 처럼 create()를 쓰면, 문서가 이미 있을 때 자동으로 실패하기 때문에
// 동시 가입 race condition 걱정 없이 유일성이 보장된다.
