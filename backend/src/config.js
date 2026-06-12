/**
 * config.js — All tunable parameters in one place (NFR-04).
 * Chemistry/assumptions follow SWE.1 SRS §11: Li-ion, 1 s cycle, simulated data.
 */

export const config = {
  sampleIntervalMs: 1000, // NFR-01 / SRS §11: one update per second
  capacityAh: 50, // chosen battery parameter

  // Time (hours) for each operating state to traverse 0<->100% SOC.
  rates: {
    chargeHours: 8, // charging to full
    useHours: 12, // active use ("On Use") to empty
    idleHours: 24, // standby self-discharge to empty (the default state)
  },

  // Voltage model + thresholds (V). Input range per SRS §6 is 0–5 V.
  voltage: {
    minV: 3.0,
    maxV: 4.2,
    internalResistanceOhm: 0.01,
    warnHighV: 4.32,
    critHighV: 4.45, // overvoltage alarm (SWR-06)
    warnLowV: 2.88,
    critLowV: 2.75, // undervoltage alarm (SWR-07)
  },

  // Temperature model + thresholds (°C). Input range per SRS §6 is -40–100 °C.
  temperature: {
    ambientC: 25,
    risePerAmpC: 1.0,
    warnHighC: 40,
    critHighC: 45, // overtemperature alarm (SWR-08)
  },

  // SOH degradation (SWR-05).
  soh: {
    initialPercent: 100,
    degradationPerCyclePercent: 0.03, // wear per full cycle
    calendarAgingPerHourAtFull: 0.002, // ageing while held at 100% plugged in
  },

  // History buffer for the day/week/month graph.
  history: {
    resolutionSimSeconds: 60, // record one point per simulated minute
    maxAgeSimDays: 30,
  },

  // Verification aid: compress simulated time. 1 = real time.
  timeScale: Number(process.env.TIME_SCALE) || 1,
};
