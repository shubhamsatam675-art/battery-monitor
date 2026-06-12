/**
 * sensorAcquisition.js — Sensor Acquisition Module
 * Implements SWR-01 (voltage), SWR-02 (current), SWR-03 (temperature).
 *
 * Drives the battery's *true* state through one of three operating states and
 * emits measured V, I, T (SRS §6):
 *   - charge : charger plugged in, fills to 100% in chargeHours, then holds
 *   - use    : active discharge, empties in useHours
 *   - idle   : standby self-discharge (default), empties in idleHours
 * At 0% the battery is "dead" and holds until charging resumes.
 */

import { config } from "../config.js";

const noise = (amp) => (Math.random() - 0.5) * 2 * amp;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class SensorAcquisition {
  constructor() {
    this.reset();
  }

  reset() {
    this.trueSoc = 100;
    this.state = "idle"; // 'charge' | 'use' | 'idle'
    this.tempC = config.temperature.ambientC;
    this.injectedFault = "none";
    this.lastDeltaSoc = 0;
  }

  /** User control: charge | use | idle. */
  setControl(state) {
    if (!["charge", "use", "idle"].includes(state)) {
      throw new Error(`Unknown control: ${state}`);
    }
    this.state = state;
  }

  setFault(fault) {
    const allowed = ["none", "overvoltage", "undervoltage", "overtemperature"];
    if (!allowed.includes(fault)) throw new Error(`Unknown fault: ${fault}`);
    this.injectedFault = fault;
  }

  get chargerPluggedIn() {
    return this.state === "charge";
  }

  get isDead() {
    return this.trueSoc <= 0 && this.state !== "charge";
  }

  ocv(soc) {
    const { minV, maxV } = config.voltage;
    return minV + (maxV - minV) * (soc / 100);
  }

  sample(dtSim) {
    const r = config.rates;
    const ratePctPerS = {
      charge: 100 / (r.chargeHours * 3600),
      use: 100 / (r.useHours * 3600),
      idle: 100 / (r.idleHours * 3600),
    };
    const ampsFor = (pctPerS) => (pctPerS / 100) * config.capacityAh * 3600;

    let trueCurrent = 0;
    const before = this.trueSoc;

    if (this.state === "charge") {
      if (this.trueSoc < 100) {
        trueCurrent = ampsFor(ratePctPerS.charge);
        this.trueSoc += ratePctPerS.charge * dtSim;
      } else {
        trueCurrent = 0; // full: pass-through, held at 100%
      }
    } else {
      // use or idle => gradual discharge unless already dead
      if (this.trueSoc > 0) {
        const pctPerS = ratePctPerS[this.state];
        trueCurrent = -ampsFor(pctPerS);
        this.trueSoc -= pctPerS * dtSim;
      } else {
        trueCurrent = 0; // dead: holds at 0
      }
    }

    this.trueSoc = clamp(this.trueSoc, 0, 100);
    if (this.trueSoc <= 0 && this.state !== "charge") trueCurrent = 0;
    if (this.trueSoc >= 100 && this.state === "charge") trueCurrent = 0;
    this.lastDeltaSoc = this.trueSoc - before;

    // Temperature drifts toward a load-dependent target.
    const target =
      config.temperature.ambientC +
      Math.abs(trueCurrent) * config.temperature.risePerAmpC;
    this.tempC += (target - this.tempC) * 0.05 + noise(0.05);

    // Measured signals.
    let voltage =
      this.ocv(this.trueSoc) +
      trueCurrent * config.voltage.internalResistanceOhm +
      noise(0.005);
    let current = trueCurrent + noise(0.02);
    let temperature = this.tempC + noise(0.1);

    if (this.injectedFault === "overvoltage") voltage = config.voltage.critHighV + 0.1;
    else if (this.injectedFault === "undervoltage") voltage = config.voltage.critLowV - 0.1;
    else if (this.injectedFault === "overtemperature") temperature = config.temperature.critHighC + 5;

    return {
      voltage: clamp(voltage, 0, 5),
      current: clamp(current, -100, 100),
      temperature: clamp(temperature, -40, 100),
      _trueSoc: this.trueSoc,
      _state: this.state,
      _pluggedIn: this.chargerPluggedIn,
      _dead: this.isDead,
      _deltaSoc: this.lastDeltaSoc,
    };
  }
}
