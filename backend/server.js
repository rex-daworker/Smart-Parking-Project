const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");

const serviceAccount = require("./serviceAccountKey.json");

// ---- Firebase ----
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL:
    "https://smartparkingsystem-5872f-default-rtdb.europe-west1.firebasedatabase.app",
});

const db = admin.database();
const app = express();

app.use(cors());
app.use(bodyParser.json());

// ===== Cloud → Arduino command object =====
let command = {
  action: "none",    // "open", "close", "none"
  threshold: 30
};

// ===== Root check =====
app.get("/", (req, res) => {
  res.send("Smart Parking Backend Running");
});

// =====================================================================
// 🔹 ARDUINO POLLS HERE EVERY 2 SECONDS
// =====================================================================
app.get("/command", async (req, res) => {
  try {
    const cmd = (await db.ref("command").once("value")).val() || {
      action: "none",
      threshold: 30
    };

    res.json({
      action: cmd.action || "none",
      threshold: cmd.threshold || 30
    });
  } catch (err) {
    res.json({ action: "none", threshold: 30 });
  }
});


// =====================================================================
// 🔹 FRONTEND POSTS HERE TO MANUALLY CONTROL GATE
// =====================================================================
app.post("/setCommand", async (req, res) => {
  command = { ...command, ...req.body };

  console.log("Manual cloud command:", command);

  await db.ref("command").set({
    ...command,
    lastUpdate: Date.now()
  });

  res.json({ ok: true, command });
});


// =====================================================================
// 🔹 ARDUINO SENDS SENSOR UPDATE HERE
// =====================================================================
app.post("/update", async (req, res) => {
  try {
    const { slot, distance, status } = req.body;

    if (typeof distance === "undefined" || !status) {
      return res.status(400).json({ error: "Missing distance or status" });
    }

    const slotName = (slot || "SLOT1").toUpperCase();
    const ts = Date.now();

    console.log("Received update:", { slotName, distance, status });

    // ---- Save slot info ----
    await db.ref(`slots/${slotName}`).set({
      distance,
      status,
      lastUpdate: ts,
    });

    // ---- Summary ----
    const totalSlots = 3;
    const occupied = status === "occupied" ? 1 : 0;
    const free = totalSlots - occupied;

    await db.ref("summary").set({
      insideCount: occupied,
      totalSlots,
      free,
      occupied,
      entriesToday: 0,
      lastUpdate: ts,
    });

    // ---- Logs ----
    await db.ref(`logs/${ts}`).set({
      message: `${slotName} is now ${status}`,
      time: ts,
    });

    // ---- 24h History ----
    await db.ref(`history/${ts}`).set({
      time: ts,
      occupied,
    });


    // =====================================================================
    // 🔥 AUTO-GATE LOGIC
    // =====================================================================
    if (status === "occupied") {
      command.action = "close";   // Auto force-close
    } else if (status === "free") {
      command.action = "open";    // Auto reopen
    }

    await db.ref("command").set({
      action: command.action,
      threshold: command.threshold,
      lastUpdate: ts
    });

    console.log("Auto-gate updated:", command);

    res.json({ ok: true });
  } catch (err) {
    console.error("Error in /update:", err);
    res.status(500).json({ error: err.toString() });
  }
});


// =====================================================================
// START SERVER
// =====================================================================
const PORT = 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend server running at http://0.0.0.0:${PORT}`);
});
