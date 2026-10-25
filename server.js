
"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = 3000;

const DATA_DIR = path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const FILES = {
  users: path.join(DATA_DIR, "users.json"),
  plants: path.join(DATA_DIR, "plants.json"),
  reminders: path.join(DATA_DIR, "reminders.json"),
  sessions: path.join(DATA_DIR, "sessions.json")
};

for (const file of Object.values(FILES)) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, "[]", "utf8");
  }
}

console.log("Flora JSON storage is ready!");

function readJSON(file) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, "[]");
    return [];
  }

  try {
    const result = JSON.parse(
      fs.readFileSync(file, "utf8")
    );
    return Array.isArray(result) ? result : [];
  } catch {
    throw new Error(
      `Unable to read ${path.basename(file)}`
    );
  }
}

function writeJSON(file, data) {
  const temporary = file + ".tmp";
  fs.writeFileSync(
    temporary,
    JSON.stringify(data, null, 2)
  );
  fs.renameSync(temporary, file);
}

function randomId() {
  return crypto.randomUUID();
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64)
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
  const header = req.headers.cookie || "";
  const match = header.match(
    /(?:^|;\s*)flora_session=([^;]+)/
  );

  return match
    ? decodeURIComponent(match[1])
    : "";
}

function tokenHash(token) {
  return crypto.createHash("sha256")
    .update(token)
    .digest("hex");
}

function createSession(res, userId) {
  const token = crypto.randomBytes(32)
    .toString("hex");

  const sessions = readJSON(FILES.sessions)
    .filter(session => session.expires > Date.now());

  sessions.push({
    tokenHash: tokenHash(token),
    userId,
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000
  });

  writeJSON(FILES.sessions, sessions);

  res.cookie("flora_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

function requireAuth(req, res, next) {
  const token = cookieToken(req);
  const sessions = readJSON(FILES.sessions);

  const session = sessions.find(item =>
    item.tokenHash === tokenHash(token) &&
    item.expires > Date.now()
  );

  if (!token || !session) {
    return res.status(401).json({
      error: "Please sign in first."
    });
  }

  const user = readJSON(FILES.users)
    .find(item => item.id === session.userId);

  if (!user) {
    return res.status(401).json({
      error: "Account not found."
    });
  }

  req.user = user;
  next();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validPlant(body) {
  return (
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
        body.image.length <= 2000000
      )
    )
  );
}

app.use(express.json({ limit: "3mb" }));

// =====================================
// SIGN UP
// =====================================

app.post("/api/signup", (req, res) => {
  const username = String(
    req.body.username || ""
  ).trim();

  const email = String(
    req.body.email || ""
  ).trim().toLowerCase();

  const password = req.body.password;

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

  const users = readJSON(FILES.users);

  if (users.some(user => user.email === email)) {
    return res.status(409).json({
      error: "Email already registered."
    });
  }

  const salt = crypto.randomBytes(16)
    .toString("hex");

  const user = {
    id: randomId(),
    username,
    email,
    salt,
    passwordHash: hashPassword(password, salt)
  };

  users.push(user);

  writeJSON(FILES.users, users);
  createSession(res, user.id);

  res.status(201).json({
    message: "Account Created!",
    user: publicUser(user)
  });
});

// =====================================
// LOGIN
// =====================================

app.post("/api/login", (req, res) => {
  const email = String(
    req.body.email || ""
  ).trim().toLowerCase();

  const password = req.body.password;

  const user = readJSON(FILES.users)
    .find(item => item.email === email);

  if (!user || typeof password !== "string") {
    return res.status(401).json({
      error: "Incorrect email or password."
    });
  }

  const candidate = Buffer.from(
    hashPassword(password, user.salt),
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

  createSession(res, user.id);

  res.json({
    message: "Login successful.",
    user: publicUser(user)
  });
});

// =====================================
// LOGOUT
// =====================================

app.post("/api/logout", (req, res) => {
  const token = cookieToken(req);
  const sessions = readJSON(FILES.sessions);

  writeJSON(
    FILES.sessions,
    sessions.filter(
      session =>
        session.tokenHash !== tokenHash(token)
    )
  );

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

app.put("/api/me", requireAuth, (req, res) => {
  const username = String(
    req.body.username || ""
  ).trim();

  const email = String(
    req.body.email || ""
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

  const users = readJSON(FILES.users);

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

  user.username = username;
  user.email = email;

  writeJSON(FILES.users, users);

  res.json({
    user: publicUser(user)
  });
});

// =====================================
// DELETE ACCOUNT
// =====================================

app.delete("/api/me", requireAuth, (req, res) => {
  const id = req.user.id;

  writeJSON(
    FILES.users,
    readJSON(FILES.users).filter(
      user => user.id !== id
    )
  );

  writeJSON(
    FILES.plants,
    readJSON(FILES.plants).filter(
      plant => plant.userId !== id
    )
  );

  writeJSON(
    FILES.reminders,
    readJSON(FILES.reminders).filter(
      reminder => reminder.userId !== id
    )
  );

  writeJSON(
    FILES.sessions,
    readJSON(FILES.sessions).filter(
      session => session.userId !== id
    )
  );

  res.clearCookie("flora_session");

  res.json({
    message: "Account deleted."
  });
});

// =====================================
// READ PLANTS
// =====================================

app.get("/api/plants", requireAuth, (req, res) => {
  const plants = readJSON(FILES.plants)
    .filter(
      plant => plant.userId === req.user.id
    );

  res.json(plants);
});

// =====================================
// CREATE PLANT
// =====================================

app.post("/api/plants", requireAuth, (req, res) => {
  if (!validPlant(req.body)) {
    return res.status(400).json({
      error: "Invalid plant information."
    });
  }

  const plant = {
    id: randomId(),
    userId: req.user.id,
    name: req.body.name.trim(),
    type: req.body.type.trim(),
    image: req.body.image || "",
    frequency: Number(req.body.frequency),
    startTime: req.body.startTime,
    lastWatered: null
  };

  const plants = readJSON(FILES.plants);

  plants.push(plant);
  writeJSON(FILES.plants, plants);

  res.status(201).json(plant);
});

// =====================================
// UPDATE PLANT
// =====================================

app.put(
  "/api/plants/:id",
  requireAuth,
  (req, res) => {
    if (!validPlant(req.body)) {
      return res.status(400).json({
        error: "Invalid plant information."
      });
    }

    const plants = readJSON(FILES.plants);

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

    writeJSON(FILES.plants, plants);

    res.json(plant);
  }
);

// =====================================
// WATER PLANT
// =====================================

app.patch(
  "/api/plants/:id/water",
  requireAuth,
  (req, res) => {
    const plants = readJSON(FILES.plants);

    const plant = plants.find(item =>
      item.id === req.params.id &&
      item.userId === req.user.id
    );

    if (!plant) {
      return res.status(404).json({
        error: "Plant not found."
      });
    }

    plant.lastWatered = Date.now();

    writeJSON(FILES.plants, plants);

    res.json(plant);
  }
);

// =====================================
// DELETE PLANT
// =====================================

app.delete(
  "/api/plants/:id",
  requireAuth,
  (req, res) => {
    const plants = readJSON(FILES.plants);

    const remaining = plants.filter(
      plant =>
        !(
          plant.id === req.params.id &&
          plant.userId === req.user.id
        )
    );

    if (remaining.length === plants.length) {
      return res.status(404).json({
        error: "Plant not found."
      });
    }

    writeJSON(FILES.plants, remaining);

    // Remove reminders for the deleted plant.
    const reminders = readJSON(FILES.reminders);

    writeJSON(
      FILES.reminders,
      reminders.filter(
        reminder =>
          !(
            reminder.plantId === req.params.id &&
            reminder.userId === req.user.id
          )
      )
    );

    res.json({
      message: "Plant deleted successfully."
    });
  }
);

// =====================================
// READ CARE REMINDERS
// =====================================

app.get(
  "/api/reminders",
  requireAuth,
  (req, res) => {
    const reminders = readJSON(FILES.reminders)
      .filter(
        reminder => reminder.userId === req.user.id
      );

    res.json(reminders);
  }
);

// =====================================
// CREATE CARE REMINDER
// =====================================

app.post(
  "/api/reminders",
  requireAuth,
  (req, res) => {
    const {
      plantId,
      plantType,
      type,
      date,
      time
    } = req.body;

    // Check that this plant belongs to the user.
    const plant = readJSON(FILES.plants).find(
      item =>
        item.id === plantId &&
        item.userId === req.user.id
    );

    const validActivities = [
      "Watering",
      "Sunlight",
      "Fertilizing",
      "Pruning",
      "Other"
    ];

    // Check that the selected plant type matches.
    if (
      !plant ||
      plant.type !== plantType ||
      !validActivities.includes(type) ||
      typeof date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      typeof time !== "string" ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)
    ) {
      return res.status(400).json({
        error:
          "Select a valid plant, activity, date, and time."
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

    const reminders = readJSON(FILES.reminders);

    reminders.push(reminder);
    writeJSON(FILES.reminders, reminders);

    res.status(201).json(reminder);
  }
);

// =====================================
// UPDATE CARE REMINDER
// =====================================

app.patch(
  "/api/reminders/:id",
  requireAuth,
  (req, res) => {
    if (
      typeof req.body.completed !== "boolean"
    ) {
      return res.status(400).json({
        error: "Invalid reminder status."
      });
    }

    const reminders = readJSON(FILES.reminders);

    const reminder = reminders.find(
      item =>
        item.id === req.params.id &&
        item.userId === req.user.id
    );

    if (!reminder) {
      return res.status(404).json({
        error: "Reminder not found."
      });
    }

    reminder.completed = req.body.completed;

    writeJSON(FILES.reminders, reminders);

    res.json(reminder);
  }
);

// =====================================
// DELETE CARE REMINDER
// =====================================

app.delete(
  "/api/reminders/:id",
  requireAuth,
  (req, res) => {
    const reminders = readJSON(FILES.reminders);

    const remaining = reminders.filter(
      item =>
        !(
          item.id === req.params.id &&
          item.userId === req.user.id
        )
    );

    if (remaining.length === reminders.length) {
      return res.status(404).json({
        error: "Reminder not found."
      });
    }

    writeJSON(FILES.reminders, remaining);

    res.json({
      message: "Reminder deleted."
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
// START SERVER
// =====================================

app.listen(PORT, () => {
  console.log(
    `Flora running at http://localhost:${PORT}`
  );
});
