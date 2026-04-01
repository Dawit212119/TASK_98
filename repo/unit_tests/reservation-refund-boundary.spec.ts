/**
 * Unit tests for computeReservationRefund boundary conditions.
 * Verifies exact thresholds at 24h, 2h cutoffs.
 */
import { computeReservationRefund } from '../src/modules/reservation/reservation-refund.util';
import { RefundStatus } from '../src/modules/reservation/entities/reservation.entity';

describe('computeReservationRefund boundary conditions', () => {
  const MS = 1000;
  const MIN = 60 * MS;
  const HR = 60 * MIN;

  const refNow = new Date('2026-06-01T12:00:00.000Z').getTime();

  it('returns 100% refund exactly 24 hours before start', () => {
    const startTime = new Date(refNow + 24 * HR);
    const result = computeReservationRefund(startTime, refNow);
    expect(result.refund_percentage).toBe(100);
    expect(result.refund_status).toBe(RefundStatus.FULL);
  });

  it('returns 50% refund at 23h 59m 59s before start', () => {
    const startTime = new Date(refNow + 24 * HR - MS);
    const result = computeReservationRefund(startTime, refNow);
    expect(result.refund_percentage).toBe(50);
    expect(result.refund_status).toBe(RefundStatus.PARTIAL);
  });

  it('returns 50% refund exactly 2 hours before start', () => {
    const startTime = new Date(refNow + 2 * HR);
    const result = computeReservationRefund(startTime, refNow);
    expect(result.refund_percentage).toBe(50);
    expect(result.refund_status).toBe(RefundStatus.PARTIAL);
  });

  it('returns 0% refund at 1h 59m 59s before start', () => {
    const startTime = new Date(refNow + 2 * HR - MS);
    const result = computeReservationRefund(startTime, refNow);
    expect(result.refund_percentage).toBe(0);
    expect(result.refund_status).toBe(RefundStatus.NONE);
  });
});
