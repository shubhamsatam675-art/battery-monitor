/**
 * verify.js — Requirement verification suite (NFR-06). Run: node --test
 * Tests fast-forward the simulation with a large time scale.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { BMS } from "../src/bms.js";
import { config } from "../src/config.js";

function run(bms, steps, scale, cb) {
  bms.setTimeScale(scale);
  for (let i = 0; i < steps; i++) {
    const out = bms.tick(1);
    if (cb) cb(out, bms);
  }
}

test("SWR-01/02/03: measured inputs stay within the SRS §6 ranges", () => {
  const bms = new BMS();
  bms.setControl("use");
  run(bms, 1500, 60, (out) => {
    const { voltage, current, temperature } = out.inputs;
    assert.ok(voltage >= 0 && voltage <= 5);
    assert.ok(current >= -100 && current <= 100);
    assert.ok(temperature >= -40 && temperature <= 100);
  });
  bms.setControl("charge");
  run(bms, 1500, 60, (out) => {
    assert.ok(out.inputs.voltage <= 5 && out.inputs.current <= 100);
  });
});

test("SWR-04: SOC is a percentage within [0, 100]", () => {
  const bms = new BMS();
  bms.setControl("use");
  run(bms, 3000, 120, (out) => assert.ok(out.soc >= 0 && out.soc <= 100));
});

test("NFR-03: estimated SOC tracks true SOC within ±5%", () => {
  const bms = new BMS();
  let maxErr = 0;
  bms.setControl("use");
  run(bms, 2500, 60, (out, b) => {
    maxErr = Math.max(maxErr, Math.abs(out.soc - b.sensors.trueSoc));
  });
  bms.setControl("charge");
  run(bms, 2500, 60, (out, b) => {
    maxErr = Math.max(maxErr, Math.abs(out.soc - b.sensors.trueSoc));
  });
  assert.ok(maxErr <= 5, `max SOC error ${maxErr.toFixed(2)}%`);
});

test("Idle discharges more slowly than On Use", () => {
  const idle = new BMS();
  idle.setControl("idle");
  run(idle, 600, 60);
  const useB = new BMS();
  useB.setControl("use");
  run(useB, 600, 60);
  const idleDrop = 100 - idle.output().soc;
  const useDrop = 100 - useB.output().soc;
  assert.ok(useDrop > idleDrop, `use ${useDrop} should drop faster than idle ${idleDrop}`);
});

test("Battery reads Dead at 0% and stops discharging", () => {
  const bms = new BMS();
  bms.setControl("use");
  run(bms, 4000, 200); // long enough to fully drain
  const out = bms.output();
  assert.ok(out.soc <= 0.5, `soc ${out.soc}`);
  assert.equal(out.state, "dead");
  assert.equal(out.stateLabel, "Dead");
  assert.ok(Math.abs(out.inputs.current) < 0.1, "no current when dead");
});

test("Charging fills to 100% then holds as Charged (no discharge)", () => {
  const bms = new BMS();
  bms.setControl("use");
  run(bms, 800, 200); // drain a bit first
  bms.setControl("charge");
  run(bms, 4000, 200); // charge to full and keep plugged in
  const out = bms.output();
  assert.ok(out.soc >= 99.5, `soc ${out.soc}`);
  assert.equal(out.state, "charged");
  assert.equal(out.chargerPluggedIn, true);
  assert.ok(Math.abs(out.inputs.current) < 0.1, "no discharge while full + plugged");
});

test("Remaining time is shown while discharging, hidden when charging/dead", () => {
  const bms = new BMS();
  bms.setControl("use");
  run(bms, 50, 10);
  assert.ok(bms.output().remainingSeconds > 0, "use => remaining time present");
  bms.setControl("charge");
  run(bms, 5, 10);
  assert.equal(bms.output().remainingSeconds, null, "charging => no remaining-usage time");
});

test("Cycle = cumulative 100% charge AND 100% discharge", () => {
  const bms = new BMS();
  assert.equal(bms.output().cycles, 0);
  bms.setControl("use");
  run(bms, 4000, 200); // 100% discharge
  assert.equal(bms.output().cycles, 0, "discharge alone is not a cycle");
  bms.setControl("charge");
  run(bms, 4000, 200); // 100% charge
  assert.equal(bms.output().cycles, 1, "one full charge + discharge = 1 cycle");
});

test("SWR-09: normal operation reads Normal with no alarms", () => {
  const bms = new BMS();
  bms.setControl("use");
  let ok = true;
  run(bms, 1500, 30, (out) => {
    if (out.status !== "Normal" || out.voltageAlarm || out.temperatureAlarm) ok = false;
  });
  assert.ok(ok);
});

test("SWR-06/07/08: injected faults raise alarms and Critical status", () => {
  for (const [fault, key] of [
    ["overvoltage", "overvoltage"],
    ["undervoltage", "undervoltage"],
    ["overtemperature", "overtemperature"],
  ]) {
    const bms = new BMS();
    bms.injectFault(fault);
    const out = bms.tick(1);
    assert.equal(out.alarmDetail[key], true, `${fault} detail`);
    assert.equal(out.status, "Critical", `${fault} status`);
  }
});

test("History endpoint returns SOC points for a range", () => {
  const bms = new BMS();
  bms.setControl("use");
  run(bms, 500, 60);
  const h = bms.getHistory("day");
  assert.equal(h.range, "day");
  assert.ok(h.points.length > 0);
  assert.ok("ts" in h.points[0] && "soc" in h.points[0]);
});

test("NFR-04: thresholds are configurable without code changes", () => {
  const original = config.temperature.critHighC;
  config.temperature.critHighC = 30;
  const bms = new BMS();
  bms.injectFault("overtemperature");
  assert.equal(bms.tick(1).temperatureAlarm, true);
  config.temperature.critHighC = original;
});
