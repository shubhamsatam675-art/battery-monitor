/**
 * swe4_unit_verification.test.js
 * INDEPENDENT Software Unit Verification (Automotive SPICE SWE.4).
 *
 * Authored by the SWE.4 team. Unlike the developer's verify.js (which exercises
 * the assembled BMS), this suite verifies each software UNIT directly against
 * its detailed design and the SRS requirement it claims to implement.
 *
 * Run:  node --test test/swe4_unit_verification.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { config } from "../src/config.js";
import { SensorAcquisition } from "../src/modules/sensorAcquisition.js";
import { SocEstimator } from "../src/modules/socEstimator.js";
import { SohEstimator } from "../src/modules/sohEstimator.js";
import { evaluateAlarms } from "../src/modules/safetyMonitor.js";
import { classifyStatus } from "../src/modules/statusClassifier.js";
import { BMS } from "../src/bms.js";

const finite = (x) => Number.isFinite(x);

/* =====================================================================
 * UNIT: sensorAcquisition.js  (SWR-01 / 02 / 03)
 * ===================================================================== */

test("U-SENS-01 setControl rejects an invalid control", () => {
  const s = new SensorAcquisition();
  assert.throws(() => s.setControl("explode"), /Unknown control/);
});

test("U-SENS-02 setFault rejects an invalid fault", () => {
  const s = new SensorAcquisition();
  assert.throws(() => s.setFault("meltdown"), /Unknown fault/);
});

test("U-SENS-03 OCV curve maps SOC endpoints to voltage limits", () => {
  const s = new SensorAcquisition();
  assert.equal(s.ocv(0), config.voltage.minV);
  assert.equal(s.ocv(100), config.voltage.maxV);
});

test("U-SENS-04 sampled V/I/T stay inside the SRS §6 ranges", () => {
  const s = new SensorAcquisition();
  for (const ctrl of ["use", "charge", "idle"]) {
    s.setControl(ctrl);
    for (let i = 0; i < 500; i++) {
      const m = s.sample(60);
      assert.ok(m.voltage >= 0 && m.voltage <= 5, `V=${m.voltage}`);
      assert.ok(m.current >= -100 && m.current <= 100, `I=${m.current}`);
      assert.ok(m.temperature >= -40 && m.temperature <= 100, `T=${m.temperature}`);
    }
  }
});

test("U-SENS-05 charge raises true SOC; use/idle lower it", () => {
  const c = new SensorAcquisition();
  c.setControl("use"); c.sample(3600); // drop below 100 first
  const before = c.trueSoc;
  c.setControl("charge"); c.sample(3600);
  assert.ok(c.trueSoc > before, "charge should raise SOC");

  const d = new SensorAcquisition();
  const start = d.trueSoc;
  d.setControl("use"); d.sample(3600);
  assert.ok(d.trueSoc < start, "use should lower SOC");
});

test("U-SENS-06 at 0% and not charging the cell is Dead with no current", () => {
  const s = new SensorAcquisition();
  s.setControl("use");
  for (let i = 0; i < 2000; i++) s.sample(60); // drain fully
  const m = s.sample(60);
  assert.ok(s.trueSoc <= 0.0001, `trueSoc=${s.trueSoc}`);
  assert.equal(s.isDead, true);
  // True current is forced to 0 when dead; measured current still carries the
  // ±0.02 A sensor noise, so verify against the noise band (not exact zero).
  assert.ok(Math.abs(m.current) < 0.1, `current=${m.current}`);
});

test("U-SENS-07 injected overvoltage drives terminal voltage above the trip", () => {
  const s = new SensorAcquisition();
  s.setFault("overvoltage");
  assert.ok(s.sample(1).voltage >= config.voltage.critHighV);
});

/* =====================================================================
 * UNIT: socEstimator.js  (SWR-04, NFR-03)
 * ===================================================================== */

test("U-SOC-01 socFromVoltage maps voltage limits to 100% / 0%", () => {
  const e = new SocEstimator();
  assert.equal(e.socFromVoltage(config.voltage.maxV, 0), 100);
  assert.equal(e.socFromVoltage(config.voltage.minV, 0), 0);
});

test("U-SOC-02 SOC estimate is clamped to [0, 100]", () => {
  const e = new SocEstimator();
  assert.equal(e.socFromVoltage(99, 0), 100);   // far above maxV -> clamp high
  assert.equal(e.socFromVoltage(-99, 0), 0);    // far below minV -> clamp low
});

test("U-SOC-03 positive current (charging) increases the estimate", () => {
  const e = new SocEstimator();
  e.reset(config.voltage.minV);          // start near empty
  const s0 = e.soc;
  const s1 = e.update(config.voltage.minV, 50, 600); // +50 A for 600 s
  assert.ok(s1 > s0, `expected rise, got ${s0} -> ${s1}`);
});

test("U-SOC-04 reset seeds SOC from the supplied voltage", () => {
  const e = new SocEstimator();
  e.reset(config.voltage.maxV);
  assert.equal(e.soc, 100);
});

/* =====================================================================
 * UNIT: sohEstimator.js  (SWR-05)
 * ===================================================================== */

test("U-SOH-01 one full cycle (100% chg + 100% dis) = 1 cycle & SOH drop", () => {
  const e = new SohEstimator();
  const soh0 = e.soh;
  e.update(+100, 0, false); // 100% charge accumulated
  e.update(-100, 0, false); // 100% discharge accumulated
  assert.equal(e.cycles, 1);
  assert.ok(
    Math.abs(soh0 - e.soh - config.soh.degradationPerCyclePercent) < 1e-9,
    `SOH drop ${soh0 - e.soh}`
  );
});

test("U-SOH-02 discharge alone does not count a cycle", () => {
  const e = new SohEstimator();
  e.update(-100, 0, false);
  assert.equal(e.cycles, 0);
});

test("U-SOH-03 calendar ageing reduces SOH while held full + plugged", () => {
  const e = new SohEstimator();
  const soh0 = e.soh;
  e.update(0, 10, true); // 10 simulated hours at full, plugged
  assert.ok(e.soh < soh0, `SOH should age: ${soh0} -> ${e.soh}`);
});

test("U-SOH-04 SOH never goes below 0%", () => {
  const e = new SohEstimator();
  for (let i = 0; i < 100000; i++) { e.update(+100, 0, false); e.update(-100, 0, false); }
  assert.ok(e.soh >= 0, `SOH=${e.soh}`);
});

/* =====================================================================
 * UNIT: safetyMonitor.js  (SWR-06 / 07 / 08)
 * ===================================================================== */

test("U-SAFE-01 overvoltage at/above trip raises the voltage alarm", () => {
  const a = evaluateAlarms({ voltage: config.voltage.critHighV, temperature: 25 });
  assert.equal(a.voltageAlarm, true);
  assert.equal(a.detail.overvoltage, true);
});

test("U-SAFE-02 undervoltage at/below trip raises the voltage alarm", () => {
  const a = evaluateAlarms({ voltage: config.voltage.critLowV, temperature: 25 });
  assert.equal(a.voltageAlarm, true);
  assert.equal(a.detail.undervoltage, true);
});

test("U-SAFE-03 overtemperature at/above trip raises the temperature alarm", () => {
  const a = evaluateAlarms({ voltage: 3.8, temperature: config.temperature.critHighC });
  assert.equal(a.temperatureAlarm, true);
  assert.equal(a.detail.overtemperature, true);
});

test("U-SAFE-04 nominal V/T raise no alarms", () => {
  const a = evaluateAlarms({ voltage: 3.8, temperature: 25 });
  assert.equal(a.voltageAlarm, false);
  assert.equal(a.temperatureAlarm, false);
});

/* =====================================================================
 * UNIT: statusClassifier.js  (SWR-09)
 * ===================================================================== */

test("U-STAT-01 all parameters nominal -> Normal", () => {
  assert.equal(classifyStatus({ voltage: 3.8, temperature: 25 }), "Normal");
});

test("U-STAT-02 a parameter exceeding its limit -> Critical", () => {
  assert.equal(classifyStatus({ voltage: config.voltage.critHighV, temperature: 25 }), "Critical");
});

test("U-STAT-03 a parameter in the warning band -> Warning (unit level)", () => {
  // Voltage strictly between warnHighV and critHighV.
  const vWarn = (config.voltage.warnHighV + config.voltage.critHighV) / 2;
  assert.equal(classifyStatus({ voltage: vWarn, temperature: 25 }), "Warning");
});

test("U-STAT-04 Critical takes precedence over Warning at the limit", () => {
  assert.equal(classifyStatus({ voltage: 3.8, temperature: config.temperature.critHighC }), "Critical");
});

/* =====================================================================
 * UNIT: bms.js orchestrator + history  (SWR-10)  &  edge cases
 * ===================================================================== */

test("U-BMS-01 output() exposes every required signal, all finite/defined", () => {
  const bms = new BMS();
  const o = bms.tick(1);
  for (const k of [
    "soc", "soh", "status", "state", "stateLabel",
    "voltageAlarm", "temperatureAlarm", "cycles", "inputs",
  ]) assert.ok(k in o, `missing ${k}`);
  assert.ok(finite(o.soc) && finite(o.soh) && finite(o.cycles));
  assert.ok(finite(o.inputs.voltage) && finite(o.inputs.current) && finite(o.inputs.temperature));
});

test("U-BMS-02 remaining time is null while charging", () => {
  const bms = new BMS();
  bms.setControl("charge");
  assert.equal(bms.tick(1).remainingSeconds, null);
});

test("U-BMS-03 history points carry timestamp and SOC", () => {
  const bms = new BMS();
  bms.setControl("use");
  bms.setTimeScale(60);
  for (let i = 0; i < 300; i++) bms.tick(1);
  const h = bms.getHistory("day");
  assert.ok(h.points.length > 0);
  assert.ok("ts" in h.points[0] && "soc" in h.points[0]);
});

test("U-EDGE-01 setTimeScale rejects out-of-range values", () => {
  const bms = new BMS();
  assert.throws(() => bms.setTimeScale(0));
  assert.throws(() => bms.setTimeScale(99999));
  assert.throws(() => bms.setTimeScale(NaN));
});

test("U-EDGE-02 unknown history range falls back to a valid window", () => {
  const bms = new BMS();
  bms.setControl("use");
  bms.setTimeScale(60);
  for (let i = 0; i < 120; i++) bms.tick(1);
  const h = bms.getHistory("century");
  assert.ok(Array.isArray(h.points));
});
