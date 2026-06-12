/**
 * bms.js — BMS orchestrator + Communication Module (SWR-10)
 *
 * Runs the pipeline each cycle (Sensor -> SOC -> SOH -> Safety -> Status),
 * derives the operational state (charging / charged / in use / idle / dead) and
 * a remaining-time estimate, records history for the graph, and assembles the
 * output signals for the API.
 */

import { config } from "./config.js";
import { SensorAcquisition } from "./modules/sensorAcquisition.js";
import { SocEstimator } from "./modules/socEstimator.js";
import { SohEstimator } from "./modules/sohEstimator.js";
import { evaluateAlarms } from "./modules/safetyMonitor.js";
import { classifyStatus } from "./modules/statusClassifier.js";

const round = (n, d = 2) => Number(n.toFixed(d));
const WINDOW_SEC = { day: 86400, week: 604800, month: 2592000 };
const STATE_LABEL = {
  charging: "Charging",
  charged: "Charged",
  use: "In use",
  idle: "Idle",
  dead: "Dead",
};

export class BMS {
  constructor() {
    this.sensors = new SensorAcquisition();
    this.soc = new SocEstimator();
    this.soh = new SohEstimator();
    this.timeScale = config.timeScale;
    this.simTimeS = 0;
    this.virtualEpochMs = Date.now();
    this.history = [];
    this._sinceSample = Infinity; // force an immediate first sample
    this._output = null;
    this.tick(0);
  }

  setTimeScale(scale) {
    const s = Number(scale);
    if (!Number.isFinite(s) || s < 1 || s > 5000) {
      throw new Error("scale must be a number between 1 and 5000");
    }
    this.timeScale = s;
  }

  injectFault(fault) {
    this.sensors.setFault(fault);
    this.tick(0);
  }

  setControl(mode) {
    this.sensors.setControl(mode);
    this.tick(0);
  }

  reset() {
    this.sensors.reset();
    this.soc.reset();
    this.soh.reset();
    this.simTimeS = 0;
    this.virtualEpochMs = Date.now();
    this.history = [];
    this._sinceSample = Infinity;
    this.tick(0);
  }

  tick(realDtS = config.sampleIntervalMs / 1000) {
    const dtSim = realDtS * this.timeScale;
    this.simTimeS += dtSim;

    const s = this.sensors.sample(dtSim);
    const soc = this.soc.update(s.voltage, s.current, dtSim);

    const isFull = soc >= 99.5;
    const isDead = soc <= 0.5 && s._state !== "charge";
    const atFullPlugged = s._state === "charge" && isFull;

    const { soh, cycles } = this.soh.update(s._deltaSoc, dtSim / 3600, atFullPlugged);
    const alarms = evaluateAlarms(s);
    const status = classifyStatus(s);

    // Operational state.
    let state;
    if (s._state === "charge") state = isFull ? "charged" : "charging";
    else if (s._state === "use") state = isDead ? "dead" : "use";
    else state = isDead ? "dead" : "idle";

    // Remaining usable time (only meaningful while discharging and alive).
    let remainingSeconds = null;
    if (state === "use") remainingSeconds = (soc / 100) * config.rates.useHours * 3600;
    else if (state === "idle") remainingSeconds = (soc / 100) * config.rates.idleHours * 3600;

    // Time to full (only while charging).
    const timeToFullSeconds =
      state === "charging" ? ((100 - soc) / 100) * config.rates.chargeHours * 3600 : null;

    this._recordHistory(dtSim, round(soc, 1));

    this._output = {
      soc: round(soc, 1),
      soh: round(soh, 2),
      status,
      state,
      stateLabel: STATE_LABEL[state],
      chargerPluggedIn: s._pluggedIn,
      voltageAlarm: alarms.voltageAlarm,
      temperatureAlarm: alarms.temperatureAlarm,
      alarmDetail: alarms.detail,
      remainingSeconds: remainingSeconds === null ? null : Math.round(remainingSeconds),
      timeToFullSeconds: timeToFullSeconds === null ? null : Math.round(timeToFullSeconds),
      inputs: {
        voltage: round(s.voltage, 3),
        current: round(s.current, 2),
        temperature: round(s.temperature, 1),
      },
      cycles,
      timeScale: this.timeScale,
      fault: this.sensors.injectedFault,
      updatedAt: new Date().toISOString(),
    };
    return this._output;
  }

  _recordHistory(dtSim, soc) {
    this._sinceSample += dtSim;
    if (this._sinceSample < config.history.resolutionSimSeconds) return;
    this._sinceSample = 0;
    this.history.push({ t: this.simTimeS, soc });
    const maxAge = config.history.maxAgeSimDays * 86400;
    const cutoff = this.simTimeS - maxAge;
    while (this.history.length && this.history[0].t < cutoff) this.history.shift();
  }

  /** Downsampled SOC history for the requested window. */
  getHistory(range = "day") {
    const windowSec = WINDOW_SEC[range] ?? WINDOW_SEC.day;
    const from = this.simTimeS - windowSec;
    const pts = this.history.filter((p) => p.t >= from);
    const step = Math.max(1, Math.ceil(pts.length / 200));
    const sampled = pts.filter((_, i) => i % step === 0);
    return {
      range,
      points: sampled.map((p) => ({
        ts: new Date(this.virtualEpochMs + p.t * 1000).toISOString(),
        soc: p.soc,
      })),
    };
  }

  output() {
    return this._output;
  }
}
