"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { normalizeCompanyCode } from "@/lib/company";
import LoadingOverlay from "@/components/LoadingOverlay";

// 진입점: 회사코드 입력 화면.
// 로그인 없이 회사코드만으로 해당 회사 스코프(company_id)로 라우팅한다.
// 회사코드는 대소문자 구분 없이 통과시키기 위해 항상 소문자로 정규화해서 라우팅한다
// (SSG, Ssg, ssg 모두 같은 /ssg 경로로 이동).
// TODO: 회사코드 유효성 확인 API 연동, 최근 접속한 회사코드 로컬 저장(재입력 최소화).
export default function CompanyEntryPage() {
  const router = useRouter();
  const [companyCode, setCompanyCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  // 2026-08-10 신규: "시작하기"를 누르면 router.push가 끝날 때까지(다음 화면이 준비될 때까지)
  // 버튼을 눌러도 아무 반응이 없는 것처럼 보이던 문제 - useTransition으로 감싸서 isPending을
  // 클릭한 즉시 true로 만들고, 로딩 오버레이를 보여준다.
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = normalizeCompanyCode(companyCode);
    if (!code) {
      setError("회사코드를 입력해주세요.");
      return;
    }
    startTransition(() => {
      router.push(`/${encodeURIComponent(code)}`);
    });
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-xl2 bg-surface p-8 shadow-soft">
        <h1 className="text-2xl font-bold text-ink">밥시간</h1>
        <p className="mt-1 text-sm text-ink-soft">오늘 뭐 먹지? 회사코드로 시작해보세요.</p>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
          <input
            value={companyCode}
            onChange={(e) => setCompanyCode(e.target.value)}
            placeholder="발급받은 회사코드를 입력하세요"
            className="rounded-xl2 border border-black/10 px-4 py-3 text-ink outline-none focus:border-primary"
          />
          {error && <p className="text-sm text-primary-dark">{error}</p>}
          <button
            type="submit"
            disabled={isPending}
            className="rounded-xl2 bg-primary px-4 py-3 font-semibold text-white transition hover:bg-primary-dark disabled:opacity-60"
          >
            {isPending ? "이동하는 중..." : "시작하기"}
          </button>
        </form>
      </div>
      {isPending && <LoadingOverlay message="불러오는 중..." />}
    </main>
  );
}
