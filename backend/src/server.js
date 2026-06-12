/**
 * server.js — Communication Module transport (SWR-10)
 *
 * Runs the BMS on a fixed 1-second measurement cycle (NFR-01) and publishes the
 * output signals over a small REST API. In production it also serves the built
 * dashboard so the whole product is a single deployable service.
 */

import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { config } from "./config.js";
import { BMS } from "./bms.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
app.use(express.json());

// --- BMS runs automatically, one cycle per second (NFR-01, SRS §11) ----------
const bms = new BMS();
let last = Date.now();
setInterval(() => {
  const now = Date.now();
  bms.tick((now - last) / 1000);
  last = now;
}, config.sampleIntervalMs);

// --- API ---------------------------------------------------------------------

// Liveness probe.
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// The live BMS output signals (SRS §7).
app.get("/api/bms", (_req, res) => res.json(bms.output()));

// User control of the battery: charge | use | idle.
app.post("/api/control", (req, res) => {
  try {
    bms.setControl(req.body?.mode);
    res.json(bms.output());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// SOC history for the graph. range = day | week | month.
app.get("/api/history", (req, res) => {
  res.json(bms.getHistory(req.query?.range));
});

// Read / update thresholds at runtime (demonstrates NFR-04).
app.get("/api/config", (_req, res) => res.json(config));
app.post("/api/config", (req, res) => {
  const { voltage, temperature } = req.body ?? {};
  if (voltage) Object.assign(config.voltage, voltage);
  if (temperature) Object.assign(config.temperature, temperature);
  res.json(config);
});

// --- Verification aids (NFR-06) ---------------------------------------------

// Compress simulated time so the 20 h cycle is watchable (1 = real time).
app.post("/api/sim/speed", (req, res) => {
  try {
    bms.setTimeScale(req.body?.scale);
    res.json({ timeScale: bms.timeScale });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Inject an abnormal condition to verify alarms: overvoltage | undervoltage |
// overtemperature | none (SWR-06/07/08).
app.post("/api/sim/inject", (req, res) => {
  try {
    bms.injectFault(req.body?.fault);
    res.json({ fault: req.body?.fault });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/sim/reset", (_req, res) => {
  bms.reset();
  res.json(bms.output());
});

// --- Serve the built frontend in production ---------------------------------
const distDir = path.resolve(__dirname, "../../frontend/dist");
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`BMS API listening on http://localhost:${PORT}`);
  console.log(`States: ${config.rates.chargeHours}h charge / ${config.rates.useHours}h use / ${config.rates.idleHours}h idle, timeScale=${bms.timeScale}`);
  if (existsSync(distDir)) console.log(`Serving frontend from ${distDir}`);
});
