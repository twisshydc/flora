
"use strict";

const express = require("express");
const path = require("path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const { promisify } = require("node:util");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");

const FILES = {
  users: path.join(DATA_DIR, "users.json"),
  plants: path.join(DATA_DIR, "plants.json"),
  reminders: path.join(DATA_DIR, "reminders.json"),
  sessions: path.join(DATA_DIR, "sessions.json")
};

const scrypt = promisify(crypto.scrypt);
const SESSION_AGE = 7 * 24 * 60 * 60 * 1000;

// =====================================
// PREVENT OVERLAPPING JSON UPDATES
// =====================================

let operationQueue = Promise.resolve();

function withLock(operation) {
  const result = operationQueue.then(operation);
  operationQueue = result.catch(() => {});
  return result;
}

// =====================================
// INITIALIZE JSON STORAGE
// =====================================

async function initializeStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  for (const file of Object.values(FILES)) {
    try {
      const handle = await fs.open(file, "wx");

      try {
        await handle.writeFile("[]", "utf8");
      } finally {
        await handle.close();
      }
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }
  }

  console.log("Flora JSON storage is ready!");
}

// =====================================
// READ AND WRITE JSON
// =====================================

async function readJSON(file) {
  const content = await fs.readFile(file, "utf8");
  let result;

  try {
    result = JSON.parse(content);
  } catch {
    const err = new Error(
      `Invalid JSON in ${path.basename(file)}`
    );
    err.code = "INVALID_JSON";
    throw err;
  }

  if (!Array.isArray(result)) {
    const err = new Error(
      `Expected an array in ${path.basename(file)}`
    );
    err.code = "INVALID_JSON";
    throw err;
  }

  return result;
}

async function writeJSON(file, data) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;

  try {
    await fs.writeFile(
      temp,
      JSON.stringify(data, null, 2),
      "utf8"
    );

    await fs.rename(temp, file);
  } catch (err) {
    await fs.unlink(temp).catch(() => {});
    throw err;
  }
}

// =====================================
// HELPERS
// =====================================

function randomId() {
  return crypto.randomUUID();
}

async function hashPassword(password, salt) {
  return (await scrypt(password, salt, 64))
    .toString("hex");
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email
  };
}

function cookieToken(req) {
  const match = (req.headers.cookie || "")
    .match(/(?:^|;\s*)flora_session=([^;]+)/);

  if (!match) return "";

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}

function tokenHash(token) {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

function setSessionCookie(res, token) {
  res.cookie("flora_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_AGE
  });
}

async function createSession(res, userId) {
  const token = crypto.randomBytes(32)
    .toString("hex");

  const sessions = (await readJSON(FILES.sessions))
    .filter(session => session.expires > Date.now());

  sessions.push({
    tokenHash: tokenHash(token),
    userId,
    expires: Date.now() + SESSION_AGE
  });

  await writeJSON(FILES.sessions, sessions);
  setSessionCookie(res, token);
}

// =====================================
// AUTHENTICATION
// =====================================

async function requireAuth(req, res, next) {
  try {
    const token = cookieToken(req);

    if (!token) {
      return res.status(401).json({
        error: "Please sign in first."
      });
    }

    const sessions = await readJSON(FILES.sessions);

    const session = sessions.find(item =>
      item.tokenHash === tokenHash(token) &&
      item.expires > Date.now()
    );

    if (!session) {
      return res.status(401).json({
        error: "Please sign in first."
      });
    }

    const user = (await readJSON(FILES.users))
      .find(item => item.id === session.userId);

    if (!user) {
      return res.status(401).json({
        error: "Account not found."
      });
    }

    req.user = user;
    next();

  } catch (err) {
    next(err);
  }
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validPlant(body) {
  return (
    body &&
    typeof body.name === "string" &&
    body.name.trim().length > 0 &&
    body.name.trim().length <= 40 &&
    typeof body.type === "string" &&
    body.type.trim().length > 0 &&
    body.type.trim().length <= 50 &&
    [1, 2, 3].includes(Number(body.frequency)) &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(
      body.startTime || ""
    ) &&
    (
      !body.image ||
      (
        typeof body.image === "string" &&
        body.image.length <= 2000000 &&
        /^data:image\/(png|jpeg|webp);base64,/.test(body.image)
      )
    )
  );
}

app.use(express.json({ limit: "3mb" }));

// =====================================
// SIGN UP
// =====================================

app.post("/api/signup", async (req, res) => {
  const username = String(
    req.body?.username || ""
  ).trim();

  const email = String(
    req.body?.email || ""
  ).trim().toLowerCase();

  const password = req.body?.password;

  if (
    !username ||
    username.length > 30 ||
    !isValidEmail(email) ||
    typeof password !== "string" ||
    password.length < 8
  ) {
    return res.status(400).json({
      error: "Please enter valid account information."
    });
  }

  const salt = crypto.randomBytes(16)
    .toString("hex");

  const passwordHash = await hashPassword(
    password,
    salt
  );

  await withLock(async () => {
    const users = await readJSON(FILES.users);

    if (users.some(user => user.email === email)) {
      return res.status(409).json({
        error: "Email already registered."
      });
    }

    const user = {
      id: randomId(),
      username,
      email,
      salt,
      passwordHash
    };

    users.push(user);

    await writeJSON(FILES.users, users);
    await createSession(res, user.id);

    res.status(201).json({
      message: "Account Created!",
      user: publicUser(user)
    });
  });
});

// =====================================
// LOGIN
// =====================================

app.post("/api/login", async (req, res) => {
  const email = String(
    req.body?.email || ""
  ).trim().toLowerCase();

  const password = req.body?.password;

  if (typeof password !== "string") {
    return res.status(401).json({
      error: "Incorrect email or password."
    });
  }

  const user = (await readJSON(FILES.users))
    .find(item => item.email === email);

  if (!user) {
    return res.status(401).json({
      error: "Incorrect email or password."
    });
  }

  const candidate = Buffer.from(
    await hashPassword(password, user.salt),
    "hex"
  );

  const actual = Buffer.from(
    user.passwordHash,
    "hex"
  );

  if (
    candidate.length !== actual.length ||
    !crypto.timingSafeEqual(candidate, actual)
  ) {
    return res.status(401).json({
      error: "Incorrect email or password."
    });
  }

  await withLock(() => createSession(res, user.id));

  res.json({
    message: "Login successful.",
    user: publicUser(user)
  });
});

// =====================================
// LOGOUT
// =====================================

app.post("/api/logout", async (req, res) => {
  const token = cookieToken(req);

  await withLock(async () => {
    const sessions = await readJSON(FILES.sessions);

    await writeJSON(
      FILES.sessions,
      sessions.filter(
        session =>
          session.tokenHash !== tokenHash(token)
      )
    );
  });

  res.clearCookie("flora_session");

  res.json({
    message: "Logged out successfully."
  });
});

// =====================================
// CURRENT ACCOUNT
// =====================================

app.get("/api/me", requireAuth, (req, res) => {
  res.json({
    user: publicUser(req.user)
  });
});

// =====================================
// UPDATE PROFILE
// =====================================

app.put("/api/me", requireAuth, async (req, res) => {
  const username = String(
    req.body?.username || ""
  ).trim();

  const email = String(
    req.body?.email || ""
  ).trim().toLowerCase();

  if (
    !username ||
    username.length > 30 ||
    !isValidEmail(email)
  ) {
    return res.status(400).json({
      error: "Invalid profile information."
    });
  }

  await withLock(async () => {
    const users = await readJSON(FILES.users);

    if (users.some(user =>
      user.email === email &&
      user.id !== req.user.id
    )) {
      return res.status(409).json({
        error: "Email already registered."
      });
    }

    const user = users.find(
      item => item.id === req.user.id
    );

    if (!user) {
      return res.status(404).json({
        error: "Account not found."
      });
    }

    user.username = username;
    user.email = email;

    await writeJSON(FILES.users, users);

    res.json({
      user: publicUser(user)
    });
  });
});

// =====================================
// DELETE ACCOUNT
// =====================================

app.delete("/api/me", requireAuth, async (req, res) => {
  const id = req.user.id;

  await withLock(async () => {
    await writeJSON(
      FILES.users,
      (await readJSON(FILES.users))
        .filter(user => user.id !== id)
    );

    await writeJSON(
      FILES.plants,
      (await readJSON(FILES.plants))
        .filter(plant => plant.userId !== id)
    );

    await writeJSON(
      FILES.reminders,
      (await readJSON(FILES.reminders))
        .filter(reminder => reminder.userId !== id)
    );

    await writeJSON(
      FILES.sessions,
      (await readJSON(FILES.sessions))
        .filter(session => session.userId !== id)
    );
  });

  res.clearCookie("flora_session");

  res.json({
    message: "Account deleted."
  });
});

// =====================================
// READ PLANTS
// =====================================

app.get("/api/plants", requireAuth, async (req, res) => {
  const plants = await readJSON(FILES.plants);

  res.json(
    plants.filter(plant =>
      plant.userId === req.user.id
    )
  );
});

// =====================================
// CREATE PLANT
// =====================================

app.post("/api/plants", requireAuth, async (req, res) => {
  if (!validPlant(req.body)) {
    return res.status(400).json({
      error: "Invalid plant information."
    });
  }

  await withLock(async () => {
    const plant = {
      id: randomId(),
      userId: req.user.id,
      name: req.body.name.trim(),
      type: req.body.type.trim(),
      image: req.body.image || "",
      frequency: Number(req.body.frequency),
      startTime: req.body.startTime,
      lastWatered: null,
      wateringHistory: [],
      createdAt: Date.now()
    };

    const plants = await readJSON(FILES.plants);

    plants.push(plant);

    await writeJSON(FILES.plants, plants);

    res.status(201).json(plant);
  });
});

// =====================================
// UPDATE PLANT
// =====================================

app.put(
  "/api/plants/:id",
  requireAuth,
  async (req, res) => {
    if (!validPlant(req.body)) {
      return res.status(400).json({
        error: "Invalid plant information."
      });
    }

    await withLock(async () => {
      const plants = await readJSON(FILES.plants);

      const plant = plants.find(item =>
        item.id === req.params.id &&
        item.userId === req.user.id
      );

      if (!plant) {
        return res.status(404).json({
          error: "Plant not found."
        });
      }

      plant.name = req.body.name.trim();
      plant.type = req.body.type.trim();
      plant.image = req.body.image || "";
      plant.frequency = Number(req.body.frequency);
      plant.startTime = req.body.startTime;

      await writeJSON(FILES.plants, plants);

      res.json(plant);
    });
  }
);

// =====================================
// WATER PLANT - COMPLETION HISTORY
// =====================================

app.patch(
  "/api/plants/:id/water",
  requireAuth,
  async (req, res) => {
    const { date, time } = req.body || {};

    if (
      typeof date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      typeof time !== "string" ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)
    ) {
      return res.status(400).json({
        error: "Invalid watering date or time."
      });
    }

    const [year, month, day] =
      date.split("-").map(Number);

    const scheduledDay = new Date(
      year,
      month - 1,
      day
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (
      scheduledDay.getFullYear() !== year ||
      scheduledDay.getMonth() !== month - 1 ||
      scheduledDay.getDate() !== day ||
      scheduledDay > today
    ) {
      return res.status(400).json({
        error: "Invalid or future watering date."
      });
    }

    await withLock(async () => {
      const plants = await readJSON(FILES.plants);

      const plant = plants.find(item =>
        item.id === req.params.id &&
        item.userId === req.user.id
      );

      if (!plant) {
        return res.status(404).json({
          error: "Plant not found."
        });
      }

      // Do not complete a watering activity
      // before the plant's creation date.
      if (Number.isFinite(plant.createdAt)) {
        const created = new Date(plant.createdAt);
        created.setHours(0, 0, 0, 0);

        if (scheduledDay < created) {
          return res.status(400).json({
            error: "Watering date is before this plant was added."
          });
        }
      }

      const frequency = Number(plant.frequency) || 1;

      const [hour, minute] = (
        plant.startTime || "08:00"
      ).split(":").map(Number);

      const validTimes = Array.from(
        { length: frequency },
        (_, index) => {
          const slot = new Date(
            2026,
            0,
            1,
            hour,
            minute + index * 1440 / frequency
          );

          return (
            `${padTime(slot.getHours())}:` +
            padTime(slot.getMinutes())
          );
        }
      );

      if (!validTimes.includes(time)) {
        return res.status(400).json({
          error: "Watering time does not match plant schedule."
        });
      }

      if (!Array.isArray(plant.wateringHistory)) {
        plant.wateringHistory = [];
      }

      const slotKey = `${date}|${time}`;

      if (!plant.wateringHistory.includes(slotKey)) {
        plant.wateringHistory.push(slotKey);
        plant.lastWatered = Date.now();

        await writeJSON(FILES.plants, plants);
      }

      res.json(plant);
    });
  }
);

function padTime(number) {
  return String(number).padStart(2, "0");
}

// =====================================
// DELETE PLANT
// =====================================

app.delete(
  "/api/plants/:id",
  requireAuth,
  async (req, res) => {
    await withLock(async () => {
      const plants = await readJSON(FILES.plants);

      const exists = plants.some(plant =>
        plant.id === req.params.id &&
        plant.userId === req.user.id
      );

      if (!exists) {
        return res.status(404).json({
          error: "Plant not found."
        });
      }

      await writeJSON(
        FILES.plants,
        plants.filter(plant =>
          !(
            plant.id === req.params.id &&
            plant.userId === req.user.id
          )
        )
      );

      const reminders = await readJSON(
        FILES.reminders
      );

      await writeJSON(
        FILES.reminders,
        reminders.filter(reminder =>
          !(
            reminder.plantId === req.params.id &&
            reminder.userId === req.user.id
          )
        )
      );

      res.json({
        message: "Plant deleted successfully."
      });
    });
  }
);

// =====================================
// READ CARE REMINDERS
// =====================================

app.get(
  "/api/reminders",
  requireAuth,
  async (req, res) => {
    const reminders = await readJSON(
      FILES.reminders
    );

    res.json(
      reminders.filter(reminder =>
        reminder.userId === req.user.id
      )
    );
  }
);

// =====================================
// CREATE CARE REMINDER
// =====================================

app.post(
  "/api/reminders",
  requireAuth,
  async (req, res) => {
    const {
      plantId,
      plantType,
      type,
      date,
      time
    } = req.body || {};

    const validActivities = [
      "Watering",
      "Sunlight",
      "Fertilizing",
      "Pruning",
      "Other"
    ];

    if (
      !validActivities.includes(type) ||
      typeof date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      typeof time !== "string" ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)
    ) {
      return res.status(400).json({
        error: "Select a valid plant, activity, date, and time."
      });
    }

    // Reject invalid calendar dates and past reminders.
    const [year, month, day] =
      date.split("-").map(Number);

    const reminderDay = new Date(year, month - 1, day);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (
      reminderDay.getFullYear() !== year ||
      reminderDay.getMonth() !== month - 1 ||
      reminderDay.getDate() !== day ||
      reminderDay < today
    ) {
      return res.status(400).json({
        error: "Care reminders must have a valid date today or later."
      });
    }

    await withLock(async () => {
      const plant = (await readJSON(FILES.plants))
        .find(item =>
          item.id === plantId &&
          item.userId === req.user.id
        );

      if (!plant || plant.type !== plantType) {
        return res.status(400).json({
          error: "Select a valid plant, activity, date, and time."
        });
      }

      const reminder = {
        id: randomId(),
        userId: req.user.id,
        plantId: plant.id,
        plantName: plant.name,
        plantType: plant.type,
        type,
        date,
        time,
        completed: false
      };

      const reminders = await readJSON(
        FILES.reminders
      );

      reminders.push(reminder);

      await writeJSON(FILES.reminders, reminders);

      res.status(201).json(reminder);
    });
  }
);

// =====================================
// UPDATE CARE REMINDER
// =====================================

app.patch(
  "/api/reminders/:id",
  requireAuth,
  async (req, res) => {
    if (
      typeof req.body?.completed !== "boolean"
    ) {
      return res.status(400).json({
        error: "Invalid reminder status."
      });
    }

    await withLock(async () => {
      const reminders = await readJSON(
        FILES.reminders
      );

      const reminder = reminders.find(item =>
        item.id === req.params.id &&
        item.userId === req.user.id
      );

      if (!reminder) {
        return res.status(404).json({
          error: "Reminder not found."
        });
      }

      reminder.completed = req.body.completed;

      await writeJSON(FILES.reminders, reminders);

      res.json(reminder);
    });
  }
);

// =====================================
// DELETE CARE REMINDER
// =====================================

app.delete(
  "/api/reminders/:id",
  requireAuth,
  async (req, res) => {
    await withLock(async () => {
      const reminders = await readJSON(
        FILES.reminders
      );

      const exists = reminders.some(item =>
        item.id === req.params.id &&
        item.userId === req.user.id
      );

      if (!exists) {
        return res.status(404).json({
          error: "Reminder not found."
        });
      }

      await writeJSON(
        FILES.reminders,
        reminders.filter(item =>
          !(
            item.id === req.params.id &&
            item.userId === req.user.id
          )
        )
      );

      res.json({
        message: "Reminder deleted."
      });
    });
  }
);

// =====================================
// HEALTH CHECK
// =====================================

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Flora Express backend is running!"
  });
});

// =====================================
// FRONTEND
// =====================================

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

// =====================================
// BACKEND ERROR HANDLING
// =====================================

app.use((err, req, res, next) => {
  console.error("Flora server error:", err);

  if (res.headersSent) {
    return next(err);
  }

  const status =
    err.status >= 400 && err.status < 500
      ? err.status
      : 500;

  const message =
    status === 413
      ? "Uploaded data is too large."
      : status === 400
        ? "Invalid request data."
        : "A server error occurred. Please try again.";

  res.status(status).json({
    error: message
  });
});

// =====================================
// START SERVER
// =====================================

initializeStorage()
  .then(() => {
    app.listen(PORT, () => {
      console.log(
        `Flora running at http://localhost:${PORT}`
      );
    });
  })
  .catch(err => {
    console.error(
      "Unable to initialize Flora JSON storage:",
      err
    );

    process.exitCode = 1;
  });
