// 좌표 계산 관련 순수 함수 모음. 클라이언트/서버/스크립트 어디서든 import 가능 (firebase 등 외부 의존성 없음).

// 도시 보도망 우회율 보정 계수 (Circuitry Factor / Detour Index): 1.35 (직선거리 대비 실제 보도 우회율)
export const PEDESTRIAN_CIRCUITRY_FACTOR = 1.35;
// 성인 평균 보행 속도: 67m/min (시속 약 4km/h 기준)
export const WALKING_SPEED_METERS_PER_MIN = 67;

// 두 좌표 간 거리(m) - Haversine 공식
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function calculateEstimatedWalkingMeters(straightLineMeters: number): number {
  return Math.round(straightLineMeters * PEDESTRIAN_CIRCUITRY_FACTOR);
}

export function calculateWalkingMinutes(walkingMeters: number): number {
  return Math.max(1, Math.round(walkingMeters / WALKING_SPEED_METERS_PER_MIN));
}

export function formatWalkingDistance(straightLineMeters?: number | null): string {
  if (typeof straightLineMeters !== "number" || Number.isNaN(straightLineMeters)) return "";
  const walkingMeters = calculateEstimatedWalkingMeters(straightLineMeters);
  const minutes = calculateWalkingMinutes(walkingMeters);
  return `도보 ${minutes}분 (${walkingMeters}m)`;
}
