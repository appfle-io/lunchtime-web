"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { RestaurantSummary, RestaurantMenuItem } from "@/types";
import { getCategoryVisual, CATEGORY_LABELS } from "@/lib/restaurant-category";
import { EDIT_REQUEST_TYPE_LABELS, summarizeEditRequest } from "@/lib/restaurant-edit-request";
import type { RestaurantEditRequest } from "@/lib/restaurant-edit-request-server";
import Toast from "./Toast";
import LoadingOverlay from "./LoadingOverlay";

interface AdminDashboardProps {
  companyCode: string;
  nickname: string;
  restaurants: RestaurantSummary[];
  initialPendingRequests: RestaurantEditRequest[];
}

// 2026-08-09 개편: 검색해서 하나씩 찾아 편집하는 방식 대신, 전체 가맹점을 표(엑셀처럼) 형태로
// 쭉 보여주고 위쪽 검색창으로 그 표를 실시간 필터링하는 방식으로 바꿈. 이름/카테고리/전화/
// 제로페이처럼 칸이 짧은 필드는 표 안에서 바로 고쳐서 "저장"만 누르면 되고, 주소/영업시간/
// 편의시설/결제수단/네이버링크/메뉴처럼 내용이 긴 필드는 "상세편집" 버튼으로 모달을 띄운다.
// 대기중 수정요청은 "가맹점 관리"와 분리된 별도 탭("문의하기")으로 옮겼다.
const PAGE_SIZE = 50;

type Tab = "restaurants" | "requests";

// 2026-08-10 신규: 표 헤더 클릭 정렬. 정렬 대상 컬럼("이름"/"카테고리"/"전화"/"제로페이"/"사용여부")만
// 여기 나열한다 - "메뉴"/"상세"/"저장"은 동작/표시용 칸이라 정렬 의미가 없어서 제외.
// 상태는 (컬럼, 방향) 두 개만 두고, null(컬럼 없음) = "기본(가나다순)"으로 취급해서 클릭 3번째에
// 다시 null로 돌아가면 "원래대로"가 자연스럽게 재현된다.
type SortColumn = "name" | "category" | "phone" | "isZeroPay" | "isActive" | "menus";
type SortDirection = "asc" | "desc";

function getSortValue(r: RestaurantSummary, column: SortColumn): string | number {
  switch (column) {
    case "name":
      return r.name ?? "";
    case "category":
      return r.categoryLabel ?? r.category ?? "";
    case "phone":
      return r.phone ?? "";
    case "isZeroPay":
      return r.isZeroPay ? 1 : 0;
    case "isActive":
      return r.isActive === false ? 0 : 1;
    case "menus":
      return Array.isArray(r.menus) ? r.menus.length : 0;
  }
}

export default function AdminDashboard({
  companyCode,
  nickname,
  restaurants: initialRestaurants,
  initialPendingRequests,
}: AdminDashboardProps) {
  const router = useRouter();
  // 2026-08-10 신규: "← 메인으로" 클릭 시 다음 화면(메인 페이지)이 데이터를 다 불러올 때까지
  // 반응이 없어 보이던 문제 - useTransition으로 감싸서 클릭 즉시 로딩 오버레이를 띄운다.
  const [isNavigatingHome, startHomeTransition] = useTransition();
  const [tab, setTab] = useState<Tab>("restaurants");
  const [rows, setRows] = useState<RestaurantSummary[]>(initialRestaurants);
  const [pendingRequests, setPendingRequests] = useState<RestaurantEditRequest[]>(initialPendingRequests);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("");
  const [filterZeroPay, setFilterZeroPay] = useState<"all" | "Y" | "N">("all");
  const [filterIsActive, setFilterIsActive] = useState<"all" | "Y" | "N">("all");
  const [page, setPage] = useState(0);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [enrichingId, setEnrichingId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  // 2026-08-10 신규: 표 정렬 상태. sortColumn===null이면 "기본(가나다순)" - 아래 sortedRows에서
  // 항상 이름 오름차순으로 fallback한다.
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const detailRestaurant = useMemo(() => rows.find((r) => r.id === detailId) ?? null, [rows, detailId]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase().replace(/\s/g, "");

    return rows.filter((r) => {
      // 1. 검색어 필터 (이름, 주소, 메모, 메뉴)
      if (q) {
        const names = [
          r.name,
          r.displayName,
          r.naverMatchedName,
          r.zeroPayOfficialName,
          r.businessName,
        ].filter(Boolean) as string[];

        const nameMatch = names.some((n) => n.toLowerCase().replace(/\s/g, "").includes(q));
        const addrMatch = (r.address ?? "").toLowerCase().replace(/\s/g, "").includes(q);
        const memoMatch = (r.adminMemo ?? "").toLowerCase().includes(q);
        const menuMatch = Array.isArray(r.menus) && r.menus.some((m) =>
          (m.name ?? "").toLowerCase().replace(/\s/g, "").includes(q) ||
          (m.description ?? "").toLowerCase().replace(/\s/g, "").includes(q)
        );
        if (!nameMatch && !addrMatch && !memoMatch && !menuMatch) {
          return false;
        }
      }

      // 2. 카테고리 필터
      if (filterCategory) {
        const visual = getCategoryVisual(r.category, r.categoryLabel);
        if (visual.label !== filterCategory && r.categoryLabel !== filterCategory) {
          return false;
        }
      }

      // 3. 제로페이 필터 (all / Y / N)
      if (filterZeroPay === "Y" && !r.isZeroPay) return false;
      if (filterZeroPay === "N" && r.isZeroPay) return false;

      // 4. 사용여부 필터 (all / Y / N)
      const isActive = r.isActive !== false;
      if (filterIsActive === "Y" && !isActive) return false;
      if (filterIsActive === "N" && isActive) return false;

      return true;
    });
  }, [rows, searchQuery, filterCategory, filterZeroPay, filterIsActive]);

  // 점검 및 일괄 업데이트 모달 상태
  const [isAuditing, setIsAuditing] = useState(false);
  const [auditModalType, setAuditModalType] = useState<"zeropay" | "naver" | null>(null);
  interface DiffDetailRow {
    label: string;
    before: string;
    after: string;
    isChanged?: boolean;
  }
  interface DiffItem {
    id: string;
    name: string;
    address: string;
    patch: Record<string, any>;
    reason: string;
    details: DiffDetailRow[];
  }
  const [diffItems, setDiffItems] = useState<DiffItem[]>([]);
  const [selectedDiffIds, setSelectedDiffIds] = useState<Set<string>>(new Set());
  const [isApplyingBatch, setIsApplyingBatch] = useState(false);
  const [modalFilterQuery, setModalFilterQuery] = useState("");

  // 메인 테이블 체크박스 및 갱신 완료 상태 관리
  const [tableSelectedIds, setTableSelectedIds] = useState<Set<string>>(new Set());
  const [completedStoreIds, setCompletedStoreIds] = useState<Set<string>>(new Set());

  async function handleCheckZeroPayAll() {
    setIsAuditing(true);
    const targetIds = tableSelectedIds.size > 0 ? Array.from(tableSelectedIds) : undefined;
    if (targetIds) {
      setCompletedStoreIds((prev) => {
        const next = new Set(prev);
        targetIds.forEach((id) => next.delete(id));
        return next;
      });
    }
    try {
      const res = await fetch("/api/admin/zeropay/check-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyCode, targetIds }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToastMessage(data.error ?? "제로페이 점검 중 오류가 발생했습니다.");
        return;
      }
      if (!data.diffs || data.diffs.length === 0) {
        setToastMessage("선택한 가맹점의 제로페이 정보가 정합성에 부합하며 변경할 항목이 없습니다.");
        if (targetIds) {
          setCompletedStoreIds((prev) => new Set([...Array.from(prev), ...targetIds]));
        }
        return;
      }
      const formatted: DiffItem[] = data.diffs.map((d: any) => {
        const details: DiffDetailRow[] = [
          {
            label: "제로페이 지원 여부",
            before: d.currentIsZeroPay ? "✅ 사용 가능 (true)" : "❌ 미지원 (false)",
            after: d.proposedIsZeroPay ? "✅ 사용 가능 (true)" : "❌ 미지원 (false)",
            isChanged: d.currentIsZeroPay !== d.proposedIsZeroPay,
          },
        ];

        if (d.currentOfficialName || d.proposedOfficialName) {
          details.push({
            label: "공식 등록 상호명",
            before: d.currentOfficialName ?? "(없음)",
            after: d.proposedOfficialName ?? "(없음/삭제)",
            isChanged: d.currentOfficialName !== d.proposedOfficialName,
          });
        }

        if (d.currentOfficialAddress || d.proposedOfficialAddress) {
          details.push({
            label: "공식 등록 주소",
            before: d.currentOfficialAddress ?? "(없음)",
            after: d.proposedOfficialAddress ?? "(없음/삭제)",
            isChanged: d.currentOfficialAddress !== d.proposedOfficialAddress,
          });
        }

        return {
          id: d.id,
          name: d.name,
          address: d.address,
          patch: d.patch,
          reason: d.reason,
          details,
        };
      });
      setDiffItems(formatted);
      setSelectedDiffIds(new Set(formatted.map((f) => f.id)));
      setModalFilterQuery("");
      setAuditModalType("zeropay");
    } catch {
      setToastMessage("네트워크 오류로 제로페이 점검을 진행하지 못했습니다.");
    } finally {
      setIsAuditing(false);
    }
  }

  async function handleCheckNaverAll() {
    setIsAuditing(true);
    const targetIds = tableSelectedIds.size > 0 ? Array.from(tableSelectedIds) : undefined;
    if (targetIds) {
      setCompletedStoreIds((prev) => {
        const next = new Set(prev);
        targetIds.forEach((id) => next.delete(id));
        return next;
      });
    }
    try {
      const res = await fetch("/api/admin/naver/check-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyCode, targetIds }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToastMessage(data.error ?? "네이버 정보 갱신 점검 중 오류가 발생했습니다.");
        return;
      }
      if (!data.diffs || data.diffs.length === 0) {
        setToastMessage("선택한 가맹점의 네이버 정보가 최신 상태입니다.");
        if (targetIds) {
          setCompletedStoreIds((prev) => new Set([...Array.from(prev), ...targetIds]));
        }
        return;
      }
      const formatted: DiffItem[] = data.diffs.map((d: any) => {
        const details: DiffDetailRow[] = [];

        if (d.currentPhone !== d.proposedPhone) {
          details.push({
            label: "전화번호",
            before: d.currentPhone ?? "(없음)",
            after: d.proposedPhone ?? "(없음)",
            isChanged: true,
          });
        }

        if (d.currentNaverMatchedName !== d.proposedNaverMatchedName) {
          details.push({
            label: "네이버 검색 상호명",
            before: d.currentNaverMatchedName ?? "(없음)",
            after: d.proposedNaverMatchedName ?? "(없음)",
            isChanged: true,
          });
        }

        if (d.currentNaverMatchedAddress !== d.proposedNaverMatchedAddress) {
          details.push({
            label: "네이버 검색 주소",
            before: d.currentNaverMatchedAddress ?? "(없음)",
            after: d.proposedNaverMatchedAddress ?? "(없음)",
            isChanged: true,
          });
        }

        return {
          id: d.id,
          name: d.name,
          address: d.address,
          patch: d.patch,
          reason: d.reason,
          details,
        };
      });
      setDiffItems(formatted);
      setSelectedDiffIds(new Set(formatted.map((f) => f.id)));
      setModalFilterQuery("");
      setAuditModalType("naver");
    } catch {
      setToastMessage("네트워크 오류로 네이버 정보 갱신 점검을 진행하지 못했습니다.");
    } finally {
      setIsAuditing(false);
    }
  }

  async function handleApplyBatchUpdate() {
    const selectedList = diffItems.filter((item) => selectedDiffIds.has(item.id));
    if (selectedList.length === 0) {
      setToastMessage("업데이트할 가맹점을 선택해주세요.");
      return;
    }
    setIsApplyingBatch(true);
    try {
      const res = await fetch("/api/admin/batch-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyCode,
          items: selectedList.map((item) => ({ id: item.id, patch: item.patch })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToastMessage(data.error ?? "업데이트 반영에 실패했습니다.");
        return;
      }
      const updatedIds = selectedList.map((s) => s.id);
      setRows((prev) =>
        prev.map((r) => {
          const matched = selectedList.find((s) => s.id === r.id);
          if (matched) {
            return { ...r, ...matched.patch };
          }
          return r;
        })
      );
      setCompletedStoreIds((prev) => new Set([...Array.from(prev), ...updatedIds]));
      setToastMessage(`선택한 ${data.updatedCount ?? selectedList.length}개 가맹점 정보가 DB에 반영되었습니다.`);
      setAuditModalType(null);
    } catch {
      setToastMessage("네트워크 오류로 일괄 업데이트를 적용하지 못했습니다.");
    } finally {
      setIsApplyingBatch(false);
    }
  }

  function handleSortClick(column: SortColumn) {
    setPage(0); // 정렬이 바뀌면 페이지 번호가 안 맞을 수 있으니 첫 페이지로.
    if (sortColumn !== column) {
      setSortColumn(column);
      setSortDirection("asc");
      return;
    }
    if (sortDirection === "asc") {
      setSortDirection("desc");
      return;
    }
    // 오름차순 -> 내림차순 다음, 같은 헤더를 세 번째 누르면 "원래대로"(기본 가나다순)로 리셋.
    setSortColumn(null);
  }

  // 상세편집 모달 상태 - 주소/영업시간/편의시설/결제수단/네이버링크/메뉴처럼 표 칸에 넣기엔
  // 긴 필드들을 여기서 한꺼번에 다룬다. 이름/카테고리/전화/제로페이도 여기 다시 포함해서,
  // 표 저장이든 모달 저장이든 항상 전체 필드가 같이 반영되게 한다(둘이 따로 놀지 않도록).
  const [savingDetail, setSavingDetail] = useState(false);
  const [formName, setFormName] = useState("");
  const [formAddress, setFormAddress] = useState("");
  const [formCategoryLabel, setFormCategoryLabel] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formBusinessHours, setFormBusinessHours] = useState("");
  const [formFacilities, setFormFacilities] = useState("");
  const [formPaymentMethods, setFormPaymentMethods] = useState("");
  const [formIsZeroPay, setFormIsZeroPay] = useState(false);
  const [formNaverPlaceUrl, setFormNaverPlaceUrl] = useState("");
  const [formNaverMatchedName, setFormNaverMatchedName] = useState("");
  const [formZeroPayOfficialName, setFormZeroPayOfficialName] = useState("");
  const [formBusinessName, setFormBusinessName] = useState("");
  const [formDiscountBenefit, setFormDiscountBenefit] = useState("");
  const [formDiscountNote, setFormDiscountNote] = useState("");
  const [formAdminMemo, setFormAdminMemo] = useState("");
  const [formMenus, setFormMenus] = useState<RestaurantMenuItem[]>([]);

  // 2026-08-10 신규: sortColumn이 없으면(기본 상태) 항상 이름 가나다순으로 보여준다 - 컬럼
  // 헤더를 클릭해서 명시적으로 정렬을 걸었을 때만 그 컬럼/방향을 따른다.
  const sortedRows = useMemo(() => {
    const base = [...filteredRows];
    if (!sortColumn) {
      return base.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    }
    const dir = sortDirection === "asc" ? 1 : -1;
    return base.sort((a, b) => {
      const av = getSortValue(a, sortColumn);
      const bv = getSortValue(b, sortColumn);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), "ko") * dir;
    });
  }, [filteredRows, sortColumn, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const pagedRows = sortedRows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  function handleSearchChange(value: string) {
    setSearchQuery(value);
    setPage(0); // 검색어가 바뀌면 항상 첫 페이지로.
  }

  function updateRow(id: string, patch: Partial<RestaurantSummary>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
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
            const day = (o.day ?? o.dayOfWeek ?? o.title ?? "") as string;
            const time = (o.time ?? o.hours ?? o.businessHours ?? o.timeString ?? "") as string;
            return day && time ? `${day}: ${time}` : day || time;
          }
          return "";
        })
        .filter(Boolean)
        .join("\n");
    }
    if (typeof raw === "object" && raw !== null) {
      const obj = raw as Record<string, unknown>;
      if (Array.isArray(obj.businessHours)) {
        return businessHoursToText(obj.businessHours);
      }
      if (Array.isArray(obj.options)) {
        return businessHoursToText(obj.options);
      }
    }
    try {
      return JSON.stringify(raw, null, 2);
    } catch {
      return "";
    }
  }

  function openDetail(restaurant: RestaurantSummary) {
    setDetailId(restaurant.id);
    setFormName(restaurant.name);
    setFormAddress(restaurant.address);
    setFormCategoryLabel(restaurant.categoryLabel ?? "");
    setFormPhone(restaurant.phone ?? "");
    setFormBusinessHours(businessHoursToText(restaurant.businessHours));
    setFormFacilities((restaurant.facilities ?? []).join(", "));
    setFormPaymentMethods((restaurant.paymentMethods ?? []).join(", "));
    setFormIsZeroPay(restaurant.isZeroPay);
    setFormNaverPlaceUrl(restaurant.naverPlaceUrl ?? "");
    setFormNaverMatchedName(restaurant.naverMatchedName ?? restaurant.displayName ?? restaurant.name);
    setFormZeroPayOfficialName(restaurant.zeroPayOfficialName ?? "");
    setFormBusinessName(restaurant.businessName ?? "");
    setFormDiscountBenefit(restaurant.discountInfo?.benefit ?? "");
    setFormDiscountNote(restaurant.discountInfo?.note ?? "");
    setFormAdminMemo(restaurant.adminMemo ?? "");
    setFormMenus(restaurant.menus ?? []);
  }

  // 표에서 바로 고칠 수 있는 필드(이름/카테고리/전화/제로페이)만 저장한다.
  async function handleSaveRow(restaurant: RestaurantSummary) {
    setSavingRowId(restaurant.id);
    try {
      const res = await fetch("/api/admin/restaurants", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyCode,
          restaurantId: restaurant.id,
          update: {
            name: restaurant.name.trim(),
            categoryLabel: restaurant.categoryLabel || null,
            phone: restaurant.phone || null,
            isZeroPay: restaurant.isZeroPay,
            isActive: restaurant.isActive !== false,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToastMessage(data.error ?? "저장하지 못했어요.");
        return;
      }
      updateRow(restaurant.id, data.restaurant);
      setToastMessage(`${restaurant.name} 저장했어요.`);
    } catch {
      setToastMessage("네트워크 오류로 저장하지 못했어요.");
    } finally {
      setSavingRowId(null);
    }
  }

  async function handleEnrichRow(restaurant: RestaurantSummary) {
    setEnrichingId(restaurant.id);
    try {
      const res = await fetch("/api/admin/restaurants/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyCode, restaurantId: restaurant.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToastMessage(data.error ?? "정보를 불러오지 못했어요.");
        return;
      }
      updateRow(restaurant.id, data.restaurant);
      if (detailId === restaurant.id) {
        openDetail(data.restaurant);
      }
      setToastMessage(`[${restaurant.name}] 제로페이 및 네이버맵 정보를 성공적으로 불러왔어요.`);
    } catch {
      setToastMessage("네트워크 오류로 정보를 불러오지 못했어요.");
    } finally {
      setEnrichingId(null);
    }
  }

  function updateMenuField(index: number, field: "name" | "price" | "description", value: string) {
    setFormMenus((prev) => prev.map((m, i) => (i === index ? { ...m, [field]: value } : m)));
  }

  function addMenuRow() {
    setFormMenus((prev) => [...prev, { name: "", price: "", description: "" }]);
  }

  function removeMenuRow(index: number) {
    setFormMenus((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSaveDetail() {
    if (!detailId) return;
    setSavingDetail(true);
    try {
      const res = await fetch("/api/admin/restaurants", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyCode,
          restaurantId: detailId,
          update: {
            name: formNaverMatchedName.trim() || formName.trim(),
            naverMatchedName: formNaverMatchedName.trim() || null,
            zeroPayOfficialName: formZeroPayOfficialName.trim() || null,
            businessName: formBusinessName.trim() || null,
            address: formAddress.trim(),
            categoryLabel: formCategoryLabel || null,
            phone: formPhone.trim() || null,
            businessHours: formBusinessHours.trim() || null,
            facilities: formFacilities
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
            paymentMethods: formPaymentMethods
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
            isZeroPay: formIsZeroPay,
            naverPlaceUrl: formNaverPlaceUrl.trim() || null,
            discountInfo:
              formDiscountBenefit.trim() || formDiscountNote.trim()
                ? {
                    benefit: formDiscountBenefit.trim() || null,
                    note: formDiscountNote.trim() || null,
                  }
                : null,
            adminMemo: formAdminMemo.trim() || null,
            menus: formMenus.filter((m) => m.name.trim().length > 0),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToastMessage(data.error ?? "저장하지 못했어요.");
        return;
      }
      updateRow(detailId, data.restaurant);
      setToastMessage("저장했어요.");
      setDetailId(null);
    } catch {
      setToastMessage("네트워크 오류로 저장하지 못했어요.");
    } finally {
      setSavingDetail(false);
    }
  }

  // 문의하기 탭에서 "이 가게 편집" - 가맹점 관리 탭으로 전환하면서 그 가게 상세편집 모달을 바로 연다.
  function editFromRequest(req: RestaurantEditRequest) {
    const restaurant = rows.find((r) => r.id === req.restaurantId);
    if (!restaurant) {
      setToastMessage("이 요청이 가리키는 식당을 목록에서 찾지 못했어요.");
      return;
    }
    setTab("restaurants");
    setSearchQuery(restaurant.name);
    setPage(0);
    openDetail(restaurant);
  }

  async function handleResolveRequest(req: RestaurantEditRequest, action: "resolve" | "reject") {
    setResolvingId(req.id);
    try {
      const res = await fetch("/api/admin/edit-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyCode, requestId: req.id, action }),
      });
      if (!res.ok) {
        const data = await res.json();
        setToastMessage(data.error ?? "처리하지 못했어요.");
        return;
      }
      setPendingRequests((prev) => prev.filter((r) => r.id !== req.id));
      setToastMessage(action === "resolve" ? "요청을 처리 완료로 표시했어요." : "요청을 거절했어요.");
    } catch {
      setToastMessage("네트워크 오류로 처리하지 못했어요.");
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <main className="min-h-screen bg-surface-muted px-3 py-6 sm:px-6">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-ink">🛠️ 관리자 페이지</h1>
            <p className="mt-0.5 text-sm text-ink-soft">
              {nickname}님 · {companyCode}
            </p>
          </div>
          <button
            onClick={() => startHomeTransition(() => router.push(`/${companyCode}`))}
            className="rounded-full bg-surface px-3 py-1.5 text-sm font-medium text-ink-soft transition hover:text-primary-dark"
          >
            ← 메인으로
          </button>
        </div>

        {/* 탭 & 전체 점검 버튼 */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1.5">
            <button
              onClick={() => setTab("restaurants")}
              className={[
                "rounded-full px-3.5 py-1.5 text-sm font-medium transition",
                tab === "restaurants" ? "bg-primary text-white" : "bg-surface text-ink-soft",
              ].join(" ")}
            >
              가맹점 관리
            </button>
            <button
              onClick={() => setTab("requests")}
              className={[
                "rounded-full px-3.5 py-1.5 text-sm font-medium transition",
                tab === "requests" ? "bg-primary text-white" : "bg-surface text-ink-soft",
              ].join(" ")}
            >
              문의하기 ({pendingRequests.length})
            </button>
          </div>

          {tab === "restaurants" && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleCheckZeroPayAll}
                disabled={isAuditing}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50 shadow-sm"
              >
                🛡️ 제로페이 가맹점 {tableSelectedIds.size > 0 ? `선택 점검 (${tableSelectedIds.size}개)` : "전체 점검"}
              </button>
              <button
                onClick={handleCheckNaverAll}
                disabled={isAuditing}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50 shadow-sm"
              >
                🔄 네이버 정보 {tableSelectedIds.size > 0 ? `선택 갱신 (${tableSelectedIds.size}개)` : "전체 갱신"}
              </button>
            </div>
          )}
        </div>

        {tab === "restaurants" && (
          <section className="rounded-xl2 bg-surface p-4 shadow-soft">
            {/* 검색 및 상단 필터 컨트롤 바 */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              <input
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="🔍 이름, 주소, 메모, 메뉴 검색"
                className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-primary bg-white"
              />

              {/* 카테고리 필터 */}
              <select
                value={filterCategory}
                onChange={(e) => {
                  setFilterCategory(e.target.value);
                  setPage(0);
                }}
                className="rounded-xl border border-black/10 px-3 py-2 text-sm text-ink outline-none focus:border-primary bg-white font-medium cursor-pointer"
              >
                <option value="">🍽️ 카테고리: 전체보기</option>
                {CATEGORY_LABELS.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>

              {/* 제로페이 필터 */}
              <select
                value={filterZeroPay}
                onChange={(e) => {
                  setFilterZeroPay(e.target.value as "all" | "Y" | "N");
                  setPage(0);
                }}
                className="rounded-xl border border-black/10 px-3 py-2 text-sm text-ink outline-none focus:border-primary bg-white font-medium cursor-pointer"
              >
                <option value="all">💚 제로페이: 전체보기</option>
                <option value="Y">💚 제로페이: Y (가능만)</option>
                <option value="N">❌ 제로페이: N (불가만)</option>
              </select>

              {/* 사용여부 필터 */}
              <select
                value={filterIsActive}
                onChange={(e) => {
                  setFilterIsActive(e.target.value as "all" | "Y" | "N");
                  setPage(0);
                }}
                className="rounded-xl border border-black/10 px-3 py-2 text-sm text-ink outline-none focus:border-primary bg-white font-medium cursor-pointer"
              >
                <option value="all">👁️ 사용여부: 전체보기</option>
                <option value="Y">✅ 사용여부: Y (사용중)</option>
                <option value="N">🚫 사용여부: N (미사용)</option>
              </select>
            </div>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <p className="text-xs text-ink-soft">
                  총 <span className="font-bold text-ink">{filteredRows.length}개</span>
                  {(searchQuery || filterCategory || filterZeroPay !== "all" || filterIsActive !== "all") && (
                    <span className="ml-1 font-semibold text-primary">(전체 {rows.length}개 중 필터됨)</span>
                  )}
                </p>
                {(searchQuery || filterCategory || filterZeroPay !== "all" || filterIsActive !== "all") && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      setFilterCategory("");
                      setFilterZeroPay("all");
                      setFilterIsActive("all");
                      setPage(0);
                    }}
                    className="text-xs text-rose-600 underline font-semibold hover:text-rose-800"
                  >
                    필터 초기화
                  </button>
                )}
              </div>
              {tableSelectedIds.size > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold text-primary">
                    선택된 가맹점: {tableSelectedIds.size}개
                  </span>
                  <button
                    type="button"
                    onClick={() => setTableSelectedIds(new Set())}
                    className="text-ink-soft hover:underline"
                  >
                    선택 해제
                  </button>
                </div>
              )}
            </div>

            <div className="mt-3 overflow-x-auto rounded-xl border border-black/10">
              <table className="w-full min-w-[850px] text-sm">
                <thead>
                  <tr className="border-b border-black/10 bg-surface-muted text-left text-xs text-ink-soft">
                    <th className="px-2 py-2 text-center font-medium w-14">
                      <input
                        type="checkbox"
                        checked={tableSelectedIds.size === filteredRows.length && filteredRows.length > 0}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setTableSelectedIds(new Set(filteredRows.map((r) => r.id)));
                          } else {
                            setTableSelectedIds(new Set());
                          }
                        }}
                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                        title="전체 선택 / 해제"
                      />
                    </th>
                    {(
                      [
                        { column: "name" as const, label: "이름", className: "px-2 py-2 font-medium" },
                        { column: "category" as const, label: "카테고리", className: "px-2 py-2 font-medium" },
                        { column: "phone" as const, label: "전화", className: "px-2 py-2 font-medium" },
                        {
                          column: "isZeroPay" as const,
                          label: "제로페이",
                          className: "px-2 py-2 text-center font-medium",
                        },
                        {
                          column: "isActive" as const,
                          label: "사용여부",
                          className: "px-2 py-2 text-center font-medium",
                        },
                        {
                          column: "menus" as const,
                          label: "메뉴",
                          className: "px-2 py-2 text-center font-medium",
                        },
                      ] satisfies { column: SortColumn; label: string; className: string }[]
                    ).map(({ column, label, className }) => (
                      <th
                        key={column}
                        onClick={() => handleSortClick(column)}
                        className={`${className} cursor-pointer select-none transition hover:text-ink`}
                        title="클릭해서 정렬 (오름차순 → 내림차순 → 원래대로)"
                      >
                        {label}
                        <span className="ml-0.5 inline-block w-2.5 text-primary">
                          {sortColumn === column ? (sortDirection === "asc" ? "▲" : "▼") : ""}
                        </span>
                      </th>
                    ))}
                    <th className="px-2 py-2 text-center font-medium">정보수집</th>
                    <th className="px-2 py-2 text-center font-medium">상세</th>
                    <th className="px-2 py-2 text-center font-medium">저장</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((r) => {
                    const visual = getCategoryVisual(r.category, r.categoryLabel);
                    const isActive = r.isActive !== false;
                    const isTableChecked = tableSelectedIds.has(r.id);
                    const isCompleted = completedStoreIds.has(r.id);

                    return (
                      <tr
                        key={r.id}
                        className={[
                          "border-b border-black/5 last:border-0",
                          isTableChecked ? "bg-primary-light/10" : isActive ? "" : "bg-black/[0.03] opacity-60",
                        ].join(" ")}
                      >
                        <td className="px-2 py-1.5 text-center shrink-0">
                          <div className="flex items-center justify-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={isTableChecked}
                              onChange={(e) => {
                                const next = new Set(tableSelectedIds);
                                if (e.target.checked) next.add(r.id);
                                else next.delete(r.id);
                                setTableSelectedIds(next);
                              }}
                              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer shrink-0"
                            />
                            {isCompleted && (
                              <span className="rounded bg-emerald-100 border border-emerald-300 px-1 py-0.5 text-[10px] font-bold text-emerald-800 shrink-0">
                                완료
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            value={r.name}
                            onChange={(e) => updateRow(r.id, { name: e.target.value })}
                            className="w-full min-w-[120px] rounded-lg border border-transparent bg-transparent px-1.5 py-1 font-medium text-ink outline-none transition focus:border-primary focus:bg-surface-muted"
                          />
                          {(r.zeroPayOfficialName || r.businessName || r.adminMemo) && (
                            <div className="flex items-center gap-1 flex-wrap px-1.5 mt-0.5">
                              {(r.zeroPayOfficialName || r.businessName) && (
                                <p className="text-[10px] text-emerald-700 truncate max-w-[180px]" title={`제로페이명: ${r.zeroPayOfficialName ?? '-'} / 사업자명: ${r.businessName ?? '-'}`}>
                                  {r.zeroPayOfficialName && r.zeroPayOfficialName !== r.name
                                    ? `[제로페이: ${r.zeroPayOfficialName}]`
                                    : r.businessName && r.businessName !== r.name
                                    ? `[사업자: ${r.businessName}]`
                                    : ""}
                                </p>
                              )}
                              {r.adminMemo && (
                                <span
                                  className="inline-flex items-center rounded bg-amber-100 border border-amber-300 px-1 py-0.5 text-[10px] font-bold text-amber-800 cursor-help shrink-0"
                                  title={`[🔒 관리자 메모]\n${r.adminMemo}`}
                                >
                                  📝 메모
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          <select
                            value={r.categoryLabel ?? ""}
                            onChange={(e) => updateRow(r.id, { categoryLabel: e.target.value || null })}
                            className="rounded-lg border border-transparent bg-transparent px-1.5 py-1 text-ink outline-none transition focus:border-primary focus:bg-surface-muted"
                          >
                            <option value="">{visual.label} (자동추론)</option>
                            {CATEGORY_LABELS.map((label) => (
                              <option key={label} value={label}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            value={r.phone ?? ""}
                            onChange={(e) => updateRow(r.id, { phone: e.target.value })}
                            placeholder="-"
                            className="w-full min-w-[110px] rounded-lg border border-transparent bg-transparent px-1.5 py-1 text-ink outline-none transition focus:border-primary focus:bg-surface-muted"
                          />
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <input
                            type="checkbox"
                            checked={r.isZeroPay}
                            onChange={(e) => updateRow(r.id, { isZeroPay: e.target.checked })}
                          />
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          {/* 2026-08-10 신규: 기본 true(=사용). 체크 해제(N 처리) 후 "저장"을 눌러야
                              반영되고, 반영되면 메인 화면(지도/리스트)에서 이 가맹점이 제외된다. */}
                          <input
                            type="checkbox"
                            checked={isActive}
                            onChange={(e) => updateRow(r.id, { isActive: e.target.checked })}
                            title={isActive ? "사용중 (체크 해제 시 메인 화면에서 숨김)" : "미사용(N) - 메인 화면에서 숨겨짐"}
                          />
                        </td>
                        <td className="px-2 py-1.5 text-center text-xs text-ink-soft">
                          {(r.menus ?? []).length}개
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <button
                            onClick={() => handleEnrichRow(r)}
                            disabled={enrichingId === r.id}
                            className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60"
                            title="네이버맵 및 공식 제로페이 정보 실시간 수집"
                          >
                            {enrichingId === r.id ? "수집중..." : "🔄 수동수집"}
                          </button>
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <button
                            onClick={() => openDetail(r)}
                            className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-ink-soft transition hover:bg-primary-light hover:text-primary-dark"
                          >
                            상세편집
                          </button>
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <button
                            onClick={() => handleSaveRow(r)}
                            disabled={savingRowId === r.id}
                            className="rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-white transition hover:bg-primary-dark disabled:opacity-60"
                          >
                            {savingRowId === r.id ? "..." : "저장"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {pagedRows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-2 py-6 text-center text-sm text-ink-soft">
                        조건에 맞는 가맹점이 없어요.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="mt-3 flex items-center justify-center gap-3">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="rounded-full bg-surface-muted px-3 py-1 text-xs font-medium text-ink-soft disabled:opacity-40"
                >
                  이전
                </button>
                <span className="text-xs text-ink-soft">
                  {page + 1} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="rounded-full bg-surface-muted px-3 py-1 text-xs font-medium text-ink-soft disabled:opacity-40"
                >
                  다음
                </button>
              </div>
            )}
          </section>
        )}

        {tab === "requests" && (
          <section className="rounded-xl2 bg-surface p-4 shadow-soft">
            <h2 className="text-base font-bold text-ink">📝 대기중인 수정요청 ({pendingRequests.length})</h2>
            {pendingRequests.length === 0 && (
              <p className="mt-2 text-sm text-ink-soft">대기중인 요청이 없어요.</p>
            )}
            <ul className="mt-3 flex flex-col gap-2">
              {pendingRequests.map((req) => (
                <li key={req.id} className="rounded-xl border border-black/10 p-3">
                  <p className="text-sm font-semibold text-ink">
                    {req.restaurantName}
                    <span className="ml-1.5 rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-ink-soft">
                      {EDIT_REQUEST_TYPE_LABELS[req.type]}
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-ink-soft">{summarizeEditRequest(req.type, req.payload)}</p>
                  {req.payload.note && <p className="mt-0.5 text-xs text-ink-soft">💬 {req.payload.note}</p>}
                  <p className="mt-1 text-xs text-ink-soft">{req.requestedByNickname}님이 요청함</p>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      onClick={() => editFromRequest(req)}
                      className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-ink-soft transition hover:bg-primary-light hover:text-primary-dark"
                    >
                      이 가게 편집
                    </button>
                    <button
                      onClick={() => handleResolveRequest(req, "resolve")}
                      disabled={resolvingId === req.id}
                      className="rounded-full bg-primary-light px-2.5 py-1 text-xs font-medium text-primary-dark transition hover:bg-primary-light/70 disabled:opacity-60"
                    >
                      처리완료
                    </button>
                    <button
                      onClick={() => handleResolveRequest(req, "reject")}
                      disabled={resolvingId === req.id}
                      className="rounded-full bg-black/5 px-2.5 py-1 text-xs font-medium text-ink-soft transition hover:bg-black/10 disabled:opacity-60"
                    >
                      거절
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {/* 상세편집 모달 - 주소/영업시간/편의시설/결제수단/네이버링크/메뉴 등 표에 넣기 힘든 필드들. */}
      {detailRestaurant && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setDetailId(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl2 bg-surface p-6 shadow-soft"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-ink">✏️ {detailRestaurant.name} 상세편집</h2>
              <button
                onClick={() => setDetailId(null)}
                aria-label="닫기"
                className="rounded-full p-1 text-ink-soft transition hover:bg-surface-muted"
              >
                ✕
              </button>
            </div>

            <div className="mt-2.5">
              <button
                type="button"
                onClick={() => handleEnrichRow(detailRestaurant)}
                disabled={enrichingId === detailRestaurant.id}
                className="w-full rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60 flex items-center justify-center gap-1.5 shadow-sm"
              >
                {enrichingId === detailRestaurant.id
                  ? "🔄 네이버/제로페이 정보를 수집하고 있어요..."
                  : "🔄 네이버/제로페이 정보 자동 불러오기"}
              </button>
            </div>

            <div className="mt-3 flex flex-col gap-2.5">
              <label className="flex flex-col gap-1 text-xs font-semibold text-emerald-800">
                네이버맵 상호명 (메인 화면 표출명)
                <input
                  value={formNaverMatchedName}
                  onChange={(e) => setFormNaverMatchedName(e.target.value)}
                  className="rounded-xl border border-emerald-500/30 bg-emerald-50/50 px-3 py-2 text-sm text-ink outline-none focus:border-emerald-600"
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
                  제로페이 공식 등록 상호명
                  <input
                    value={formZeroPayOfficialName}
                    onChange={(e) => setFormZeroPayOfficialName(e.target.value)}
                    className="rounded-xl border border-black/10 px-3 py-2 text-sm text-ink outline-none focus:border-primary"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
                  사업자등록상 명칭 (최초 CSV명)
                  <input
                    value={formBusinessName}
                    onChange={(e) => setFormBusinessName(e.target.value)}
                    className="rounded-xl border border-black/10 px-3 py-2 text-sm text-ink outline-none focus:border-primary"
                  />
                </label>
              </div>

              <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
                주소
                <input
                  value={formAddress}
                  onChange={(e) => setFormAddress(e.target.value)}
                  className="rounded-xl border border-black/10 px-3 py-2 text-sm text-ink outline-none focus:border-primary"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
                카테고리
                <select
                  value={formCategoryLabel}
                  onChange={(e) => setFormCategoryLabel(e.target.value)}
                  className="rounded-xl border border-black/10 px-3 py-2 text-sm text-ink outline-none focus:border-primary"
                >
                  <option value="">(원본 텍스트로 자동 추론)</option>
                  {CATEGORY_LABELS.map((label) => (
                    <option key={label} value={label}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
                전화번호
                <input
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                  className="rounded-xl border border-black/10 px-3 py-2 text-sm text-ink outline-none focus:border-primary"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
                영업시간
                <textarea
                  value={formBusinessHours}
                  onChange={(e) => setFormBusinessHours(e.target.value)}
                  rows={2}
                  className="rounded-xl border border-black/10 px-3 py-2 text-sm text-ink outline-none focus:border-primary"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
                편의시설 (쉼표로 구분)
                <input
                  value={formFacilities}
                  onChange={(e) => setFormFacilities(e.target.value)}
                  placeholder="주차가능, 포장가능"
                  className="rounded-xl border border-black/10 px-3 py-2 text-sm text-ink outline-none focus:border-primary"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
                결제수단 (쉼표로 구분)
                <input
                  value={formPaymentMethods}
                  onChange={(e) => setFormPaymentMethods(e.target.value)}
                  placeholder="카드, 제로페이"
                  className="rounded-xl border border-black/10 px-3 py-2 text-sm text-ink outline-none focus:border-primary"
                />
              </label>

              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={formIsZeroPay}
                  onChange={(e) => setFormIsZeroPay(e.target.checked)}
                />
                제로페이 가능
              </label>

              <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
                네이버지도 링크
                <input
                  value={formNaverPlaceUrl}
                  onChange={(e) => setFormNaverPlaceUrl(e.target.value)}
                  className="rounded-xl border border-black/10 px-3 py-2 text-sm text-ink outline-none focus:border-primary"
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
                  제휴 혜택 (예: 10%, 탄산 S 무료)
                  <input
                    value={formDiscountBenefit}
                    onChange={(e) => setFormDiscountBenefit(e.target.value)}
                    className="rounded-xl border border-black/10 px-3 py-2 text-sm text-ink outline-none focus:border-primary"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
                  제휴 비고 조건 (예: 세트 제외)
                  <input
                    value={formDiscountNote}
                    onChange={(e) => setFormDiscountNote(e.target.value)}
                    className="rounded-xl border border-black/10 px-3 py-2 text-sm text-ink outline-none focus:border-primary"
                  />
                </label>
              </div>

              <label className="flex flex-col gap-1 text-xs font-semibold text-amber-900 bg-amber-50/80 p-3.5 rounded-xl border border-amber-200 shadow-sm">
                🔒 관리자 전용 메모 (변경 일시, 상태값, 사유 기록)
                <textarea
                  value={formAdminMemo}
                  onChange={(e) => setFormAdminMemo(e.target.value)}
                  rows={3}
                  placeholder="예: [2026-08-14 12:38] isZeroPay(true➔false), isActive(true➔false / N) 변경 / 사유: 비외식 업종 가맹점 정돈"
                  className="rounded-lg border border-amber-300 px-3 py-2 text-xs text-ink outline-none focus:border-amber-500 bg-white font-sans whitespace-pre-wrap"
                />
              </label>

              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-medium text-ink-soft">메뉴</p>
                {formMenus.map((menu, i) => (
                  <div
                    key={i}
                    className="flex flex-col gap-1.5 rounded-xl bg-surface-muted p-2.5 sm:flex-row sm:items-center"
                  >
                    <input
                      value={menu.name}
                      onChange={(e) => updateMenuField(i, "name", e.target.value)}
                      placeholder="메뉴 이름"
                      className="flex-1 rounded-lg border border-black/10 px-2 py-1.5 text-sm outline-none focus:border-primary"
                    />
                    <input
                      value={menu.price ?? ""}
                      onChange={(e) => updateMenuField(i, "price", e.target.value)}
                      placeholder="가격"
                      className="w-24 shrink-0 rounded-lg border border-black/10 px-2 py-1.5 text-sm outline-none focus:border-primary"
                    />
                    <input
                      value={menu.description ?? ""}
                      onChange={(e) => updateMenuField(i, "description", e.target.value)}
                      placeholder="설명 (선택)"
                      className="flex-1 rounded-lg border border-black/10 px-2 py-1.5 text-sm outline-none focus:border-primary"
                    />
                    <button
                      onClick={() => removeMenuRow(i)}
                      aria-label="메뉴 삭제"
                      className="shrink-0 rounded-lg px-2 py-1.5 text-xs text-ink-soft transition hover:bg-black/5"
                    >
                      삭제
                    </button>
                  </div>
                ))}
                <button
                  onClick={addMenuRow}
                  className="self-start rounded-full bg-surface-muted px-3 py-1.5 text-xs font-medium text-ink-soft transition hover:bg-primary-light hover:text-primary-dark"
                >
                  + 메뉴 추가
                </button>
              </div>

              <button
                onClick={handleSaveDetail}
                disabled={savingDetail}
                className="mt-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:opacity-60"
              >
                {savingDetail ? "저장하는 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 제로페이 / 네이버 정보 점검 변경 내역 프리뷰 및 선택 모달 */}
      {auditModalType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
          <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl overflow-hidden border border-black/10">
            {/* 상단 액센트 바 */}
            <div className="h-1.5 w-full bg-gradient-to-r from-emerald-500 via-primary to-amber-500" />

            {/* 모달 헤더 */}
            <div className="flex items-center justify-between border-b border-black/10 px-6 py-4 bg-surface-muted/60">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-light text-xl">
                  {auditModalType === "zeropay" ? "🛡️" : "🔄"}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-ink flex items-center gap-2">
                    {auditModalType === "zeropay" ? "제로페이 가맹점 전체 점검 결과" : "네이버 정보 갱신 점검 결과"}
                    <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary-dark">
                      총 {diffItems.length}건 변경 대상
                    </span>
                  </h3>
                  <p className="text-xs text-ink-soft mt-0.5">
                    기존 정보와 변경 예정 정보를 대조해 보세요. DB에 실제로 반영할 항목만 체크해주시면 됩니다.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setAuditModalType(null)}
                className="rounded-full p-2 text-ink-soft hover:bg-black/5 hover:text-ink transition"
                aria-label="닫기"
              >
                ✕
              </button>
            </div>

            {/* 필터 및 전체 선택 컨트롤 바 */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 px-6 py-3 bg-surface">
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm font-bold text-ink cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={selectedDiffIds.size === diffItems.length && diffItems.length > 0}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedDiffIds(new Set(diffItems.map((d) => d.id)));
                      } else {
                        setSelectedDiffIds(new Set());
                      }
                    }}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                  />
                  전체 선택
                </label>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedDiffIds(new Set(diffItems.map((d) => d.id)))}
                    className="text-xs text-primary font-medium hover:underline"
                  >
                    전체 체크
                  </button>
                  <span className="text-black/20 text-xs">|</span>
                  <button
                    type="button"
                    onClick={() => setSelectedDiffIds(new Set())}
                    className="text-xs text-ink-soft font-medium hover:underline"
                  >
                    전체 해제
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-emerald-800 bg-emerald-100 px-2.5 py-1 rounded-full border border-emerald-200">
                  선택됨: {selectedDiffIds.size} / {diffItems.length}개
                </span>
                <input
                  value={modalFilterQuery}
                  onChange={(e) => setModalFilterQuery(e.target.value)}
                  placeholder="식당명/주소로 결과 검색"
                  className="w-60 rounded-xl border border-black/10 px-3 py-1.5 text-xs outline-none focus:border-primary"
                />
              </div>
            </div>

            {/* 변경 항목 목록 */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gray-50/50">
              {diffItems
                .filter((item) => {
                  const q = modalFilterQuery.trim().toLowerCase();
                  if (!q) return true;
                  return item.name.toLowerCase().includes(q) || item.address.toLowerCase().includes(q);
                })
                .map((item) => {
                  const isSelected = selectedDiffIds.has(item.id);

                  let badgeBg = "bg-amber-100 border-amber-200 text-amber-800";
                  if (item.reason.includes("오매칭") || item.reason.includes("삭제") || item.reason.includes("초기화")) {
                    badgeBg = "bg-rose-100 border-rose-200 text-rose-800";
                  } else if (item.reason.includes("성공") || item.reason.includes("매칭")) {
                    badgeBg = "bg-emerald-100 border-emerald-200 text-emerald-800";
                  }

                  return (
                    <div
                      key={item.id}
                      onClick={() => {
                        setSelectedDiffIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(item.id)) next.delete(item.id);
                          else next.add(item.id);
                          return next;
                        });
                      }}
                      className={[
                        "flex cursor-pointer flex-col gap-3 rounded-2xl border p-4 transition shadow-sm",
                        isSelected ? "border-primary bg-white ring-2 ring-primary/20" : "border-black/10 bg-white/80 opacity-75 hover:opacity-100",
                      ].join(" ")}
                    >
                      {/* 가맹점 이름 & 사유 태그 헤더 */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}}
                            className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary shrink-0 cursor-pointer"
                          />
                          <div>
                            <h4 className="text-base font-bold text-ink">{item.name}</h4>
                            <p className="text-xs text-ink-soft mt-0.5">{item.address}</p>
                          </div>
                        </div>
                        <span className={`rounded-full border px-3 py-1 text-xs font-bold shrink-0 ${badgeBg}`}>
                          {item.reason}
                        </span>
                      </div>

                      {/* 1:1 대조 Diff 카드 (Before ➔ After) */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-1 text-xs">
                        {/* 기존 Before Box */}
                        <div className="rounded-xl border border-rose-100 bg-rose-50/50 p-3">
                          <div className="flex items-center justify-between border-b border-rose-100 pb-1.5 mb-2">
                            <span className="font-bold text-rose-800 text-xs flex items-center gap-1">
                              🔴 기존 정보 (Before)
                            </span>
                            <span className="text-[10px] font-semibold text-rose-600 bg-rose-100 px-1.5 py-0.5 rounded">
                              -[변경전]
                            </span>
                          </div>
                          <div className="space-y-1.5">
                            {item.details.map((detail, idx) => (
                              <div key={idx} className="flex items-start justify-between gap-2">
                                <span className="font-medium text-ink-soft shrink-0 text-[11px]">{detail.label}:</span>
                                <span className={detail.isChanged ? "font-semibold text-rose-700 bg-rose-100/80 px-1.5 py-0.5 rounded text-[11px] text-right" : "text-ink-soft text-right text-[11px]"}>
                                  {detail.before}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* 변경 예정 After Box */}
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                          <div className="flex items-center justify-between border-b border-emerald-200 pb-1.5 mb-2">
                            <span className="font-bold text-emerald-800 text-xs flex items-center gap-1">
                              🟢 변경 예정 (After)
                            </span>
                            <span className="text-[10px] font-semibold text-emerald-800 bg-emerald-200/80 px-1.5 py-0.5 rounded">
                              +[변경후]
                            </span>
                          </div>
                          <div className="space-y-1.5">
                            {item.details.map((detail, idx) => (
                              <div key={idx} className="flex items-start justify-between gap-2">
                                <span className="font-medium text-ink-soft shrink-0 text-[11px]">{detail.label}:</span>
                                <span className={detail.isChanged ? "font-bold text-emerald-900 bg-emerald-200/90 px-1.5 py-0.5 rounded text-[11px] text-right" : "text-ink text-right text-[11px]"}>
                                  {detail.after}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* 모달 하단 버튼 */}
            <div className="flex items-center justify-between border-t border-black/10 px-6 py-4 bg-surface-muted">
              <span className="text-xs text-ink-soft font-medium">
                체크 해제된 항목은 DB에 반영되지 않으며 기존 상태가 유지됩니다.
              </span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setAuditModalType(null)}
                  className="rounded-xl border border-black/10 bg-white px-4 py-2 text-xs font-semibold text-ink-soft hover:bg-surface-muted transition"
                >
                  취소
                </button>
                <button
                  onClick={handleApplyBatchUpdate}
                  disabled={isApplyingBatch || selectedDiffIds.size === 0}
                  className="rounded-xl bg-primary px-6 py-2.5 text-xs font-bold text-white shadow-soft transition hover:bg-primary-dark disabled:opacity-50"
                >
                  {isApplyingBatch
                    ? "DB에 반영하는 중..."
                    : `선택한 ${selectedDiffIds.size}개 항목 DB 반영하기`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isAuditing && <LoadingOverlay message="전체 가맹점 데이터를 점검하고 있습니다..." />}

      <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />
      {isNavigatingHome && <LoadingOverlay message="메인으로 이동하는 중..." />}
    </main>
  );
}
