"use client";

import { useState } from "react";
import {
  EDIT_REQUEST_TYPES,
  EDIT_REQUEST_TYPE_LABELS,
  EDIT_REQUEST_REQUIRES_VALUE,
  type EditRequestType,
  type EditRequestPayload,
} from "@/lib/restaurant-edit-request";
import { CATEGORY_LABELS } from "@/lib/restaurant-category";

interface EditRequestModalProps {
  open: boolean;
  companyCode: string;
  restaurantId: string;
  restaurantName: string;
  onClose: () => void;
  onSubmitted: () => void; // 제출 성공 - 부모가 "내가 보낸 요청" 목록을 다시 불러오게 신호
  onNotify?: (message: string) => void;
}

// 2026-08-09 신규: "가맹점 정보 수정요청" 폼. 자유 텍스트 한 칸이 아니라 유형을 먼저 고르고
// 그 유형에 맞는 입력 필드만 보여준다(restaurant-edit-request.ts 참고 - 관리자가 처리하기 쉽게
// 만들기 위한 설계 결정). 모든 유형에 공통으로 붙일 수 있는 "부가설명"은 항상 아래에 둔다.
export default function EditRequestModal({
  open,
  companyCode,
  restaurantId,
  restaurantName,
  onClose,
  onSubmitted,
  onNotify,
}: EditRequestModalProps) {
  const [type, setType] = useState<EditRequestType>("phone");
  const [phone, setPhone] = useState("");
  const [businessHours, setBusinessHours] = useState("");
  const [categoryLabel, setCategoryLabel] = useState("");
  const [menuName, setMenuName] = useState("");
  const [menuNewPrice, setMenuNewPrice] = useState("");
  const [menuNewDescription, setMenuNewDescription] = useState("");
  const [isClosed, setIsClosed] = useState(true);
  const [newAddress, setNewAddress] = useState("");
  const [isZeroPay, setIsZeroPay] = useState(true);
  const [discountBenefit, setDiscountBenefit] = useState("");
  const [discountNote, setDiscountNote] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  function resetForm() {
    setType("phone");
    setPhone("");
    setBusinessHours("");
    setCategoryLabel("");
    setMenuName("");
    setMenuNewPrice("");
    setMenuNewDescription("");
    setIsClosed(true);
    setNewAddress("");
    setIsZeroPay(true);
    setDiscountBenefit("");
    setDiscountNote("");
    setNote("");
    setError(null);
  }

  function buildPayload(): EditRequestPayload {
    const base: EditRequestPayload = { note: note.trim() || null };
    switch (type) {
      case "phone":
        return { ...base, phone: phone.trim() || null };
      case "businessHours":
        return { ...base, businessHours: businessHours.trim() || null };
      case "category":
        return { ...base, categoryLabel: categoryLabel || null };
      case "menu":
        return {
          ...base,
          menuName: menuName.trim() || null,
          menuNewPrice: menuNewPrice.trim() || null,
          menuNewDescription: menuNewDescription.trim() || null,
        };
      case "closedOrMoved":
        return { ...base, isClosed, newAddress: isClosed ? null : newAddress.trim() || null };
      case "zeroPay":
        return { ...base, isZeroPay };
      case "discount":
        return {
          ...base,
          discountBenefit: discountBenefit.trim() || null,
          discountNote: discountNote.trim() || null,
        };
      case "other":
        return base;
    }
  }

  function hasRequiredValue(): boolean {
    if (!EDIT_REQUEST_REQUIRES_VALUE[type]) return true;
    switch (type) {
      case "phone":
        return phone.trim().length > 0;
      case "businessHours":
        return businessHours.trim().length > 0;
      case "category":
        return categoryLabel.length > 0;
      case "menu":
        return menuName.trim().length > 0;
      case "zeroPay":
        return true; // 라디오라 항상 값이 있음
      case "discount":
        return discountBenefit.trim().length > 0;
      default:
        return true;
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!hasRequiredValue()) {
      setError("이 유형에는 입력값이 필요해요.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/edit-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyCode,
          restaurantId,
          restaurantName,
          type,
          payload: buildPayload(),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "요청을 보내지 못했어요.");
        return;
      }

      onNotify?.("수정 요청을 보냈어요. 관리자가 확인하면 알려드릴게요.");
      resetForm();
      onSubmitted();
      onClose();
    } catch {
      setError("네트워크 오류로 요청을 보내지 못했어요.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-xl2 bg-surface p-5 shadow-soft"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-ink">📝 정보 수정 요청</h3>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="rounded-full p-1 text-ink-soft transition hover:bg-surface-muted"
          >
            ✕
          </button>
        </div>
        <p className="mt-1 text-xs text-ink-soft">{restaurantName}</p>

        <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-ink-soft">무엇이 달라요?</label>
            <div className="flex flex-wrap gap-1.5">
              {EDIT_REQUEST_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={[
                    "rounded-full px-2.5 py-1 text-xs font-medium transition",
                    type === t
                      ? "bg-primary text-white"
                      : "bg-surface-muted text-ink-soft hover:bg-surface-muted/70",
                  ].join(" ")}
                >
                  {EDIT_REQUEST_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          {type === "phone" && (
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="올바른 전화번호 (예: 02-1234-5678)"
              className="rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-primary"
            />
          )}

          {type === "businessHours" && (
            <textarea
              value={businessHours}
              onChange={(e) => setBusinessHours(e.target.value)}
              placeholder="올바른 영업시간 (예: 매일 11:00 - 22:00, 브레이크타임 15:00-17:00)"
              rows={2}
              className="rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-primary"
            />
          )}

          {type === "category" && (
            <select
              value={categoryLabel}
              onChange={(e) => setCategoryLabel(e.target.value)}
              className="rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="">올바른 카테고리를 선택해줘</option>
              {CATEGORY_LABELS.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
          )}

          {type === "menu" && (
            <div className="flex flex-col gap-2">
              <input
                value={menuName}
                onChange={(e) => setMenuName(e.target.value)}
                placeholder="메뉴 이름"
                className="rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-primary"
              />
              <input
                value={menuNewPrice}
                onChange={(e) => setMenuNewPrice(e.target.value)}
                placeholder="올바른 가격 (예: 9,000원) - 선택"
                className="rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-primary"
              />
              <input
                value={menuNewDescription}
                onChange={(e) => setMenuNewDescription(e.target.value)}
                placeholder="추가 설명 - 선택 (예: 메뉴가 없어졌어요)"
                className="rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
          )}

          {type === "closedOrMoved" && (
            <div className="flex flex-col gap-2">
              <div className="flex gap-3">
                <label className="flex items-center gap-1.5 text-sm text-ink">
                  <input
                    type="radio"
                    checked={isClosed}
                    onChange={() => setIsClosed(true)}
                  />
                  폐업했어요
                </label>
                <label className="flex items-center gap-1.5 text-sm text-ink">
                  <input
                    type="radio"
                    checked={!isClosed}
                    onChange={() => setIsClosed(false)}
                  />
                  이전했어요
                </label>
              </div>
              {!isClosed && (
                <input
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  placeholder="새 주소 - 선택"
                  className="rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-primary"
                />
              )}
            </div>
          )}

          {type === "zeroPay" && (
            <div className="flex gap-3">
              <label className="flex items-center gap-1.5 text-sm text-ink">
                <input type="radio" checked={isZeroPay} onChange={() => setIsZeroPay(true)} />
                제로페이 가능해요
              </label>
              <label className="flex items-center gap-1.5 text-sm text-ink">
                <input type="radio" checked={!isZeroPay} onChange={() => setIsZeroPay(false)} />
                제로페이 안 돼요
              </label>
            </div>
          )}

          {type === "discount" && (
            <div className="flex flex-col gap-2">
              <input
                value={discountBenefit}
                onChange={(e) => setDiscountBenefit(e.target.value)}
                placeholder="올바른 할인 혜택 (예: 10%, 탄산 S 1잔 무료)"
                className="rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-primary"
              />
              <input
                value={discountNote}
                onChange={(e) => setDiscountNote(e.target.value)}
                placeholder="비고 조건 (예: 11시~15시 세트 제외, 사원증 제시)"
                className="rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-ink-soft">
              부가설명 {type === "other" ? "" : "(선택)"}
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={type === "other" ? "무엇이 잘못됐는지 자유롭게 적어줘" : "덧붙일 말이 있으면 적어줘"}
              rows={2}
              className="rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          {error && <p className="text-xs text-primary-dark">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:opacity-60"
          >
            {submitting ? "보내는 중..." : "요청 보내기"}
          </button>
        </form>
      </div>
    </div>
  );
}
