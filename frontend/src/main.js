import "./style.css";
import Chart from "chart.js/auto";

const POLL_MS = 1000;
const HISTORY_MS = 2000;
const el = (id) => document.getElementById(id);

const STATUS_COLOR = { Normal: "#34d399", Warning: "#fbbf24", Critical: "#f87171" };
const C = { electric: "#38bdf8", muted: "#8b97a6", line: "#28313d", ink: "#e6edf3", dead: "#f87171", full: "#34d399" };

let currentRange = "day";

function fmtDuration(seconds) {
  if (seconds == null) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  }
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtLabel(iso, range) {
  const d = new Date(iso);
  if (range === "day") return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (range === "week") return d.toLocaleString([], { weekday: "short", hour: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// --- Chart: SOC (%) over time ---------------------------------------------
const chart = new Chart(el("socChart"), {
  type: "line",
  data: {
    labels: [],
    datasets: [
      {
        label: "SOC (%)",
        data: [],
        borderColor: C.electric,
        backgroundColor: "rgba(56,189,248,0.12)",
        borderWidth: 2,
        fill: true,
        tension: 0.3,
        pointRadius: 0,
      },
    ],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: C.muted, maxTicksLimit: 7, font: { size: 10 } }, grid: { color: C.line } },
      y: {
        min: 0, max: 100,
        title: { display: true, text: "SOC %", color: C.muted },
        ticks: { color: C.muted }, grid: { color: C.line },
      },
    },
  },
});

async function refreshHistory() {
  try {
    const res = await fetch(`/api/history?range=${currentRange}`);
    if (!res.ok) return;
    const h = await res.json();
    chart.data.labels = h.points.map((p) => fmtLabel(p.ts, h.range));
    chart.data.datasets[0].data = h.points.map((p) => p.soc);
    chart.update("none");
  } catch {
    /* ignore */
  }
}

// --- Status helpers --------------------------------------------------------
function setConnected(ok) {
  el("liveDot").className = "h-2 w-2 rounded-full " + (ok ? "dot-live" : "dot-dead");
  const label = el("liveLabel");
  label.textContent = ok ? "Live" : "Offline";
  label.className = "font-mono text-[11px] uppercase tracking-widest " + (ok ? "text-nominal" : "text-critical");
}

function setAlarm(ledId, textId, active) {
  el(ledId).className = "led " + (active ? "led--on" : "");
  const t = el(textId);
  t.textContent = active ? "ALARM" : "OK";
  t.className = "font-mono text-sm " + (active ? "text-critical" : "text-nominal");
}

const MODE_TEXT = {
  charging: "▲ Charging",
  charged: "✓ Charged",
  use: "▼ In use",
  idle: "Idle",
  dead: "✕ Battery dead — connect charger",
};

function heroColor(d) {
  if (d.state === "dead") return C.dead;
  if (d.state === "charged") return C.full;
  return STATUS_COLOR[d.status] ?? C.full;
}

function setActiveControl(d) {
  // 'charge'/'charged' -> charge button; 'use' -> use; 'idle'/'dead' -> idle
  const active = d.state === "charging" || d.state === "charged" ? "charge" : d.state === "use" ? "use" : "idle";
  document.querySelectorAll("button[data-control]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.control === active));
  });
}

function render(d) {
  const color = heroColor(d);
  const charging = d.state === "charging" || d.state === "charged";

  el("battFill").style.height = `${d.soc}%`;
  el("battFill").style.backgroundColor = color;
  el("battFill").classList.toggle("is-charging", d.state === "charging");
  el("boltIcon").classList.toggle("hidden", !charging);

  el("socValue").textContent = d.soc.toFixed(0);
  el("socValue").style.color = color;
  el("modeLine").textContent = MODE_TEXT[d.state] ?? d.stateLabel;

  // Remaining usable time / time to full
  let remaining = "";
  if (d.state === "charging" && d.timeToFullSeconds != null) {
    remaining = `≈ ${fmtDuration(d.timeToFullSeconds)} to full`;
  } else if ((d.state === "use" || d.state === "idle") && d.remainingSeconds != null) {
    remaining = `≈ ${fmtDuration(d.remainingSeconds)} of use remaining`;
  }
  el("remainingLine").textContent = remaining;

  // Charger plugged-in note (only when charged and still connected)
  el("chargerNote").textContent =
    d.state === "charged" && d.chargerPluggedIn ? "Charger still plugged in" : "";

  // Safety status pill
  const pill = el("statusPill");
  pill.textContent = d.status;
  const sColor = STATUS_COLOR[d.status] ?? C.full;
  pill.style.color = sColor;
  pill.style.backgroundColor = sColor + "1a";
  pill.style.borderColor = sColor + "55";

  el("sohValue").textContent = d.soh.toFixed(1);
  el("cycleValue").textContent = d.cycles;
  setAlarm("vAlarmLed", "vAlarmText", d.voltageAlarm);
  setAlarm("tAlarmLed", "tAlarmText", d.temperatureAlarm);

  el("voltageValue").textContent = d.inputs.voltage.toFixed(2);
  const i = d.inputs.current;
  el("currentValue").textContent = (i > 0 ? "+" : "") + i.toFixed(2);
  el("tempValue").textContent = d.inputs.temperature.toFixed(1);

  el("updatedAt").textContent = new Date(d.updatedAt).toLocaleTimeString();

  document.querySelectorAll("#speedGroup .seg").forEach((b) =>
    b.classList.toggle("seg--on", Number(b.dataset.scale) === d.timeScale)
  );
  setActiveControl(d);
}

async function poll() {
  try {
    const res = await fetch("/api/bms");
    if (!res.ok) throw new Error();
    render(await res.json());
    setConnected(true);
  } catch {
    setConnected(false);
  }
}

// --- Controls --------------------------------------------------------------
async function post(url, body) {
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => {});
  poll();
}

document.querySelectorAll("button[data-control]").forEach((btn) =>
  btn.addEventListener("click", () => post("/api/control", { mode: btn.dataset.control }))
);
document.querySelectorAll("#speedGroup .seg").forEach((btn) =>
  btn.addEventListener("click", () => post("/api/sim/speed", { scale: Number(btn.dataset.scale) }))
);
document.querySelectorAll("button[data-fault]").forEach((btn) =>
  btn.addEventListener("click", () => post("/api/sim/inject", { fault: btn.dataset.fault }))
);
el("resetBtn").addEventListener("click", () => post("/api/sim/reset"));

document.querySelectorAll("#rangeGroup .seg").forEach((btn) =>
  btn.addEventListener("click", () => {
    currentRange = btn.dataset.range;
    document.querySelectorAll("#rangeGroup .seg").forEach((b) => b.classList.toggle("seg--on", b === btn));
    refreshHistory();
  })
);
// default selected range
document.querySelector('#rangeGroup .seg[data-range="day"]').classList.add("seg--on");

poll();
refreshHistory();
setInterval(poll, POLL_MS);
setInterval(refreshHistory, HISTORY_MS);
