/**
 * statusClassifier.js — Battery Status Module
 * Implements SWR-09 and the Battery Status Logic in SRS §8.
 *
 *   All parameters within limits ............ Normal
 *   Voltage or temperature near threshold ... Warning
 *   Voltage or temperature exceeds threshold  Critical
 *
 * Status is based on voltage and temperature only, exactly as specified.
 */

import { config } from "../config.js";

export function classifyStatus({ voltage, temperature }) {
  const v = config.voltage;
  const t = config.temperature;

  const exceeds =
    voltage >= v.critHighV || voltage <= v.critLowV || temperature >= t.critHighC;
  const near =
    voltage >= v.warnHighV || voltage <= v.warnLowV || temperature >= t.warnHighC;

  if (exceeds) return "Critical";
  if (near) return "Warning";
  return "Normal";
}
