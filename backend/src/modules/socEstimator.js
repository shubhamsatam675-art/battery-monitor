/**
 * socEstimator.js — SOC Calculation Module
 * Implements SWR-04: calculate State of Charge from voltage and current.
 *
 * Uses the standard fuel-gauge approach: coulomb counting (integrate measured
 * current over capacity) anchored by a slow open-circuit-voltage correction so
 * the estimate cannot drift. Result is a percentage in [0, 100] (SWR-04) and is
 * kept within ±5% of truth (NFR-03), which the verification suite checks.
 */

import { config } from "../config.js";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class SocEstimator {
  constructor() {
    this.reset();
  }

  reset(initialVoltage = config.voltage.maxV) {
    this.soc = this.socFromVoltage(initialVoltage, 0);
  }

  /** Invert the OCV curve to get SOC from a (IR-compensated) voltage. */
  socFromVoltage(voltage, current) {
    const { minV, maxV, internalResistanceOhm } = config.voltage;
    const ocv = voltage - current * internalResistanceOhm; // remove IR term
    return clamp(((ocv - minV) / (maxV - minV)) * 100, 0, 100);
  }

  /**
   * Update the SOC estimate.
   * @param voltage measured terminal voltage (V)
   * @param current measured current (A, + = charging)
   * @param dtSim   simulated seconds elapsed since last update
   */
  update(voltage, current, dtSim) {
    // Coulomb counting: ΔSOC% = (A·s / (Ah·3600)) · 100
    const deltaPct = (current * dtSim) / (config.capacityAh * 3600) * 100;
    let cc = this.soc + deltaPct;

    // Slow OCV correction (complementary filter) keeps it anchored to reality.
    const ocvSoc = this.socFromVoltage(voltage, current);
    const k = 0.02;
    this.soc = clamp(cc * (1 - k) + ocvSoc * k, 0, 100);
    return this.soc;
  }
}
