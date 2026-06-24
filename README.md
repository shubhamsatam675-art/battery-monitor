# VOLTA · Battery Monitoring System (BMS)
### Group Members :
* **Shubham Satam** (ID: [00186968])
* **Prabhu Karangutkar** (ID: [00186601])
* **Ojas Ghugare** (ID: [00186567])
* **Date:** June 24, 2026

An implementation of the **ASPICE SWE.1** Battery Monitoring System requirements
(Lithium-Ion, simulated sensors). The backend simulates a battery, computes the
BMS outputs, and publishes them over a REST API; the frontend shows everything
live with a charge/discharge graph.

- **`backend/`** — Node.js + Express. Modular BMS pipeline (one module per
  requirement group) on a 1-second measurement cycle.
- **`frontend/`** — Vite + Tailwind + Chart.js. Live dashboard and controls.

## Operating model

| State | Behaviour |
| --- | --- |
| **Charge** | Charger plugged in; fills to 100% in 8 h, then holds (pass-through, no discharge) |
| **On use** | Active discharge; empties in 12 h |
| **Idle** (default) | Standby self-discharge; empties in 24 h — happens on its own, no button needed |
| **Charged** | At 100%; shows "Charger still plugged in" while connected |
| **Dead** | At 0%; discharge stops until charging resumes |

The dashboard shows the **remaining usable time** while discharging and **time to
full** while charging — never the raw 8 h/12 h scale. Holding at 100% while
plugged in slowly ages **SOH** (calendar ageing), it does not discharge SOC.

A **cycle** counts when cumulative charge reaches 100% **and** cumulative
discharge reaches 100%.

## Requirement coverage

| Requirement | Implemented in |
| --- | --- |
| SWR-01/02/03 — voltage, current, temperature | `backend/src/modules/sensorAcquisition.js` |
| SWR-04 — SOC from V and I | `backend/src/modules/socEstimator.js` |
| SWR-05 — SOH (cycle + calendar ageing) | `backend/src/modules/sohEstimator.js` |
| SWR-06/07/08 — alarms | `backend/src/modules/safetyMonitor.js` |
| SWR-09 — Normal / Warning / Critical | `backend/src/modules/statusClassifier.js` |
| SWR-10 — communicate outputs | `backend/src/bms.js` + `backend/src/server.js` |
| NFR-01/03/04/06 | 1 s loop · SOC ±5% · `config.js` thresholds · `backend/test/verify.js` |

## Chosen parameters (`backend/src/config.js`)

- Li-ion, OCV 3.0 V (0%) → 4.2 V (100%); capacity 50 Ah.
- Times: 8 h charge, 12 h on-use discharge, 24 h idle discharge.
- Voltage alarms: under 2.75 V / over 4.45 V; temperature: warn 40 °C, crit 45 °C.
- All tunable here without code changes (NFR-04).

## 1. Run locally (development)

Two terminals:

```bash
cd backend && npm install && npm run dev      # API on :3001
cd frontend && npm install && npm run dev      # dashboard on :5173
```

Open **http://localhost:5173**. By default the battery sits in **Idle** and drains
slowly on its own. Use **Control** (Charge / On use / Idle) to drive it, switch the
graph between **Day / Week / Month**, and bump **Sim speed** (1× / 60× / 600×) to
fast-forward — 600× runs the 12 h discharge in ~72 s. **Inject fault** verifies the
alarms and **Critical** status.

## 2. Run as a single service (production)

```bash
cd frontend && npm install && npm run build
cd ../backend && npm install && npm start       # serves dashboard + API on :3001
```

## 3. Verify (NFR-06)

```bash
cd backend && npm test
```

## 4. API reference

| Method | Path | Body | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | — | Liveness probe |
| GET | `/api/bms` | — | Live output signals |
| GET | `/api/history?range=day` | — | SOC history: `day` \| `week` \| `month` |
| POST | `/api/control` | `{ "mode": "charge" }` | `charge` \| `use` \| `idle` |
| GET / POST | `/api/config` | thresholds | Read / update thresholds (NFR-04) |
| POST | `/api/sim/speed` | `{ "scale": 600 }` | Time compression (1–5000) |
| POST | `/api/sim/inject` | `{ "fault": "overtemperature" }` | `overvoltage` \| `undervoltage` \| `overtemperature` \| `none` |
| POST | `/api/sim/reset` | — | Reset |

Example `GET /api/bms`:

```json
{
  "soc": 97.2, "soh": 100, "status": "Normal",
  "state": "use", "stateLabel": "In use", "chargerPluggedIn": false,
  "voltageAlarm": false, "temperatureAlarm": false,
  "remainingSeconds": 41999, "timeToFullSeconds": null,
  "inputs": { "voltage": 3.66, "current": -4.15, "temperature": 29.1 },
  "cycles": 0, "timeScale": 1, "updatedAt": "2026-06-12T09:32:31.000Z"
}
```

## 5. Push to GitHub

```bash
git init
git add .
git commit -m "BMS: charge/use/idle states, dead state, history graph"
git branch -M main
git remote add origin https://github.com/<your-username>/battery-monitor.git
git push -u origin main
```

## 6. Deploy

The backend serves the built frontend, so you deploy one service.

- **Linux VM:** build the frontend, then `pm2 start backend/src/server.js`, reverse-proxy to `:3001`.
- **Managed host (Render/Railway):** build `frontend`, start `backend`, healthcheck `/api/health`.
