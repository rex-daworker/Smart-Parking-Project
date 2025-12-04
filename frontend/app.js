const db = firebase.database();

// ==== CONFIG: Backend for control commands ====
// Change this to your PC IP (same one you used for Arduino, e.g. 192.168.1.105)
const BACKEND_BASE_URL = "http://192.168.1.105:3000";
 
// DOM elements
const statusBanner = document.getElementById("statusBanner");
const statusText = document.getElementById("statusText");

const summaryInside = document.getElementById("insideCount");
const summaryTotalSlots = document.getElementById("totalSlotsLabel");
const summaryFree = document.getElementById("freeSlots");
const summaryOccupied = document.getElementById("occupiedSlots");
const summaryEntries = document.getElementById("entriesToday");

const slotsContainer = document.getElementById("slotsContainer");
const logsList = document.getElementById("logsList");
const lastUpdatedEl = document.getElementById("lastUpdated");

const occupancyCanvas = document.getElementById("occupancyChart");
const historyCanvas = document.getElementById("historyChart");

const themeToggle = document.getElementById("themeToggle");
const controlStatus = document.getElementById("controlStatus");
const thresholdInput = document.getElementById("thresholdInput");

let occupancyChart = null;
let historyChart = null;

// ==== DARK MODE TOGGLE ====
themeToggle.addEventListener("click", () => {
  document.body.classList.toggle("dark");
  const isDark = document.body.classList.contains("dark");
  themeToggle.textContent = isDark ? "☀️ Light" : "🌙 Dark";
});

// Format timestamp
function formatTime(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  return isNaN(d.getTime()) ? "-" : d.toLocaleString();
}

// Status banner color
function updateStatusBanner(free, total) {
  statusBanner.classList.remove("status-available", "status-full", "status-unknown");

  if (free === null || total === null || typeof free === "undefined" || typeof total === "undefined") {
    statusBanner.classList.add("status-unknown");
    statusText.textContent = "Status: Unknown";
    return;
  }

  if (free > 0) {
    statusBanner.classList.add("status-available");
    statusText.textContent = "Parking Available";
  } else {
    statusBanner.classList.add("status-full");
    statusText.textContent = "Parking Full";
  }
}

// Donut chart (current occupancy)
function updateOccupancyChart(free, occupied) {
  if (!occupancyChart) {
    occupancyChart = new Chart(occupancyCanvas.getContext("2d"), {
      type: "doughnut",
      data: {
        labels: ["Free", "Occupied"],
        datasets: [
          {
            data: [free, occupied],
            backgroundColor: ["#22c55e", "#ef4444"]
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom"
          }
        }
      }
    });
  } else {
    occupancyChart.data.datasets[0].data = [free, occupied];
    occupancyChart.update();
  }
}

// 24h line chart (history) - using simple category labels
function updateHistoryChart(points) {
  const labels = points.map(p => {
    // show only time (HH:MM)
    const d = new Date(p.time);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  });
  const occupiedData = points.map(p => p.occupied);

  if (!historyChart) {
    historyChart = new Chart(historyCanvas.getContext("2d"), {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Occupied slots",
            data: occupiedData,
            tension: 0.3,
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: {
              autoSkip: true,
              maxTicksLimit: 8
            }
          },
          y: {
            beginAtZero: true,
            suggestedMax: 5
          }
        }
      }
    });
  } else {
    historyChart.data.labels = labels;
    historyChart.data.datasets[0].data = occupiedData;
    historyChart.update();
  }
}

// ==== SUMMARY listener ====
db.ref("summary").on("value", snap => {
  const s = snap.val();

  if (!s) {
    summaryInside.textContent = "-";
    summaryFree.textContent = "-";
    summaryOccupied.textContent = "-";
    summaryEntries.textContent = "-";
    summaryTotalSlots.textContent = "/ - slots";
    updateStatusBanner(null, null);
    lastUpdatedEl.textContent = "Last update: -";
    return;
  }

  const inside = s.insideCount;
  const total = s.totalSlots;
  const free = s.free;
  const occupied = s.occupied;
  const lastTs = s.lastUpdate;

  summaryInside.textContent = inside;
  summaryFree.textContent = free;
  summaryOccupied.textContent = occupied;
  summaryEntries.textContent = s.entriesToday;
  summaryTotalSlots.textContent = `/ ${total} slots`;

  updateStatusBanner(free, total);

  // small delay to ensure canvas is laid out
  setTimeout(() => {
    updateOccupancyChart(free, occupied);
  }, 150);

  lastUpdatedEl.textContent = "Last update: " + formatTime(lastTs);
});

// ==== SLOTS listener ====
db.ref("slots").on("value", snap => {
  const data = snap.val();
  slotsContainer.innerHTML = "";

  if (!data) {
    slotsContainer.innerHTML = "<p>No slot data found.</p>";
    return;
  }

  Object.keys(data).forEach(slotId => {
    const slot = data[slotId];

    const card = document.createElement("div");
    card.className = "slot-card";

    const statusClass =
      slot.status === "free"
        ? "status-free"
        : slot.status === "occupied"
        ? "status-occupied"
        : "status-unknown";

    card.innerHTML = `
      <div class="slot-header">
        <span class="slot-title">${slotId.toUpperCase()}</span>
        <span class="slot-status ${statusClass}">${slot.status}</span>
      </div>
      <div class="slot-body">
        <p>Distance: ${slot.distance} cm</p>
        <p>Last update: ${formatTime(slot.lastUpdate)}</p>
      </div>
    `;

    slotsContainer.appendChild(card);
  });
});

// ==== LOGS listener ====
db.ref("logs").limitToLast(10).on("value", snap => {
  const logs = snap.val();
  logsList.innerHTML = "";

  if (!logs) {
    logsList.innerHTML = "<li>No recent activity.</li>";
    return;
  }

  Object.values(logs)
    .sort((a, b) => b.time - a.time)
    .forEach(log => {
      const li = document.createElement("li");
      li.innerHTML = `
        <span>${log.message}</span>
        <span class="log-time">${formatTime(log.time)}</span>
      `;
      logsList.appendChild(li);
    });
});

// ==== 24h HISTORY listener ====
// Expected structure in DB:
// history/
//    someId1: { time: 1700000000000, occupied: 1 }
//    someId2: { time: 1700003600000, occupied: 2 }
db.ref("history").limitToLast(48).on("value", snap => {
  const data = snap.val();
  if (!data) {
    return;
  }

  const points = Object.values(data)
    .filter(p => p && typeof p.time !== "undefined" && typeof p.occupied !== "undefined")
    .sort((a, b) => a.time - b.time);

  if (points.length === 0) return;

  setTimeout(() => {
    updateHistoryChart(points);
  }, 150);
});

// ==== CONTROL PANEL: send commands to backend ====
function setControlStatus(msg, isError = false) {
  if (!controlStatus) return;
  controlStatus.textContent = msg;
  controlStatus.style.color = isError ? "#b91c1c" : "#6b7280";
}

function sendCommand(payload) {
  setControlStatus("Sending...", false);

  fetch(`${BACKEND_BASE_URL}/setCommand`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  })
    .then(res => res.json())
    .then(data => {
      console.log("Command sent:", data);
      setControlStatus("Command sent successfully.");
    })
    .catch(err => {
      console.error("Command error:", err);
      setControlStatus("Failed to send command.", true);
    });
}

function updateThreshold() {
  if (!thresholdInput) return;
  const value = parseInt(thresholdInput.value, 10);
  if (isNaN(value) || value <= 0) {
    setControlStatus("Enter a valid threshold.", true);
    return;
  }
  sendCommand({ threshold: value });
}

// ======================================================
// CLOUD CONTROL PANEL → SEND COMMANDS TO BACKEND
// ======================================================

const backendURL = "http://192.168.1.105:3000";  // your laptop IP

async function sendCommand(action) {
  try {
    const res = await fetch(backendURL + "/setCommand", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action })
    });

    const data = await res.json();

    document.getElementById("cmdStatus").textContent =
      "Command sent: " + data.command.action;
  } catch (err) {
    console.error(err);
    document.getElementById("cmdStatus").textContent =
      "Failed to send command.";
  }
}

async function updateThreshold() {
  const value = parseInt(document.getElementById("thresholdInput").value);

  try {
    const res = await fetch(backendURL + "/setCommand", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threshold: value })
    });

    const data = await res.json();

    document.getElementById("cmdStatus").textContent =
      "Threshold updated: " + data.command.threshold;
  } catch (err) {
    console.error(err);
    document.getElementById("cmdStatus").textContent =
      "Failed to update threshold.";
  }
}

