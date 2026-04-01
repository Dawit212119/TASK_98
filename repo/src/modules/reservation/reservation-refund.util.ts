import { RefundStatus } from './entities/reservation.entity';

export type RefundComputation = { refund_percentage: number; refund_status: RefundStatus };

/**
 * Rule-based refund preview for cancellation (≥24h full, 2–24h half, &lt;2h none).
 * Acceptance / maintainability: extracted from ReservationService for clarity and unit testing.
 */
export function computeReservationRefund(startTime: Date | null, referenceMs: number = Date.now()): RefundComputation {
  if (!startTime) {
    return { refund_percentage: 0, refund_status: RefundStatus.NONE };
  }

  const diffMs = startTime.getTime() - referenceMs;
  const hours = diffMs / (1000 * 60 * 60);

  if (hours >= 24) {
    return { refund_percentage: 100, refund_status: RefundStatus.FULL };
  }
  if (hours >= 2) {
    return { refund_percentage: 50, refund_status: RefundStatus.PARTIAL };
  }
  return { refund_percentage: 0, refund_status: RefundStatus.NONE };
}
