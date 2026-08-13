"use client";

import { useState, useEffect } from "react";
import type { RestaurantSummary } from "@/types";
import { CATEGORY_LABELS } from "@/lib/restaurant-category";

interface AdminDirectEditModalProps {
  open: boolean;
  companyCode: string;
  restaurant: RestaurantSummary;
  onClose: () => void;
  onSuccess: (updated: RestaurantSummary) => void;
  onNotify?: (message: string) => void;
}

function businessHoursToText(raw: unknown): string {
  if (!raw) return "";
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === "string") return item;
        if (typeof item === "object" && item !== null) {
          const o = item as Record<string, unknown>;
          const day = (o.day ?? o.dayOfWeek ?? o.label ?? o.name ?? "") as string;
          const time = (o.time ?? o.hours ?? o.businessHours ?? "") as string;
          return day && time ? `${day} ${time}` : day || time;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export default function AdminDirectEditModal({
  open,
  companyCode,
  restaurant,
  onClose,
  onSuccess,
  onNotify,
}: AdminDirectEditModalProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [businessHours, setBusinessHours] = useState("");
  const [categoryLabel, setCategoryLabel] = useState("");
  const [facilities, setFacilities] = useState("");
  const [paymentMethods, setPaymentMethods] = useState("");
  const [isZeroPay, setIsZeroPay] = useState(false);
  const [naverPlaceUrl, setNaverPlaceUrl] = useState("");
  const [discountBenefit, setDiscountBenefit] = useState("");
  const [discountNote, setDiscountNote] = useState("");
  const [menus, setMenus] = useState<Array<{ name: string; price: string; description?: string }>>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!restaurant) return;
    setName(restaurant.displayName || restaurant.name || "");
    setPhone(restaurant.phone || "");
    setBusinessHours(businessHoursToText(restaurant.businessHours));
    setCategoryLabel(restaurant.categoryLabel || "");
    setFacilities((restaurant.facilities || []).join(", "));
    setPaymentMethods((restaurant.paymentMethods || []).join(", "));
    setIsZeroPay(Boolean(restaurant.isZeroPay));
    setNaverPlaceUrl(restaurant.naverPlaceUrl || "");
    setDiscountBenefit(restaurant.discountInfo?.benefit || "");
    setDiscountNote(restaurant.discountInfo?.note || "");
    setMenus(
      (restaurant.menus || []).map((m) => ({
        name: m.name,
        price: m.price || "",
        description: m.description || "",
      }))
    );
    setError(null);
  }, [restaurant, open]);

  if (!open) return null;

  function handleAddMenu() {
    setMenus((prev) => [...prev, { name: "", price: "", description: "" }]);
  }

  function handleRemoveMenu(index: number) {
    setMenus((prev) => prev.filter((_, i) => i !== index));
  }

  function handleMenuChange(index: number, field: "name" | "price" | "description", val: string) {
    setMenus((prev) =>
      prev.map((m, i) => (i === index ? { ...m, [field]: val } : m))
    );
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("가맹점명을 입력해 주세요.");
      return;
    }

    setSaving(true);
    setError(null);

    const validMenus = menus
      .filter((m) => m.name.trim().length > 0)
      .map((m) => ({
        name: m.name.trim(),
        price: m.price.trim(),
        description: m.description?.trim() || undefined,
      }));

    const updatePayload = {
      name: name.trim(),
      naverMatchedName: name.trim(),
      phone: phone.trim() || null,
      businessHours: businessHours.trim() || null,
      categoryLabel: categoryLabel || null,
      facilities: facilities
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      paymentMethods: paymentMethods
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      isZeroPay,
      naverPlaceUrl: naverPlaceUrl.trim() || null,
      discountInfo:
        discountBenefit.trim() || discountNote.trim()
          ? { benefit: discountBenefit.trim(), note: discountNote.trim() }
          : null,
      menus: validMenus,
    };

    try {
      const res = await fetch("/api/admin/restaurants", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyCode,
          restaurantId: restaurant.id,
          update: updatePayload,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "수정하지 못했습니다.");
        return;
      }

      onSuccess(data.restaurant);
      onNotify?.(`[${data.restaurant.name}] 가맹점 정보가 즉시 수정되었습니다.`);
      onClose();
    } catch {
      setError("네트워크 오류로 수정하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl2 bg-surface p-6 shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-black/10 pb-3">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-primary-light px-2 py-0.5 text-xs font-bold text-primary-dark">
              관리자 전용
            </span>
            <h2 className="text-base font-bold text-ink">가맹점 정보 직접 수정</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-ink-soft hover:bg-surface-muted"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSave} className="mt-4 flex flex-col gap-4 text-sm">
          {error && <p className="rounded-lg bg-red-50 p-2.5 text-xs text-red-600 font-medium">{error}</p>}

          <div>
            <label className="block text-xs font-semibold text-ink mb-1">가맹점명</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-black/15 p-2.5 outline-none focus:border-primary"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-ink mb-1">전화번호</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="예: 02-2676-5323"
                className="w-full rounded-xl border border-black/15 p-2.5 outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink mb-1">카테고리</label>
              <select
                value={categoryLabel}
                onChange={(e) => setCategoryLabel(e.target.value)}
                className="w-full rounded-xl border border-black/15 p-2.5 outline-none focus:border-primary"
              >
                <option value="">선택 안 함</option>
                {CATEGORY_LABELS.map((lbl) => (
                  <option key={lbl} value={lbl}>
                    {lbl}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-ink mb-1">영업시간</label>
            <textarea
              value={businessHours}
              onChange={(e) => setBusinessHours(e.target.value)}
              rows={3}
              placeholder="예: 월~금: 07:30 - 21:00 (20:05 라스트오더)&#10;정기휴무: 매달 3번째 일요일"
              className="w-full rounded-xl border border-black/15 p-2.5 text-xs outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-ink mb-1">네이버 Place URL</label>
            <input
              type="text"
              value={naverPlaceUrl}
              onChange={(e) => setNaverPlaceUrl(e.target.value)}
              placeholder="https://map.naver.com/p/entry/place/37778669"
              className="w-full rounded-xl border border-black/15 p-2.5 text-xs outline-none focus:border-primary"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-ink mb-1">편의시설 (쉼표 구분)</label>
              <input
                type="text"
                value={facilities}
                onChange={(e) => setFacilities(e.target.value)}
                placeholder="포장, 단체 이용 가능"
                className="w-full rounded-xl border border-black/15 p-2.5 text-xs outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink mb-1">결제수단 (쉼표 구분)</label>
              <input
                type="text"
                value={paymentMethods}
                onChange={(e) => setPaymentMethods(e.target.value)}
                placeholder="제로페이, 신용카드"
                className="w-full rounded-xl border border-black/15 p-2.5 text-xs outline-none focus:border-primary"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-xl bg-surface-muted p-3">
            <input
              type="checkbox"
              id="isZeroPayAdmin"
              checked={isZeroPay}
              onChange={(e) => setIsZeroPay(e.target.checked)}
              className="h-4 w-4 rounded text-primary focus:ring-primary"
            />
            <label htmlFor="isZeroPayAdmin" className="text-xs font-semibold text-ink cursor-pointer">
              제로페이 가맹점 여부 (체크 시 메인 화면 제로페이 가능 표출)
            </label>
          </div>

          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
            <label className="block text-xs font-semibold text-emerald-900 mb-1.5">🎁 사내 제휴 혜택</label>
            <div className="flex flex-col gap-2">
              <input
                type="text"
                value={discountBenefit}
                onChange={(e) => setDiscountBenefit(e.target.value)}
                placeholder="혜택 내용 (예: 전체 메뉴 10% 할인)"
                className="w-full rounded-lg border border-emerald-300 p-2 text-xs outline-none focus:border-emerald-500"
              />
              <input
                type="text"
                value={discountNote}
                onChange={(e) => setDiscountNote(e.target.value)}
                placeholder="안내 사항 (예: 사원증 제시 필수)"
                className="w-full rounded-lg border border-emerald-300 p-2 text-xs outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-ink">메뉴 목록</label>
              <button
                type="button"
                onClick={handleAddMenu}
                className="rounded-lg bg-surface-muted px-2 py-1 text-xs font-medium text-ink hover:bg-black/10"
              >
                + 메뉴 추가
              </button>
            </div>

            <div className="flex flex-col gap-2 max-h-48 overflow-y-auto p-1">
              {menus.map((m, idx) => (
                <div key={idx} className="flex items-center gap-2 rounded-xl bg-surface-muted p-2">
                  <input
                    type="text"
                    value={m.name}
                    onChange={(e) => handleMenuChange(idx, "name", e.target.value)}
                    placeholder="메뉴명"
                    className="flex-1 rounded-lg border border-black/10 p-1.5 text-xs outline-none"
                  />
                  <input
                    type="text"
                    value={m.price}
                    onChange={(e) => handleMenuChange(idx, "price", e.target.value)}
                    placeholder="가격"
                    className="w-24 rounded-lg border border-black/10 p-1.5 text-xs outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveMenu(idx)}
                    className="text-red-500 hover:text-red-700 px-1 text-sm font-bold"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl bg-surface-muted py-2.5 text-sm font-medium text-ink hover:bg-black/10"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-bold text-white transition hover:bg-primary-dark disabled:opacity-50"
            >
              {saving ? "저장 중..." : "즉시 변경 저장"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
