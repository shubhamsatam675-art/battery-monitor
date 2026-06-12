/**
 * sohEstimator.js — SOH Estimation Module (SWR-05)
 *
 * SOH (%) decreases with use. Two mechanisms:
 *   - Cycle ageing: one cycle = cumulative 100% charge AND 100% discharge.
 *     Each completed cycle reduces SOH by degradationPerCyclePercent.
 *   - Calendar ageing: while held at 100% with the charger plugged in, SOH
 *     declines very slowly (high state-of-charge stress).
 */

import { config } from "../config.js";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class SohEstimator {
  constructor() {
    this.reset();
  }

  reset() {
    this.soh = config.soh.initialPercent;
    this.cumChargePct = 0;
    this.cumDischargePct = 0;
    this.cycles = 0;
  }

  /**
   * @param deltaSocPct  signed SOC change this tick (+ charge, - discharge)
   * @param dtSimHours   simulated hours elapsed this tick
   * @param atFullPlugged true when held at 100% with the charger connected
   */
  update(deltaSocPct, dtSimHours, atFullPlugged) {
    if (deltaSocPct > 0) this.cumChargePct += deltaSocPct;
    else this.cumDischargePct += -deltaSocPct;

    // A cycle needs 100% of charge AND 100% of discharge accumulated.
    const EPS = 1e-6;
    while (this.cumChargePct >= 100 - EPS && this.cumDischargePct >= 100 - EPS) {
      this.cumChargePct -= 100;
      this.cumDischargePct -= 100;
      this.cycles += 1;
      this.soh = clamp(this.soh - config.soh.degradationPerCyclePercent, 0, 100);
    }

    if (atFullPlugged) {
      this.soh = clamp(
        this.soh - config.soh.calendarAgingPerHourAtFull * dtSimHours,
        0,
        100
      );
    }
    return { soh: this.soh, cycles: this.cycles };
  }
}
