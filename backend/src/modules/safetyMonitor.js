/**
 * safetyMonitor.js — Safety Monitoring Module
 * Implements SWR-06 (overvoltage), SWR-07 (undervoltage), SWR-08 (overtemperature).
 *
 * Produces the two boolean alarm outputs from SRS §7 (Voltage Alarm,
 * Temperature Alarm) plus detail about which condition tripped, so the cause is
 * visible to a user or monitoring application.
 */

import { config } from "../config.js";

export function evaluateAlarms({ voltage, temperature }) {
  const v = config.voltage;
  const t = config.temperature;

  const overvoltage = voltage >= v.critHighV; // SWR-06
  const undervoltage = voltage <= v.critLowV; // SWR-07
  const overtemperature = temperature >= t.critHighC; // SWR-08

  return {
    voltageAlarm: overvoltage || undervoltage, // SRS §7 boolean
    temperatureAlarm: overtemperature, // SRS §7 boolean
    detail: { overvoltage, undervoltage, overtemperature },
  };
}
