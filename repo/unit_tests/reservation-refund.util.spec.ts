/**
 * Acceptance: maintainability — refund rules isolated in util (same behavior as prior ReservationService).
 */
import { RefundStatus } from '../src/modules/reservation/entities/reservation.entity';
import { computeReservationRefund } from '../src/modules/reservation/reservation-refund.util';

describe('computeReservationRefund', () => {
  const ref = Date.UTC(2026, 5, 1, 12, 0, 0);

  it('returns full refund when start is 25h ahead', () => {
    const start = new Date(ref + 25 * 60 * 60 * 1000);
    expect(computeReservationRefund(start, ref)).toEqual({
      refund_percentage: 100,
      refund_status: RefundStatus.FULL
    });
  });

  it('returns partial when start is 3h ahead', () => {
    const start = new Date(ref + 3 * 60 * 60 * 1000);
    expect(computeReservationRefund(start, ref)).toEqual({
      refund_percentage: 50,
      refund_status: RefundStatus.PARTIAL
    });
  });

  it('returns none when start is 1h ahead', () => {
    const start = new Date(ref + 1 * 60 * 60 * 1000);
    expect(computeReservationRefund(start, ref)).toEqual({
      refund_percentage: 0,
      refund_status: RefundStatus.NONE
    });
  });
});
