"use client";

import { useState, type ReactNode } from "react";

interface UserGuideModalProps {
  open: boolean;
  onClose: (dontShowAgain?: boolean) => void;
}

interface GuideItem {
  label: string;
  description: string;
  renderPreview: () => ReactNode;
}

interface GuideSection {
  id: string;
  tabLabel: string;
  title: string;
  summary: string;
  items: GuideItem[];
  tip?: string;
}

const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: "search",
    tabLabel: "식당 탐색 및 필터",
    title: "식당 탐색 및 스마트 필터",
    summary: "지도 이동에 따른 실시간 목록 동기화와 상단 필터, 날씨/인기 위젯을 활용할 수 있습니다.",
    tip: "지도에서 식당 마커나 목록 카드를 클릭하면 위치로 포커스되며 상세 카드가 열립니다.",
    items: [
      {
        label: "지도 연동 주변 식당 목록",
        description: "지도를 드래그하거나 확대/축소하면 현재 화면에 보이는 위치의 식당들만 좌측 목록에 실시간으로 표시됩니다.",
        renderPreview: () => (
          <div className="flex h-36 w-full items-center justify-between gap-3 rounded-xl border border-black/10 bg-slate-100/70 p-3.5">
            {/* 좌측 미니 리스트 */}
            <div className="flex h-full w-44 flex-col justify-between rounded-xl border border-black/10 bg-white p-2.5 shadow-xs">
              <div className="flex items-center justify-between border-b border-black/5 pb-1">
                <span className="text-[11px] font-bold text-ink">주변 식당</span>
                <span className="text-[9px] text-primary font-bold">12개</span>
              </div>
              <div className="space-y-1">
                <div className="rounded bg-primary-light/50 px-2 py-1 text-[10px] font-semibold text-primary-dark">
                  1. 골목식당 (도보 3분)
                </div>
                <div className="rounded bg-slate-50 px-2 py-1 text-[10px] text-ink-soft">
                  2. 스시마을 (도보 5분)
                </div>
              </div>
            </div>
            {/* 우측 지도 마커 그래픽 */}
            <div className="relative flex h-full flex-1 items-center justify-center rounded-xl border border-black/5 bg-slate-200/50">
              <span className="absolute left-6 top-4 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white shadow-md animate-bounce">
                1
              </span>
              <span className="absolute right-8 top-6 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[9px] font-bold text-white shadow-xs">
                2
              </span>
              <span className="text-[10px] text-ink-soft">지도 화면 영역 동기화</span>
            </div>
          </div>
        ),
      },
      {
        label: "상단 필터 바 (카테고리 & 특수 태그)",
        description: "한식, 일식 등 음식 카테고리와 제로페이, 도보 5분, 즐겨찾기, 회식, 최근많이찾는 필터를 조합할 수 있습니다.",
        renderPreview: () => (
          <div className="flex h-36 w-full flex-col justify-center gap-2.5 rounded-xl border border-black/10 bg-slate-50 p-4">
            <div className="text-[11px] font-bold text-ink-soft">실제 필터바 디자인</div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-full border border-primary bg-primary px-3 py-1 text-xs font-semibold text-white shadow-xs">
                ✓ 한식
              </span>
              <span className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs font-medium text-ink-soft">
                일식
              </span>
              <span className="rounded-full border border-primary bg-primary px-3 py-1 text-xs font-semibold text-white shadow-xs">
                ✓ 제로페이
              </span>
              <span className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs font-medium text-ink-soft">
                도보 5분
              </span>
              <span className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs font-medium text-ink-soft">
                즐겨찾기
              </span>
            </div>
            <div className="text-[10px] text-ink-soft">
              선택된 필터는 진한 배경과 체크마크(✓)로 표시됩니다.
            </div>
          </div>
        ),
      },
      {
        label: "날씨 및 실시간 인기 Top3 위젯",
        description: "지도 상단 알약형 날씨 위젯(클릭 시 새로고침)과 우측 상단의 실시간 인기 식당 랭킹 카드가 제공됩니다.",
        renderPreview: () => (
          <div className="flex h-36 w-full items-center justify-around gap-3 rounded-xl border border-black/10 bg-slate-100/60 p-3.5">
            {/* 실제 WeatherWidget 디자인 */}
            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] font-medium text-ink-soft">지도 상단 날씨 위젯</span>
              <div className="flex items-center gap-1.5 rounded-full border-2 border-primary/60 bg-white px-3 py-1.5 text-xs font-medium text-ink shadow-sm">
                <span className="text-sm">☀️</span>
                <span className="font-bold">24°</span>
                <span className="text-ink-soft">맑음</span>
              </div>
            </div>
            {/* 실제 PopularWidget 디자인 */}
            <div className="w-48 rounded-xl border border-black/10 bg-white p-2.5 shadow-sm">
              <div className="mb-1 flex items-center justify-between text-[10px] font-bold text-ink-soft">
                <span>🔥 실시간 인기 Top3</span>
                <span className="text-slate-400">새로고침</span>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between rounded px-1.5 py-0.5 text-xs">
                  <span className="font-bold text-primary">1</span>
                  <span className="truncate text-ink font-medium">을지로찌개마을</span>
                  <span className="text-[10px] text-ink-soft">42회</span>
                </div>
                <div className="flex items-center justify-between rounded px-1.5 py-0.5 text-xs">
                  <span className="font-bold text-primary">2</span>
                  <span className="truncate text-ink">스시마을</span>
                  <span className="text-[10px] text-ink-soft">28회</span>
                </div>
              </div>
            </div>
          </div>
        ),
      },
      {
        label: "식당 상세 카드 및 정보 확인",
        description: "식당 선택 시 영업시간, 전화번호, 제휴할인 혜택, 네이버지도 링크(네이버지도에서 보기), 오늘 식사 기록 버튼이 노출됩니다.",
        renderPreview: () => (
          <div className="flex h-36 w-full flex-col justify-between rounded-xl border border-black/10 bg-white p-3 shadow-xs">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-ink">을지로찌개마을</span>
                  <span className="rounded-full bg-primary-light px-2 py-0.5 text-[9px] font-semibold text-primary-dark">
                    제로페이 가능
                  </span>
                </div>
                <div className="mt-0.5 text-[10px] text-ink-soft">
                  도보 약 3분 (210m) · 🕒 11:00 ~ 21:30
                </div>
              </div>
              <span className="text-xs">❤️</span>
            </div>
            <div className="text-[10px] text-primary-dark underline">
              네이버지도에서 보기 ↗
            </div>
            <div className="flex gap-1.5">
              <span className="flex-1 rounded-lg bg-surface-muted py-1.5 text-center text-[10px] font-medium text-ink">
                오늘 여기서 먹었어요
              </span>
              <span className="flex-1 rounded-lg border border-dashed border-black/20 py-1.5 text-center text-[10px] font-medium text-ink-soft">
                정보수정요청
              </span>
            </div>
          </div>
        ),
      },
    ],
  },
  {
    id: "vote_roulette",
    tabLabel: "룰렛 및 투표",
    title: "메뉴 룰렛 및 점심 투표",
    summary: "조건에 맞춘 식당 룰렛 추천과 팀원들과 함께하는 점심 메뉴 실시간 투표를 진행할 수 있습니다.",
    tip: "알림함(종 아이콘)에서 새로 도착한 투표 초대 알림을 바로 확인하고 참여할 수 있습니다.",
    items: [
      {
        label: "오늘 뭐 먹지? (룰렛 추천)",
        description: "반경(도보 5분/10분/15분/전체), 음식 카테고리 다중 선택, 제로페이 전용 조건 및 함께 먹을 친구를 설정해 룰렛을 돌립니다.",
        renderPreview: () => (
          <div className="flex h-36 w-full flex-col justify-between rounded-xl border border-black/10 bg-slate-50 p-3.5">
            <div className="flex items-center justify-between text-xs font-bold text-ink">
              <span>오늘 뭐 먹지? 조건 설정</span>
              <span className="rounded bg-primary-light px-1.5 py-0.5 text-[10px] text-primary-dark">
                도보 5분 이내
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              <span className="rounded-full bg-ink px-2 py-0.5 text-[10px] font-semibold text-white">
                한식
              </span>
              <span className="rounded-full bg-ink px-2 py-0.5 text-[10px] font-semibold text-white">
                일식
              </span>
              <span className="rounded-full border border-black/10 bg-white px-2 py-0.5 text-[10px] text-ink-soft">
                중식
              </span>
              <span className="rounded-full bg-primary-light px-2 py-0.5 text-[10px] font-medium text-primary-dark">
                제로페이만 ON
              </span>
            </div>
            <div className="rounded-lg bg-ink py-1.5 text-center text-xs font-bold text-white shadow-xs">
              룰렛 돌리기
            </div>
          </div>
        ),
      },
      {
        label: "점심 투표 (후보 식당 & 실시간 결과)",
        description: "식당 후보들을 등록해 투표를 만들고, 실시간 득표 현황 및 '따로 먹을게요' 선택, 댓글 소통이 가능합니다.",
        renderPreview: () => (
          <div className="flex h-36 w-full flex-col justify-between rounded-xl border border-black/10 bg-white p-3.5">
            <div className="flex items-center justify-between text-xs font-bold text-ink">
              <span>오늘 점심 투표</span>
              <span className="text-[10px] text-primary-dark font-semibold">5명 응답</span>
            </div>
            <div className="space-y-1.5">
              <div>
                <div className="flex justify-between text-[11px]">
                  <span className="font-medium text-ink">1. 을지로찌개마을</span>
                  <span className="font-bold text-primary">3표 (60%)</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-slate-100">
                  <div className="h-1.5 rounded-full bg-primary" style={{ width: "60%" }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-ink-soft">2. 저는 따로 먹을게요</span>
                  <span className="text-ink-soft">2표 (40%)</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-slate-100">
                  <div className="h-1.5 rounded-full bg-slate-300" style={{ width: "40%" }} />
                </div>
              </div>
            </div>
          </div>
        ),
      },
      {
        label: "친구 관리 및 투표 초대",
        description: "자주 함께 식사하는 동료를 친구로 등록하면 투표나 룰렛 진행 시 한 번에 초대할 수 있습니다.",
        renderPreview: () => (
          <div className="flex h-36 w-full flex-col justify-center gap-2 rounded-xl border border-black/10 bg-slate-50 p-4">
            <div className="text-xs font-bold text-ink">친구 목록 빠른 선택</div>
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-full border border-primary bg-primary-light px-2.5 py-1 text-xs font-semibold text-primary-dark">
                김철수 ✓
              </span>
              <span className="rounded-full border border-primary bg-primary-light px-2.5 py-1 text-xs font-semibold text-primary-dark">
                이영희 ✓
              </span>
              <span className="rounded-full border border-black/10 bg-white px-2.5 py-1 text-xs font-medium text-ink-soft">
                + 새 친구 추가
              </span>
            </div>
            <div className="text-[10px] text-ink-soft">초대된 사용자에게 실시간 알림이 전송됩니다.</div>
          </div>
        ),
      },
    ],
  },
  {
    id: "minigame",
    tabLabel: "미니게임",
    title: "점심 미니게임 (4종)",
    summary: "점심값이나 후식 내기, 자리/팀 배치를 위한 4가지 미니게임을 제공합니다.",
    tip: "회사 가입자 검색, 친구 목록, 직접 입력을 통해 참가자를 손쉽게 등록할 수 있습니다.",
    items: [
      {
        label: "사다리타기",
        description: "참가자와 당첨 항목(예: 커피 쏘기, 밥값 내기 등)을 설정하고 사다리를 타고 내려가 결과를 확인합니다.",
        renderPreview: () => (
          <div className="flex h-36 w-full flex-col justify-between rounded-xl border border-black/10 bg-slate-50 p-3">
            <div className="flex justify-around text-xs font-bold text-ink">
              <span>철수</span>
              <span>영희</span>
              <span>민수</span>
            </div>
            <div className="flex justify-around py-1">
              <div className="relative h-12 w-0.5 bg-slate-300">
                <div className="absolute left-0 top-3 h-0.5 w-14 bg-slate-300" />
              </div>
              <div className="relative h-12 w-0.5 bg-slate-300">
                <div className="absolute left-0 top-7 h-0.5 w-14 bg-slate-300" />
              </div>
              <div className="h-12 w-0.5 bg-slate-300" />
            </div>
            <div className="flex justify-around text-xs font-semibold">
              <span className="text-ink-soft">통과</span>
              <span className="font-bold text-primary-dark">커피 당첨</span>
              <span className="text-ink-soft">통과</span>
            </div>
          </div>
        ),
      },
      {
        label: "제비뽑기 & 룰렛",
        description: "인원수만큼 생성된 제비를 하나씩 뽑거나 원형 룰렛을 돌려 무작위로 당첨자를 결정합니다.",
        renderPreview: () => (
          <div className="flex h-36 w-full items-center justify-around rounded-xl border border-black/10 bg-slate-50 p-4">
            <div className="flex h-16 w-14 items-center justify-center rounded-lg border border-black/10 bg-white text-xs font-medium text-ink-soft shadow-xs">
              제비 1
            </div>
            <div className="flex h-16 w-14 items-center justify-center rounded-lg border-2 border-primary bg-primary-light text-xs font-bold text-primary-dark shadow-md animate-pulse">
              당첨!
            </div>
            <div className="flex h-16 w-14 items-center justify-center rounded-lg border border-black/10 bg-white text-xs font-medium text-ink-soft shadow-xs">
              제비 3
            </div>
            <div className="flex h-16 w-14 items-center justify-center rounded-lg border border-black/10 bg-white text-xs font-medium text-ink-soft shadow-xs">
              제비 4
            </div>
          </div>
        ),
      },
      {
        label: "팀 나누기",
        description: "등록된 인원을 원하는 팀 수에 맞추어 무작위로 균등하게 배정합니다.",
        renderPreview: () => (
          <div className="flex h-36 w-full items-center gap-3 rounded-xl border border-black/10 bg-slate-50 p-3.5">
            <div className="flex-1 rounded-lg border border-black/10 bg-white p-2.5 shadow-xs">
              <div className="text-xs font-bold text-primary-dark">A팀 (2명)</div>
              <div className="mt-1 text-xs font-medium text-ink">김철수, 이영희</div>
            </div>
            <div className="text-xs font-bold text-ink-soft">VS</div>
            <div className="flex-1 rounded-lg border border-black/10 bg-white p-2.5 shadow-xs">
              <div className="text-xs font-bold text-ink">B팀 (2명)</div>
              <div className="mt-1 text-xs font-medium text-ink">박민수, 정지훈</div>
            </div>
          </div>
        ),
      },
    ],
  },
  {
    id: "calendar_favorite",
    tabLabel: "식사 기록 및 즐겨찾기",
    title: "식사 캘린더 및 즐겨찾기",
    summary: "방문했던 식당을 캘린더에 기록하고, 단골 식당을 즐겨찾기로 모아보며 비플페이 투표에 참여할 수 있습니다.",
    items: [
      {
        label: "월별 식사 캘린더",
        description: "식당 상세 카드의 '오늘 여기서 먹었어요' 버튼을 누르거나 캘린더 날짜를 클릭하여 식사 내역을 기록/수정할 수 있습니다.",
        renderPreview: () => (
          <div className="flex h-36 w-full flex-col justify-between rounded-xl border border-black/10 bg-white p-3">
            <div className="flex justify-between text-xs font-bold text-ink">
              <span>2026년 8월 식사 캘린더</span>
              <span className="text-[10px] font-semibold text-primary-dark">기록 8회</span>
            </div>
            <div className="grid grid-cols-5 gap-1.5 text-center text-xs">
              <div className="rounded-lg bg-slate-50 p-1">
                <div className="text-[9px] text-ink-soft">17(월)</div>
                <div className="text-[10px] font-semibold text-ink">돈까스</div>
              </div>
              <div className="rounded-lg border border-primary/30 bg-primary-light p-1">
                <div className="text-[9px] font-bold text-primary-dark">18(화)</div>
                <div className="text-[10px] font-bold text-primary-dark">찌개마을</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-1">
                <div className="text-[9px] text-ink-soft">19(수)</div>
                <div className="text-[10px] text-ink-soft">-</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-1">
                <div className="text-[9px] text-ink-soft">20(목)</div>
                <div className="text-[10px] text-ink-soft">-</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-1">
                <div className="text-[9px] text-ink-soft">21(금)</div>
                <div className="text-[10px] text-ink-soft">-</div>
              </div>
            </div>
          </div>
        ),
      },
      {
        label: "즐겨찾기 (북마크) & 비플페이 투표",
        description: "식당 카드의 하트(❤️) 버튼으로 즐겨찾기에 등록하고, '비플페이 되나요?'에서 👍/👎 투표로 결제 가능 여부를 공유합니다.",
        renderPreview: () => (
          <div className="flex h-36 w-full flex-col justify-center gap-2 rounded-xl border border-black/10 bg-slate-50 p-3.5">
            <div className="flex items-center justify-between rounded-lg bg-white p-2 shadow-xs">
              <span className="text-xs font-bold text-ink">❤️ 즐겨찾는 식당 등록됨</span>
              <span className="text-[10px] text-ink-soft">상단 '즐겨찾기' 필터로 조회</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-white p-2 shadow-xs">
              <span className="text-xs text-ink-soft">비플페이 되나요?</span>
              <div className="flex gap-1">
                <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-white">
                  👍 12
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-ink-soft">
                  👎 0
                </span>
              </div>
            </div>
          </div>
        ),
      },
    ],
  },
  {
    id: "add_report",
    tabLabel: "식당 등록 및 수정 요청",
    title: "식당 직접 추가 및 정보 수정",
    summary: "새로운 식당을 네이버 검색 연동으로 직접 등록하거나, 잘못된 식당 정보를 수정 요청할 수 있습니다.",
    tip: "사용자가 등록한 식당은 동일 회사의 모든 동료들에게 함께 공유됩니다.",
    items: [
      {
        label: "여기 없는 식당 직접 추가하기",
        description: "주변 식당 목록 상단의 '+ 여기 없는 식당 직접 추가하기' 버튼을 누르고 식당명을 검색하면 네이버 플레이스 정보가 자동 연동되어 등록됩니다.",
        renderPreview: () => (
          <div className="flex h-36 w-full flex-col justify-center gap-2 rounded-xl border border-black/10 bg-slate-50 p-4">
            <div className="flex items-center gap-1.5">
              <span className="flex-1 rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs text-ink shadow-xs">
                새 식당 이름 검색
              </span>
              <span className="rounded-lg bg-ink px-3 py-1.5 text-xs font-bold text-white">
                검색
              </span>
            </div>
            <div className="rounded-lg border border-primary/20 bg-primary-light px-3 py-1.5 text-xs font-medium text-primary-dark">
              네이버 장소 정보(위치, 영업시간, 대표메뉴) 자동 수집
            </div>
          </div>
        ),
      },
      {
        label: "정보수정요청 접수",
        description: "식당 상세 카드의 '정보수정요청' 버튼으로 폐업, 영업시간 변경, 위치 수정 등을 제보할 수 있습니다.",
        renderPreview: () => (
          <div className="flex h-36 w-full flex-col justify-center gap-2 rounded-xl border border-black/10 bg-white p-4">
            <div className="flex items-center justify-between text-xs font-bold text-ink">
              <span>정보수정요청 내역</span>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                대기중
              </span>
            </div>
            <div className="text-xs text-ink-soft">
              영업시간 변경: 11:30 ~ 21:00 → 11:00 ~ 21:00
            </div>
            <div className="text-[10px] text-ink-soft">관리자 확인 후 반영됩니다.</div>
          </div>
        ),
      },
    ],
  },
];

export default function UserGuideModal({ open, onClose }: UserGuideModalProps) {
  const [activeTab, setActiveTab] = useState(GUIDE_SECTIONS[0].id);
  const [selectedItemIndex, setSelectedItemIndex] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  if (!open) return null;

  const currentSection = GUIDE_SECTIONS.find((s) => s.id === activeTab) || GUIDE_SECTIONS[0];
  const currentItem = currentSection.items[selectedItemIndex] || currentSection.items[0];

  function handleTabChange(tabId: string) {
    setActiveTab(tabId);
    setSelectedItemIndex(0);
  }

  function handleClose() {
    onClose(dontShowAgain);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="flex h-[720px] max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-black/10 bg-surface shadow-2xl md:max-w-4xl">
        {/* 상단 헤더 */}
        <div className="flex items-center justify-between border-b border-black/10 px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-xs font-bold text-white">
              ?
            </span>
            <h2 className="text-base font-bold text-ink">사용 가이드</h2>
          </div>
          <button
            onClick={handleClose}
            aria-label="닫기"
            className="rounded-lg p-1 text-ink-soft transition hover:bg-surface-muted hover:text-ink"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 본문 영역: 좌측 탭 + 우측 상세 */}
        <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
          {/* 좌측 탭 목록 */}
          <div className="flex shrink-0 overflow-x-auto border-b border-black/5 bg-surface-muted/40 p-2 md:w-56 md:flex-col md:overflow-y-auto md:border-b-0 md:border-r md:p-3">
            {GUIDE_SECTIONS.map((section) => {
              const isActive = section.id === activeTab;
              return (
                <button
                  key={section.id}
                  onClick={() => handleTabChange(section.id)}
                  className={[
                    "whitespace-nowrap rounded-xl px-3 py-2.5 text-left text-xs font-medium transition md:text-sm",
                    isActive
                      ? "bg-surface font-semibold text-ink shadow-xs border border-black/5"
                      : "text-ink-soft hover:bg-surface/60 hover:text-ink",
                  ].join(" ")}
                >
                  {section.tabLabel}
                </button>
              );
            })}
          </div>

          {/* 우측 상세 설명 패널 */}
          <div
            key={activeTab}
            className="flex-1 overflow-y-auto p-6 animate-in fade-in-50 slide-in-from-bottom-2 duration-300 fill-mode-both"
          >
            {/* 섹터 제목 */}
            <div className="mb-4">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-primary" />
                <h3 className="text-lg font-bold text-ink">{currentSection.title}</h3>
              </div>
              <p className="mt-1 text-xs text-ink-soft md:text-sm">{currentSection.summary}</p>
            </div>

            {/* 상단 인터랙티브 프리뷰 박스 */}
            <div className="mb-5">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-semibold text-ink-soft">
                  화면 예시: <strong className="text-ink">{currentItem.label}</strong>
                </span>
                <span className="text-[10px] text-ink-soft">아래 항목을 클릭하면 해당 화면 예시로 전환됩니다</span>
              </div>
              <div
                key={`${activeTab}-${selectedItemIndex}`}
                className="animate-in fade-in zoom-in-95 duration-200 fill-mode-both"
              >
                {currentItem.renderPreview()}
              </div>
            </div>

            {/* 항목 선택 카드 리스트 */}
            <div className="space-y-2.5">
              {currentSection.items.map((item, idx) => {
                const isSelected = idx === selectedItemIndex;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setSelectedItemIndex(idx)}
                    className={[
                      "w-full rounded-xl p-3.5 text-left transition-all duration-200",
                      isSelected
                        ? "border-2 border-primary bg-primary-light/40 shadow-xs"
                        : "border border-black/5 bg-surface-muted/30 hover:border-black/15 hover:bg-surface-muted/60",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between">
                      <div className={[
                        "text-xs font-bold md:text-sm",
                        isSelected ? "text-primary-dark" : "text-ink"
                      ].join(" ")}>
                        {item.label}
                      </div>
                      {isSelected && (
                        <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          예시 표시중
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs leading-relaxed text-ink-soft md:text-sm">
                      {item.description}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* TIP 박스 */}
            {currentSection.tip && (
              <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-primary-light/60 p-3.5 text-xs text-primary-dark md:text-sm border border-primary/10">
                <span className="shrink-0 font-bold uppercase tracking-wider text-[11px] bg-primary-dark/10 px-1.5 py-0.5 rounded">
                  TIP
                </span>
                <span className="leading-relaxed">{currentSection.tip}</span>
              </div>
            )}
          </div>
        </div>

        {/* 하단 푸터 */}
        <div className="flex items-center justify-between border-t border-black/10 bg-surface-muted/30 px-6 py-3.5">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-ink-soft select-none hover:text-ink">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="h-4 w-4 rounded border-black/20 text-ink focus:ring-ink"
            />
            <span>다시 보지 않기</span>
          </label>
          <button
            onClick={handleClose}
            className="rounded-xl bg-ink px-5 py-2 text-xs font-semibold text-white transition hover:bg-black"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
