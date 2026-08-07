"use client";

import { useEffect, useMemo, useState } from "react";
import type { RestaurantSummary } from "@/types";
import { getCategoryVisual } from "@/lib/restaurant-category";

export interface MealLogEntry {
  id: string;
  date: string; // "YYYY-MM-DD"
  restaurantId: string | null;
  restaurantName: string;
  category: string | null;
  memo: string;
  createdAt: string;
  updatedAt: string;
}

interface MealLogCalendarProps {
  companyCode: string;
  restaurants: RestaurantSummary[]; // 날짜 편집 모달에서 "기존 식당 검색해서 선택"할 때 씀
  onNotify?: (message: string) => void;
  // 식당 상세모달의 "오늘 여기서 먹었어요" 버튼처럼, 캘린더 바깥에서 기록이 바뀌었을 때
  // 이 값이 바뀌면(=올라가면) 지금 보고 있는 달을 다시 불러온다 - MapView의 homeSignal과
  // 같은 "카운터를 신호로 쓰는" 패턴.
  refreshSignal?: number;
}

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toYearMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(d: Date): string {
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
}

function formatDayLabel(dateKey: string): string {
  const [, m, d] = dateKey.split("-");
  return `${Number(m)}월 ${Number(d)}일`;
}

interface CalendarCell {
  dateKey: string;
  day: number;
}

// 이번 달 그리드 - 저번/다음 달로 넘어가는 앞뒤 칸은 비워둔다. 개인용 기록 캘린더라 "이번 달"이라는
// 경계가 분명한 쪽이 낫다고 판단해서 앞뒤 달 날짜까지 채우는 방식은 쓰지 않았다.
function buildMonthGrid(monthCursor: Date): (CalendarCell | null)[] {
  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (CalendarCell | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = toDateKey(new Date(year, month, day));
    cells.push({ dateKey, day });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

// 2026-08-06 저녁 신규: "내가 언제 어디서 밥 먹었는지" 기록하는 캘린더뷰. 주변식당 목록 아래,
// 같은 스크롤 영역에 이어서 렌더링된다(RestaurantList.tsx의 mealLogSection 참고 - 패널을
// 절반으로 나누는 게 아니라 그냥 목록 다음에 이어붙는 방식).
// 하루에 여러 건 기록할 수 있다(회식 등으로 하루 두 끼 이상 기록하는 경우 대응) - 날짜를
// 클릭하면 그날의 기록 목록 + 추가/수정/삭제를 한 모달에서 처리한다.
export default function MealLogCalendar({
  companyCode,
  restaurants,
  onNotify,
  refreshSignal,
}: MealLogCalendarProps) {
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [logsByDate, setLogsByDate] = useState<Map<string, MealLogEntry[]>>(new Map());
  const [loading, setLoading] = useState(false);
  const [editingDate, setEditingDate] = useState<string | null>(null);

  const todayKey = useMemo(() => toDateKey(new Date()), []);
  const cells = useMemo(() => buildMonthGrid(monthCursor), [monthCursor]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(
      `/api/meal-logs?companyCode=${encodeURIComponent(companyCode)}&month=${toYearMonth(monthCursor)}`
    )
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const map = new Map<string, MealLogEntry[]>();
        (data.logs ?? []).forEach((log: MealLogEntry) => {
          const list = map.get(log.date) ?? [];
          list.push(log);
          map.set(log.date, list);
        });
        setLogsByDate(map);
      })
      .catch(() => {
        if (!cancelled) onNotify?.("밥 먹은 기록을 불러오지 못했어요.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyCode, monthCursor, refreshSignal]);

  function goToPrevMonth() {
    setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  }

  function goToNextMonth() {
    setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  }

  function goToToday() {
    const now = new Date();
    setMonthCursor(new Date(now.getFullYear(), now.getMonth(), 1));
  }

  // 날짜별 편집 모달에서 그 날 기록이 바뀌면(추가/수정/삭제) 이 콜백으로 전체 목록을 통째로 받아
  // logsByDate를 갱신한다 - 부분 patch보다 단순하고 항상 서버 상태와 일관된다.
  function handleDateEntriesChanged(dateKey: string, entries: MealLogEntry[]) {
    setLogsByDate((prev) => {
      const next = new Map(prev);
      if (entries.length === 0) next.delete(dateKey);
      else next.set(dateKey, entries);
      return next;
    });
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            onClick={goToPrevMonth}
            aria-label="이전 달"
            className="rounded-full p-1.5 text-ink-soft transition hover:bg-surface-muted"
          >
            ‹
          </button>
          <p className="w-24 text-center text-sm font-semibold text-ink">
            {formatMonthLabel(monthCursor)}
          </p>
          <button
            onClick={goToNextMonth}
            aria-label="다음 달"
            className="rounded-full p-1.5 text-ink-soft transition hover:bg-surface-muted"
          >
            ›
          </button>
        </div>
        <button
          onClick={goToToday}
          className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-ink-soft transition hover:bg-primary-light hover:text-primary-dark"
        >
          오늘
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-ink-soft">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="py-1">
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell, i) => {
          if (!cell) return <div key={`blank-${i}`} />;
          const entries = logsByDate.get(cell.dateKey) ?? [];
          const first = entries[0];
          const visual = first ? getCategoryVisual(first.category) : null;
          const isToday = cell.dateKey === todayKey;
          return (
            <button
              key={cell.dateKey}
              onClick={() => setEditingDate(cell.dateKey)}
              title={
                entries.length > 0
                  ? entries.map((e) => e.restaurantName).join(", ")
                  : undefined
              }
              className={[
                "relative flex aspect-square flex-col items-center justify-start gap-0.5 rounded-lg px-0.5 py-1 text-xs transition hover:bg-surface-muted",
                isToday ? "ring-1 ring-inset ring-primary" : "",
              ].join(" ")}
            >
              <span className={isToday ? "font-bold text-primary" : "text-ink"}>{cell.day}</span>
              {first && (
                <>
                  <span className="text-sm leading-none">{visual!.emoji}</span>
                  <span className="w-full truncate text-[9px] leading-none text-ink-soft">
                    {first.restaurantName}
                  </span>
                  {entries.length > 1 && (
                    <span className="absolute right-0.5 top-0.5 rounded-full bg-primary px-1 text-[8px] font-bold leading-tight text-white">
                      +{entries.length - 1}
                    </span>
                  )}
                </>
              )}
            </button>
          );
        })}
      </div>

      {loading && <p className="mt-2 text-center text-xs text-ink-soft">불러오는 중...</p>}
      {!loading && logsByDate.size === 0 && (
        <p className="mt-3 text-center text-xs text-ink-soft">
          이번 달 기록이 아직 없어요. 날짜를 눌러서 남겨보세요.
        </p>
      )}

      {editingDate && (
        <MealLogDayModal
          companyCode={companyCode}
          dateKey={editingDate}
          entries={logsByDate.get(editingDate) ?? []}
          restaurants={restaurants}
          onClose={() => setEditingDate(null)}
          onEntriesChanged={(entries) => handleDateEntriesChanged(editingDate, entries)}
          onNotify={onNotify}
        />
      )}
    </div>
  );
}

interface MealLogDayModalProps {
  companyCode: string;
  dateKey: string;
  entries: MealLogEntry[];
  restaurants: RestaurantSummary[];
  onClose: () => void;
  onEntriesChanged: (entries: MealLogEntry[]) => void;
  onNotify?: (message: string) => void;
}

// 하루치 기록을 보고/추가하고/고치는 모달. "직접 추가" 모달과 동일한 fixed inset-0 오버레이
// 패턴을 따른다. 하루에 여러 건 기록할 수 있어서(회식 등), 먼저 그 날 기록 목록을 보여주고,
// "+ 기록 추가"를 누르면 새 기록용 폼이 뜨거나, 기존 기록의 "수정"을 누르면 같은 폼에 그 값이
// 채워진다. 식당은 검색해서 고르거나(LunchVoteModal과 동일한 방식) 목록에 없으면 이름을 그냥
// 입력해도 된다.
function MealLogDayModal({
  companyCode,
  dateKey,
  entries,
  restaurants,
  onClose,
  onEntriesChanged,
  onNotify,
}: MealLogDayModalProps) {
  const [localEntries, setLocalEntries] = useState<MealLogEntry[]>(entries);
  const [formOpen, setFormOpen] = useState(entries.length === 0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [pickedRestaurant, setPickedRestaurant] = useState<RestaurantSummary | null>(null);
  const [memo, setMemo] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const suggestions = useMemo(() => {
    const q = nameInput.trim().toLowerCase();
    if (!q || pickedRestaurant?.name === nameInput) return [];
    return restaurants.filter((r) => r.name.toLowerCase().includes(q)).slice(0, 8);
  }, [nameInput, restaurants, pickedRestaurant]);

  function pickSuggestion(r: RestaurantSummary) {
    setPickedRestaurant(r);
    setNameInput(r.name);
  }

  function handleNameChange(value: string) {
    setNameInput(value);
    if (pickedRestaurant && pickedRestaurant.name !== value) setPickedRestaurant(null);
  }

  function openNewForm() {
    setEditingId(null);
    setNameInput("");
    setPickedRestaurant(null);
    setMemo("");
    setFormOpen(true);
  }

  function openEditForm(entry: MealLogEntry) {
    setEditingId(entry.id);
    setNameInput(entry.restaurantName);
    setPickedRestaurant(
      entry.restaurantId ? restaurants.find((r) => r.id === entry.restaurantId) ?? null : null
    );
    setMemo(entry.memo);
    setFormOpen(true);
  }

  async function handleSave() {
    const trimmed = nameInput.trim();
    if (!trimmed) {
      onNotify?.("식당 이름을 입력해줘.");
      return;
    }
    setSaving(true);
    try {
      const usePicked = pickedRestaurant && pickedRestaurant.name === trimmed;
      const restaurantId = usePicked ? pickedRestaurant!.id : null;
      const category = usePicked ? pickedRestaurant!.category ?? null : null;

      if (editingId) {
        const res = await fetch("/api/meal-logs", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyCode,
            id: editingId,
            restaurantId,
            restaurantName: trimmed,
            category,
            memo: memo.trim(),
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          onNotify?.(data.error ?? "기록을 저장하지 못했어요.");
          return;
        }
        const updated = localEntries.map((e) =>
          e.id === editingId
            ? { ...e, restaurantId, restaurantName: trimmed, category, memo: memo.trim() }
            : e
        );
        setLocalEntries(updated);
        onEntriesChanged(updated);
      } else {
        const res = await fetch("/api/meal-logs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyCode,
            date: dateKey,
            restaurantId,
            restaurantName: trimmed,
            category,
            memo: memo.trim(),
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          onNotify?.(data.error ?? "기록을 저장하지 못했어요.");
          return;
        }
        const updated = [...localEntries, data.log as MealLogEntry];
        setLocalEntries(updated);
        onEntriesChanged(updated);
      }
      onNotify?.(`${formatDayLabel(dateKey)} 기록을 저장했어요.`);
      setFormOpen(false);
    } catch {
      onNotify?.("네트워크 오류로 저장하지 못했어요.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch("/api/meal-logs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyCode, id }),
      });
      if (!res.ok) {
        onNotify?.("기록을 삭제하지 못했어요.");
        return;
      }
      const updated = localEntries.filter((e) => e.id !== id);
      setLocalEntries(updated);
      onEntriesChanged(updated);
      onNotify?.(`${formatDayLabel(dateKey)} 기록을 삭제했어요.`);
    } catch {
      onNotify?.("네트워크 오류로 삭제하지 못했어요.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-sm flex-col gap-3 overflow-y-auto rounded-xl2 bg-surface p-5 shadow-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-ink">{formatDayLabel(dateKey)}</h3>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="rounded-full p-1 text-ink-soft transition hover:bg-surface-muted"
          >
            ✕
          </button>
        </div>

        {localEntries.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {localEntries.map((entry) => {
              const visual = getCategoryVisual(entry.category);
              return (
                <li
                  key={entry.id}
                  className="flex items-start justify-between gap-2 rounded-xl border border-black/10 p-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
                      <span>{visual.emoji}</span>
                      <span className="truncate">{entry.restaurantName}</span>
                    </p>
                    {entry.memo && <p className="mt-0.5 text-xs text-ink-soft">{entry.memo}</p>}
                  </div>
                  <div className="flex shrink-0 gap-1 text-xs">
                    <button
                      onClick={() => openEditForm(entry)}
                      className="rounded-lg px-1.5 py-1 text-ink-soft transition hover:bg-surface-muted"
                    >
                      수정
                    </button>
                    <button
                      onClick={() => handleDelete(entry.id)}
                      disabled={deletingId === entry.id}
                      className="rounded-lg px-1.5 py-1 text-primary-dark transition hover:bg-surface-muted disabled:opacity-60"
                    >
                      삭제
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {!formOpen && (
          <button
            onClick={openNewForm}
            className="w-full rounded-xl2 border border-dashed border-black/15 px-3 py-2 text-sm font-medium text-ink-soft transition hover:border-primary hover:text-primary"
          >
            + {localEntries.length > 0 ? "이 날 기록 추가" : "기록 남기기"}
          </button>
        )}

        {formOpen && (
          <div className="flex flex-col gap-3 border-t border-black/5 pt-3">
            <div className="relative">
              <label className="mb-1.5 block text-xs font-semibold text-ink-soft">
                어디서 먹었어요?
              </label>
              <input
                value={nameInput}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="식당 이름 검색 또는 직접 입력"
                autoFocus
                className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-primary"
              />
              {suggestions.length > 0 && (
                <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-40 overflow-y-auto rounded-xl border border-black/10 bg-surface p-1.5 shadow-soft">
                  {suggestions.map((r) => (
                    <li key={r.id}>
                      <button
                        onClick={() => pickSuggestion(r)}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-ink transition hover:bg-primary-light hover:text-primary-dark"
                      >
                        <span className="min-w-0 flex-1 truncate">{r.name}</span>
                        <span className="shrink-0 rounded-full bg-surface-muted px-1.5 py-0.5 text-[10px] text-ink-soft">
                          {getCategoryVisual(r.category, r.categoryLabel).label}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-ink-soft">메모 (선택)</label>
              <textarea
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                rows={2}
                placeholder="예: 팀 회식, 매웠음, 다음엔 곱빼기로"
                className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving || !nameInput.trim()}
                className="flex-1 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:opacity-60"
              >
                {saving ? "저장하는 중..." : editingId ? "수정 저장" : "추가"}
              </button>
              <button
                onClick={() => setFormOpen(false)}
                className="rounded-xl px-3 py-2 text-sm text-ink-soft hover:bg-surface-muted"
              >
                취소
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
