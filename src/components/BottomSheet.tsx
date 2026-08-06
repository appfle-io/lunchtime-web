"use client";

import { ReactNode, useState } from "react";

interface BottomSheetProps {
  children: ReactNode;
  title?: string;
  // 2026-08-06 3차 신규: title과 같은 줄, 오른쪽 끝에 놓을 슬롯 - 원래 지도 좌상단에 독립된
  // 절대좌표로 떠 있던 "{닉네임}님 · 로그아웃" 버튼을 "주변식당 있는 자리의 오른쪽 끝"으로
  // 옮겨달라는 요청에 대응한다. 새 절대좌표를 만들지 않고 이미 안전한 title 줄에 얹는 방식.
  titleRight?: ReactNode;
  // 2026-08-06 추가: 항상 보여야 하는 버튼류(예: "오늘 뭐 먹지?", "직접 추가하기")를 위한 슬롯.
  // title 아래·children 스크롤 영역 밖에 고정으로 렌더링된다. 예전엔 이런 버튼들을 children 맨 위에
  // 그냥 같이 넣었는데, 그러면 리스트를 보려고 스크롤할 때 버튼들도 같이 스크롤되어 위로 사라지고,
  // 반대로 목록이 길면 버튼까지 도달하기 위해 매번 스크롤이 필요해서 "스크롤 압박이 심하다"는
  // 사용자 피드백을 받았다. header로 분리해서 항상 같은 자리에 고정시킨다.
  header?: ReactNode;
}

// 모바일에서는 화면 하단에서 끌어올리는 바텀시트, 데스크톱에서는 좌상단 플로팅 카드로 보이는
// 공용 셸 컴포넌트. "좌측 고정 패널 + 우측 지도"라는 전형적인 지도앱 틀을 벗어나기 위한 장치.
// flex-col + overflow-hidden(바깥) + flex-1 overflow-y-auto(안쪽 스크롤 영역) 구조로,
// 드래그 핸들/제목/header가 차지하는 높이를 제외한 나머지 공간만 스크롤 영역이 갖도록 해서
// 콘텐츠가 카드 바깥(지도 위)으로 삐져나오지 않게 한다.
// 2026-08-06: 데스크톱 폭을 360px -> 400px로 살짝 넓힘(사용자가 "너무 좁아서 스크롤 압박이
// 심하다"고 피드백 - 식당 이름/주소가 잘 안 잘리게).
// 2026-08-06 추가 키우기: "주변식당 영역이 너무 좁다"는 요청으로 모바일 접힘/펼침 높이(32vh->40vh,
// 70vh->80vh)와 데스크톱 상하 여백(24px->16px)을 줄여서 카드 자체를 키움. 모바일 접힘 높이는
// PopularWidget.tsx가 그대로 참조하는 값이라(바텀시트 접힌 높이 바로 위에 배치), 여기서 바꾸면
// PopularWidget.tsx의 오프셋도 같이 맞춰야 한다 - 안 그러면 또 겹침 회귀가 난다.
// 2026-08-06 저녁: "주변식당 아래에 캘린더뷰(밥 먹은 기록)를 추가해달라"는 요청으로 한 번
// 위/아래 절반 분할 모드를 만들었었는데, 사용자 피드백은 "주변식당은 그대로 두고 그 아래
// 공간에 캘린더를 추가하라는 것 - 반으로 쪼개는 게 아니다"였다. 그래서 분할 모드를 되돌리고,
// 캘린더는 RestaurantList.tsx가 children 맨 아래에 그냥 이어서 넣는 방식(단일 스크롤 영역
// 안에서 리스트 다음에 캘린더가 나오는 것)으로 처리한다 - 이 컴포넌트 자체는 다시 원래 형태로.
// TODO: 실제 드래그 제스처(Framer Motion)로 높이 조절, snap point(접힘/반펼침/완전펼침) 추가.
export default function BottomSheet({ children, title, titleRight, header }: BottomSheetProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section
      className={[
        "absolute z-20 flex flex-col overflow-hidden rounded-t-xl2 bg-surface shadow-soft transition-all",
        // 모바일: 하단 고정
        "bottom-0 left-0 right-0",
        expanded ? "h-[80vh]" : "h-[40vh]",
        // 데스크톱: 좌상단 플로팅 카드
        "md:left-6 md:right-auto md:top-4 md:bottom-4 md:w-[400px] md:rounded-xl2",
      ].join(" ")}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="mx-auto mt-3 block h-1.5 w-10 shrink-0 rounded-full bg-black/10 md:hidden"
        aria-label="펼치기/접기"
      />
      {(title || titleRight) && (
        <div className="flex shrink-0 items-center justify-between gap-2 px-5 pt-3 md:pt-5">
          {title && <h2 className="text-lg font-bold text-ink">{title}</h2>}
          {titleRight}
        </div>
      )}
      {header && <div className="shrink-0 px-5 pt-3">{header}</div>}
      <div className="flex-1 overflow-y-auto px-5 pb-6 pt-2">{children}</div>
    </section>
  );
}
