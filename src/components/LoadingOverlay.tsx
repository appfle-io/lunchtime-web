interface LoadingOverlayProps {
  message?: string;
}

// 2026-08-10 신규: 페이지 전환(회사코드 입력 → 메인, 로그인 성공 → 메인, 메인 ↔ 관리자) 중에
// 서버 컴포넌트가 데이터를 다시 읽어오는 동안 화면이 "버튼을 눌러도 반응이 없다가 갑자기
// 넘어가는" 것처럼 보이던 문제 때문에 만든 공용 로딩 모달. 두 방식으로 같이 쓰인다:
//
// 1) app/**/loading.tsx에서 그대로 내보내는 방식 - Next.js App Router 규칙상 이 파일이 있으면
//    같은 세그먼트의 page.tsx(서버 컴포넌트)가 데이터를 불러오는 동안 자동으로 이 화면을
//    Suspense로 보여준다. 클릭한 링크/router.push든, 새로고침이든, URL을 직접 쳐서 들어와도
//    전부 적용된다 - 화면 전환 자체가 "느리게" 느껴지는 근본 원인(서버 데이터 페칭)을 덮어준다.
// 2) 클라이언트 컴포넌트에서 useTransition()의 isPending과 함께 쓰는 방식 - 버튼을 누른
//    "그 즉시"부터 보여줘서, 위 1)이 반응하기 시작하기 전의 아주 짧은 공백까지 메꿔준다.
//
// 특정 상태(hooks)가 없는 순수 표시용 컴포넌트라 서버/클라이언트 컴포넌트 양쪽에서 다 쓸 수
// 있다("use client" 불필요).
export default function LoadingOverlay({ message = "불러오는 중..." }: LoadingOverlayProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 backdrop-blur-[1px]"
    >
      <div className="flex flex-col items-center gap-3 rounded-xl2 bg-surface px-8 py-6 shadow-soft">
        <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-primary/25 border-t-primary" />
        <p className="text-sm font-medium text-ink-soft">{message}</p>
      </div>
    </div>
  );
}
