
document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, "0");

  const PRIVATE = ["dashboard", "tracker", "settings", "loading"];
  const PAGES = ["home", "login", "signup", ...PRIVATE];

  let account = null;
  let plants = [];
  let reminders = [];
  let recent = [];

  let page = "home";
  let selectedPlantId = null;
  let filter = "all";
  let selectedDate = dateKey(new Date());

  let viewedMonth = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1
  );

  let plantMode = "add";
  let temporaryImage = "";
  let imageLoading = false;
  let imageToken = 0;
  let deletePlantId = null;
  let deleteCareId = null;

  let popupTimer;
  let toastTimer;
  let signupTimer;
  let loadingFrame;
  let busy = false;

  // =====================================
  // GENERAL HELPERS
  // =====================================

  function dateKey(date) {
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate())
    ].join("-");
  }

  function parseDay(value) {
    const [year, month, day] =
      value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function displayDate(value, options = {
    weekday: "short",
    month: "short",
    day: "numeric"
  }) {
    return parseDay(value).toLocaleDateString(
      undefined,
      options
    );
  }

  function formatDate(timestamp) {
    return Number.isFinite(timestamp)
      ? new Date(timestamp).toLocaleString(
          undefined,
          { dateStyle: "medium", timeStyle: "short" }
        )
      : "Not yet watered";
  }

  function formatTime(value = "09:00") {
    const [hour, minute] =
      value.split(":").map(Number);

    return new Date(
      2026, 0, 1, hour, minute
    ).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function node(tag, className = "", text = "") {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  }

  function currentPlant() {
    return plants.find(
      plant => String(plant.id) === String(selectedPlantId)
    );
  }

  // =====================================
  // POPUP MESSAGES
  // =====================================

  function showMessage(title, message, kind = "success") {
    clearTimeout(popupTimer);

    $("quick-popup-title").textContent = title;
    $("quick-popup-text").textContent = message;

    $("quick-popup-image").src =
      kind === "error"
        ? "images/x.svg"
        : "images/check.svg";

    $("quick-popup").hidden = false;

    popupTimer = setTimeout(() => {
      $("quick-popup").hidden = true;
    }, 2000);
  }

  const success = (title, message) =>
    showMessage(title, message);

  const error = (title, message) =>
    showMessage(title, message, "error");

  function toast(message) {
    clearTimeout(toastTimer);
    $("toast").textContent = message;

    toastTimer = setTimeout(() => {
      $("toast").textContent = "";
    }, 2000);
  }

  // =====================================
  // BACKEND REQUESTS
  // =====================================

  async function api(url, options = {}) {
    let response;

    try {
      response = await fetch(url, {
        credentials: "same-origin",
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {})
        }
      });
    } catch {
      throw new Error(
        "Cannot connect to Flora. Run node server.js first."
      );
    }

    const result = await response.json()
      .catch(() => ({}));

    if (!response.ok) {
      if (
        response.status === 401 &&
        !["/api/login", "/api/signup"].includes(url)
      ) {
        account = null;
      }

      throw new Error(
        result.error || "Something went wrong."
      );
    }

    return result;
  }

  const request = (method, url, body) =>
    api(url, {
      method,
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body) })
    });

  async function loadAccountData() {
    [plants, reminders] = await Promise.all([
      api("/api/plants"),
      api("/api/reminders")
    ]);

    plants = plants.map(plant => ({
      ...plant,
      frequency: Number(plant.frequency) || 1,
      startTime: plant.startTime || "08:00",
      lastWatered: Number.isFinite(plant.lastWatered)
        ? plant.lastWatered
        : null
    }));

    try {
      recent = JSON.parse(
        sessionStorage.getItem(
          `flora-recent-${account.id}`
        ) || "[]"
      );

      if (!Array.isArray(recent)) recent = [];
    } catch {
      recent = [];
    }
  }

  // =====================================
  // PAGE NAVIGATION
  // =====================================

  function showPage(target) {
    if (!PAGES.includes(target)) target = "home";

    if (PRIVATE.includes(target) && !account) {
      target = "login";
    }

    cancelAnimationFrame(loadingFrame);

    page = target;
    document.body.dataset.page = target;

    document.querySelectorAll("[data-screen]")
      .forEach(screen => {
        screen.hidden = screen.dataset.screen !== target;
      });

    const inside = [
      "dashboard", "tracker", "settings"
    ].includes(target);

    $("app-navbar").hidden = !inside;
    $("app-footer").hidden = !inside;
    $("notification-panel").hidden = true;
    $("mobile-nav").hidden = true;

    $("notification-toggle").setAttribute(
      "aria-expanded", "false"
    );

    $("menu-toggle").setAttribute(
      "aria-expanded", "false"
    );

    document.querySelectorAll("[data-nav]")
      .forEach(link => {
        if (link.dataset.nav === target) {
          link.setAttribute("aria-current", "page");
        } else {
          link.removeAttribute("aria-current");
        }
      });

    document.title =
      `${target[0].toUpperCase() +
      target.slice(1)} | Flora`;

    if (target === "dashboard") {
      renderDashboard();
    }

    if (target === "tracker") {
      $("greeting").textContent =
        `Hi ${account.username}!`;
      renderPlants();
    }

    if (target === "settings") populateSettings();
    if (target === "loading") startLoading();

    window.scrollTo(0, 0);
  }

  function go(target, replace = false) {
    clearTimeout(signupTimer);

    const safeTarget =
      PAGES.includes(target) ? target : "home";

    const url = `?page=${safeTarget}`;

    if (replace) {
      history.replaceState(
        { page: safeTarget }, "", url
      );
    } else {
      history.pushState(
        { page: safeTarget }, "", url
      );
    }

    showPage(safeTarget);
  }

  document.addEventListener("click", event => {
    const link = event.target.closest('a[href^="?page="]');
    if (!link) return;

    event.preventDefault();

    go(
      new URL(link.href).searchParams.get("page")
    );
  });

  window.addEventListener("popstate", () => {
    showPage(
      new URLSearchParams(location.search)
        .get("page") || "home"
    );
  });

  // =====================================
  // SIGN UP
  // =====================================

  $("signup-form").addEventListener(
    "submit",
    async event => {
      event.preventDefault();
      if (busy) return;

      const username =
        $("signup-username").value.trim();

      const email =
        $("signup-email").value.trim().toLowerCase();

      const password =
        $("signup-password").value;

      if (password !== $("signup-confirm").value) {
        error(
          "Passwords Don't Match!",
          "The passwords must match."
        );
        return;
      }

      if (!username || !email || password.length < 8) {
        error(
          "Missing Information!",
          "Enter valid information and a password of at least 8 characters."
        );
        return;
      }

      busy = true;

      try {
        const result = await request(
          "POST",
          "/api/signup",
          { username, email, password }
        );

        account = result.user;
        await loadAccountData();

        $("signup-form").reset();

        success(
          "Account Created!",
          "Welcome to Flora!"
        );

        signupTimer = setTimeout(() => {
          if (page === "signup") go("loading");
        }, 2000);

      } catch (err) {
        error("Signup Failed!", err.message);
      } finally {
        busy = false;
      }
    }
  );

  // =====================================
  // LOGIN
  // =====================================

  $("login-form").addEventListener(
    "submit",
    async event => {
      event.preventDefault();
      if (busy) return;

      busy = true;

      try {
        const result = await request(
          "POST",
          "/api/login",
          {
            email:
              $("login-email").value.trim().toLowerCase(),
            password:
              $("login-password").value
          }
        );

        account = result.user;
        await loadAccountData();

        $("login-form").reset();
        go("loading");

      } catch (err) {
        error("Login Failed!", err.message);
      } finally {
        busy = false;
      }
    }
  );

  // =====================================
  // LOGOUT
  // =====================================

  async function logout() {
    clearTimeout(signupTimer);

    try {
      await request("POST", "/api/logout");
    } catch (err) {
      toast(err.message);
    }

    account = null;
    plants = [];
    reminders = [];
    recent = [];
    selectedPlantId = null;

    $("login-form").reset();
    go("login", true);
  }

  document.querySelectorAll("[data-logout]")
    .forEach(button => {
      button.addEventListener("click", logout);
    });

  // =====================================
  // LOADING SCREEN
  // =====================================

  function startLoading() {
    const start = performance.now();

    const progress =
      document.querySelector(".loading-progress");

    function tick(now) {
      if (page !== "loading") return;

      const percent = Math.min(
        100,
        Math.floor((now - start) / 50)
      );

      $("loading-percent").textContent = `${percent}%`;
      progress.style.width = `${percent}%`;

      document.querySelector(".loading-bar")
        .setAttribute("aria-valuenow", percent);

      if (percent < 100) {
        loadingFrame = requestAnimationFrame(tick);
      } else {
        go("dashboard", true);
      }
    }

    loadingFrame = requestAnimationFrame(tick);
  }

  // =====================================
  // MOBILE MENU
  // =====================================

  $("menu-toggle").addEventListener("click", () => {
    $("mobile-nav").hidden =
      !$("mobile-nav").hidden;

    $("menu-toggle").setAttribute(
      "aria-expanded",
      String(!$("mobile-nav").hidden)
    );
  });

  // =====================================
  // WATERING SCHEDULE
  // Read-only status and scheduled dates
  // =====================================

  function plantSchedule(plant, now = Date.now()) {
    const frequency =
      Number(plant.frequency) || 1;

    const [hour, minute] =
      (plant.startTime || "08:00")
        .split(":").map(Number);

    const today = new Date(now);
    const slots = [];

    for (let day = -2; day <= 2; day++) {
      const base = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate() + day,
        hour,
        minute
      ).getTime();

      for (let index = 0; index < frequency; index++) {
        slots.push(
          base +
          index * (1440 / frequency) * 60000
        );
      }
    }

    slots.sort((a, b) => a - b);

    const previous = slots.filter(time => time <= now);
    const lastDue = previous[previous.length - 1];

    const next = slots.find(time => time > now);

    const needsWater =
      !Number.isFinite(plant.lastWatered) ||
      plant.lastWatered < lastDue;

    const dailyTimes = Array.from(
      { length: frequency },
      (_, index) => {
        const time = new Date(
          2026, 0, 1,
          hour,
          minute + index * 1440 / frequency
        );

        return time.toLocaleTimeString(
          undefined,
          {
            hour: "numeric",
            minute: "2-digit"
          }
        );
      }
    );

    return {
      needsWater,
      nextWatering:
        needsWater ? lastDue : next,
      dailyTimes
    };
  }

  function wateringEvents(date) {
    return plants.flatMap(plant => {
      const frequency =
        Number(plant.frequency) || 1;

      const [hour, minute] =
        (plant.startTime || "08:00")
          .split(":").map(Number);

      return Array.from(
        { length: frequency },
        (_, index) => {
          const dateTime = parseDay(date);

          dateTime.setHours(
            hour,
            minute + index * 1440 / frequency,
            0,
            0
          );

          const nextDay = new Date(
            dateTime.getFullYear(),
            dateTime.getMonth(),
            dateTime.getDate() + 1
          );

          const completed =
            Number.isFinite(plant.lastWatered) &&
            plant.lastWatered >= dateTime.getTime() &&
            plant.lastWatered < nextDay.getTime();

          return {
            id: `plant-${plant.id}-${index}`,
            plantName: plant.name,
            type: "Watering",
            date,
            time:
              `${pad(dateTime.getHours())}:` +
              pad(dateTime.getMinutes()),
            completed,
            fromTracker: true
          };
        }
      );
    });
  }

  function careFor(date) {
    return [
      ...reminders.filter(
        reminder => reminder.date === date
      ),
      ...wateringEvents(date)
    ].sort(
      (a, b) => a.time.localeCompare(b.time)
    );
  }

  // =====================================
  // MY PLANTS
  // Water button removed
  // =====================================

  function renderPlants() {
    const host = $("plant-grid");
    host.replaceChildren();

    const query =
      $("plant-search").value.trim().toLowerCase();

    const visible = plants.filter(plant =>
      (
        plant.name.toLowerCase().includes(query) ||
        plant.type.toLowerCase().includes(query)
      ) &&
      (
        filter === "all" ||
        plantSchedule(plant).needsWater
      )
    );

    $("empty-message").hidden = visible.length > 0;

    visible.forEach(plant => {
      const schedule = plantSchedule(plant);

      const card = node(
        "article",
        "plant-card" +
        (
          String(selectedPlantId) === String(plant.id)
            ? " selected"
            : ""
        )
      );

      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute(
        "aria-label",
        `Select ${plant.name}`
      );

      const picture = node("div", "plant-picture");

      if (plant.image) {
        const image = node("img");
        image.src = plant.image;
        image.alt = plant.name;
        picture.append(image);
      }

      picture.append(
        node(
          "span",
          "plant-card-status" +
            (schedule.needsWater ? "" : " watered"),
          schedule.needsWater ? "Needs Water" : "Watered"
        )
      );

      const footer = node("div", "plant-footer");

      const title = node(
        "span",
        "plant-title",
        `${plant.name} · ${plant.type}`
      );

      const view = node(
        "button",
        "view-plant-button",
        "View"
      );

      view.type = "button";

      view.addEventListener("click", event => {
        event.stopPropagation();
        openPlantDetails(plant);
      });

      // Only the plant name, type and View button.
      // No manual watering button is created.
      footer.append(title, view);

      card.append(picture, footer);

      function selectCard() {
        selectedPlantId =
          String(selectedPlantId) === String(plant.id)
            ? null
            : plant.id;

        renderPlants();
      }

      card.addEventListener(
        "click",
        selectCard
      );

      card.addEventListener("keydown", event => {
        if (
          event.target === card &&
          ["Enter", " "].includes(event.key)
        ) {
          event.preventDefault();
          selectCard();
        }
      });

      host.append(card);
    });
  }

  // =====================================
  // SEARCH AND FILTER
  // =====================================

  $("plant-search").addEventListener(
    "input",
    renderPlants
  );

  document.querySelectorAll("[data-filter]")
    .forEach(button => {
      button.addEventListener("click", () => {
        filter = button.dataset.filter;

        document.querySelectorAll("[data-filter]")
          .forEach(item => {
            item.classList.toggle(
              "active",
              item === button
            );

            item.setAttribute(
              "aria-pressed",
              String(item === button)
            );
          });

        renderPlants();
      });
    });

  // =====================================
  // RECENTLY VIEWED HISTORY
  // =====================================

  function saveRecentlyViewed(plant) {
    recent = [
      {
        id: plant.id,
        name: plant.name,
        viewedAt: Date.now()
      },
      ...recent.filter(
        item => String(item.id) !== String(plant.id)
      )
    ].slice(0, 10);

    try {
      sessionStorage.setItem(
        `flora-recent-${account.id}`,
        JSON.stringify(recent)
      );
    } catch {
      // Browser session history is optional.
    }
  }

  // =====================================
  // VIEW PLANT DETAILS
  // Water It / Already Watered removed
  // =====================================

  function openPlantDetails(plant) {
    selectedPlantId = plant.id;

    saveRecentlyViewed(plant);
    renderPlants();

    const schedule = plantSchedule(plant);

    $("view-plant-name").textContent =
      plant.name;

    $("view-plant-type").textContent =
      plant.type;

    $("view-frequency").textContent =
      `${plant.frequency}× per day`;

    $("view-watering-times").textContent =
      schedule.dailyTimes.join(", ");

    $("view-last-watered").textContent =
      formatDate(plant.lastWatered);

    $("view-next-watering").textContent =
      formatDate(schedule.nextWatering) +
      (schedule.needsWater ? " (Due)" : "");

    $("view-water-status").textContent =
      schedule.needsWater
        ? "Needs Water"
        : "Watered";

    const image = $("view-plant-image");

    if (plant.image) {
      image.src = plant.image;
      image.alt = plant.name;
      image.hidden = false;
    } else {
      image.removeAttribute("src");
      image.hidden = true;
    }

    $("view-plant-dialog").showModal();
  }

  $("close-view-plant").addEventListener(
    "click",
    () => $("view-plant-dialog").close()
  );

  // Only Edit Plant is functional inside Plant Details.
  $("view-edit-button").addEventListener(
    "click",
    () => {
      if (!currentPlant()) return;

      $("view-plant-dialog").close();
      openPlantForm("edit");
    }
  );

  // =====================================
  // ADD AND EDIT PLANTS
  // =====================================

  function showPreview(image) {
    $("preview-area").hidden = !image;

    if (image) {
      $("picture-preview").src = image;
    } else {
      $("picture-preview").removeAttribute("src");
    }
  }

  function openPlantForm(mode) {
    plantMode = mode;
    imageToken++;
    imageLoading = false;

    $("plant-form").reset();

    const plant = currentPlant();

    if (mode === "edit" && !plant) {
      error(
        "Select a Plant!",
        "Please select a plant first."
      );
      return;
    }

    temporaryImage =
      mode === "edit"
        ? plant.image || ""
        : "";

    $("dialog-heading").textContent =
      mode === "edit"
        ? "Edit Plant"
        : "Add Plant";

    $("plant-name").value =
      mode === "edit" ? plant.name : "";

    $("plant-type").value =
      mode === "edit" ? plant.type : "";

    $("watering-frequency").value =
      mode === "edit"
        ? String(plant.frequency)
        : "1";

    $("watering-start-time").value =
      mode === "edit"
        ? plant.startTime
        : "08:00";

    showPreview(temporaryImage);
    $("plant-dialog").showModal();
  }

  $("add-plant").addEventListener(
    "click",
    () => openPlantForm("add")
  );

  $("edit-plant").addEventListener(
    "click",
    () => openPlantForm("edit")
  );

  $("cancel-dialog").addEventListener(
    "click",
    () => $("plant-dialog").close()
  );

  $("plant-dialog").addEventListener(
    "close",
    () => {
      imageToken++;
      imageLoading = false;
    }
  );

  // =====================================
  // PLANT IMAGE UPLOAD
  // =====================================

  $("plant-picture").addEventListener(
    "change",
    () => {
      const file = $("plant-picture").files[0];
      if (!file) return;

      if (
        !["image/jpeg", "image/png", "image/webp"]
          .includes(file.type) ||
        file.size > 1.5 * 1024 * 1024
      ) {
        $("plant-picture").value = "";

        error(
          "Invalid Picture!",
          "Choose a JPG, PNG or WEBP image below 1.5 MB."
        );
        return;
      }

      const token = ++imageToken;
      const reader = new FileReader();

      imageLoading = true;

      reader.onload = () => {
        if (
          token !== imageToken ||
          !$("plant-dialog").open
        ) return;

        const image = String(reader.result);
        imageLoading = false;

        if (image.length > 2000000) {
          error(
            "Picture Too Large!",
            "Choose a smaller picture."
          );
          return;
        }

        temporaryImage = image;
        showPreview(image);
      };

      reader.onerror = () => {
        imageLoading = false;

        error(
          "Picture Error!",
          "Cannot read image."
        );
      };

      reader.readAsDataURL(file);
    }
  );

  // =====================================
  // SAVE PLANTS
  // =====================================

  $("plant-form").addEventListener(
    "submit",
    async event => {
      event.preventDefault();

      if (busy) return;

      if (imageLoading) {
        error(
          "Picture Loading!",
          "Wait for the picture to load."
        );
        return;
      }

      const name =
        $("plant-name").value.trim();

      const type =
        $("plant-type").value.trim();

      const frequency = Number(
        $("watering-frequency").value
      );

      const startTime =
        $("watering-start-time").value;

      if (
        !name ||
        !type ||
        ![1, 2, 3].includes(frequency) ||
        !startTime
      ) {
        error(
          "Missing Information!",
          "Complete the plant details."
        );
        return;
      }

      busy = true;
      const adding = plantMode === "add";

      try {
        const data = {
          name,
          type,
          image: temporaryImage,
          frequency,
          startTime
        };

        if (adding) {
          const saved = await request(
            "POST",
            "/api/plants",
            data
          );

          plants.push(saved);
          selectedPlantId = saved.id;
        } else {
          const existing = currentPlant();

          if (!existing) {
            throw new Error(
              "Please select a plant."
            );
          }

          const updated = await request(
            "PUT",
            `/api/plants/${encodeURIComponent(existing.id)}`,
            data
          );

          Object.assign(existing, updated);
        }

        $("plant-dialog").close();
        renderPlants();
        renderNotifications();

        success(
          adding ? "Plant Added!" : "Plant Updated!",
          `${name}'s details were saved.`
        );

      } catch (err) {
        error("Save Failed!", err.message);
      } finally {
        busy = false;
      }
    }
  );

  // =====================================
  // DELETE PLANTS
  // =====================================

  $("delete-plant").addEventListener(
    "click",
    () => {
      const plant = currentPlant();

      if (!plant) {
        error(
          "Select a Plant!",
          "Select a plant to delete."
        );
        return;
      }

      deletePlantId = plant.id;

      $("delete-message").textContent =
        `Delete ${plant.name}? This cannot be undone.`;

      $("delete-dialog").showModal();
    }
  );

  $("keep-plant").addEventListener(
    "click",
    () => $("delete-dialog").close()
  );

  $("confirm-delete").addEventListener(
    "click",
    async () => {
      if (busy || !deletePlantId) return;
      busy = true;

      try {
        const id = deletePlantId;

        await request(
          "DELETE",
          `/api/plants/${encodeURIComponent(id)}`
        );

        plants = plants.filter(
          plant => String(plant.id) !== String(id)
        );

        reminders = reminders.filter(
          reminder => String(reminder.plantId) !== String(id)
        );

        recent = recent.filter(
          item => String(item.id) !== String(id)
        );

        try {
          sessionStorage.setItem(
            `flora-recent-${account.id}`,
            JSON.stringify(recent)
          );
        } catch {}

        selectedPlantId = null;
        deletePlantId = null;

        $("delete-dialog").close();
        renderPlants();
        renderNotifications();

        success(
          "Plant Deleted!",
          "The plant was removed."
        );

      } catch (err) {
        error("Delete Failed!", err.message);
      } finally {
        busy = false;
      }
    }
  );

  // =====================================
  // DASHBOARD STATISTICS
  // =====================================

  function renderStats() {
    $("total-plants").textContent =
      plants.length;

    $("watered-plants").textContent =
      plants.filter(
        plant => !plantSchedule(plant).needsWater
      ).length;

    $("upcoming-count").textContent =
      careFor(dateKey(new Date()))
        .filter(item => !item.completed)
        .length;
  }

  // =====================================
  // CALENDAR
  // =====================================

  function renderCalendar() {
    const host = $("calendar-days");
    host.replaceChildren();

    $("calendar-title").textContent =
      viewedMonth.toLocaleDateString(
        undefined,
        {
          month: "long",
          year: "numeric"
        }
      );

    const year = viewedMonth.getFullYear();
    const month = viewedMonth.getMonth();

    const count =
      new Date(year, month + 1, 0).getDate();

    const leading =
      (new Date(year, month, 1).getDay() + 6) % 7;

    for (let index = 0; index < leading; index++) {
      host.append(
        node("span", "calendar-day empty")
      );
    }

    for (let day = 1; day <= count; day++) {
      const value = dateKey(
        new Date(year, month, day)
      );

      const button = node(
        "button",
        "calendar-day",
        String(day)
      );

      button.type = "button";

      if (value === dateKey(new Date())) {
        button.classList.add("today");
      }

      if (value === selectedDate) {
        button.classList.add("selected");
      }

      if (careFor(value).length) {
        button.classList.add("has-care");
      }

      button.setAttribute(
        "aria-label",
        displayDate(value)
      );

      button.addEventListener("click", () => {
        selectedDate = value;
        renderDashboard();
      });

      host.append(button);
    }
  }

  $("prev-month").addEventListener(
    "click",
    () => {
      viewedMonth = new Date(
        viewedMonth.getFullYear(),
        viewedMonth.getMonth() - 1,
        1
      );
      renderCalendar();
    }
  );

  $("next-month").addEventListener(
    "click",
    () => {
      viewedMonth = new Date(
        viewedMonth.getFullYear(),
        viewedMonth.getMonth() + 1,
        1
      );
      renderCalendar();
    }
  );

  $("calendar-today").addEventListener(
    "click",
    () => {
      const date = new Date();

      selectedDate = dateKey(date);

      viewedMonth = new Date(
        date.getFullYear(),
        date.getMonth(),
        1
      );

      renderDashboard();
    }
  );

  // =====================================
  // CARE TODAY
  // =====================================

  function renderCare() {
    const isToday =
      selectedDate === dateKey(new Date());

    $("care-title").textContent =
      isToday
        ? "Care Today"
        : `Care for ${displayDate(selectedDate, {
            month: "short",
            day: "numeric"
          })}`;

    $("selected-date-label").textContent =
      displayDate(selectedDate, {
        weekday: "long",
        month: "long",
        day: "numeric"
      });

    const host = $("care-list");
    host.replaceChildren();

    const items = careFor(selectedDate);

    if (!items.length) {
      host.append(
        node(
          "p",
          "empty-message",
          "Nothing scheduled for this day."
        )
      );
      return;
    }

    items.forEach(item => {
      const row = node(
        "div",
        "care-item" +
          (item.completed ? " completed" : "")
      );

      const time = node("div", "care-time");

      time.append(
        node(
          "small",
          "",
          displayDate(item.date, {
            month: "short",
            day: "numeric"
          })
        ),
        node("b", "", formatTime(item.time))
      );

      const description = node(
        "div",
        "care-description"
      );

      description.append(
        node("strong", "", item.plantName),
        node(
          "small",
          "",
          item.type +
            (item.fromTracker ? " · My Plants" : "")
        )
      );

      const checkbox = node(
        "input",
        "care-checkbox"
      );

      checkbox.type = "checkbox";
      checkbox.checked = !!item.completed;

      checkbox.setAttribute(
        "aria-label",
        `Complete ${item.plantName} ${item.type}`
      );

      if (item.fromTracker) {
        checkbox.disabled = true;
        checkbox.title =
          "This scheduled watering entry is read-only.";
      } else {
        checkbox.addEventListener(
          "change",
          async () => {
            try {
              const updated = await request(
                "PATCH",
                `/api/reminders/${encodeURIComponent(item.id)}`,
                { completed: checkbox.checked }
              );

              Object.assign(item, updated);
              renderDashboard();

              success(
                "Reminder Updated!",
                `${item.plantName}'s care has been updated.`
              );

            } catch (err) {
              renderDashboard();
              error("Save Failed!", err.message);
            }
          }
        );
      }

      row.append(time, description, checkbox);

      if (!item.fromTracker) {
        const remove = node(
          "button",
          "care-delete",
          "×"
        );

        remove.type = "button";

        remove.addEventListener("click", () => {
          deleteCareId = item.id;

          $("delete-care-text").textContent =
            `Remove ${item.plantName}'s ${item.type.toLowerCase()} reminder?`;

          $("delete-care-dialog").showModal();
        });

        row.append(remove);
      }

      host.append(row);
    });
  }

  // =====================================
  // PLANT NAME DROPDOWN
  // =====================================

  function populateCarePlantNames(
    type = "",
    selectedId = ""
  ) {
    const select = $("care-plant-name");

    select.replaceChildren(
      new Option("Select a plant", "")
    );

    plants
      .filter(plant => !type || plant.type === type)
      .forEach(plant => {
        select.add(
          new Option(plant.name, String(plant.id))
        );
      });

    select.value = selectedId;
  }

  // =====================================
  // PLANT TYPE DROPDOWN
  // =====================================

  function populateCarePlantTypes() {
    const select = $("care-plant-type");

    select.replaceChildren(
      new Option("Select a plant type", "")
    );

    const types = [
      ...new Set(plants.map(plant => plant.type))
    ].sort(
      (a, b) => a.localeCompare(b)
    );

    types.forEach(type => {
      select.add(new Option(type, type));
    });
  }

  // =====================================
  // LINK PLANT NAME AND PLANT TYPE
  // =====================================

  $("care-plant-name").addEventListener(
    "change",
    () => {
      const plant = plants.find(
        item =>
          String(item.id) ===
          $("care-plant-name").value
      );

      $("care-plant-type").value =
        plant ? plant.type : "";
    }
  );

  $("care-plant-type").addEventListener(
    "change",
    () => {
      const type = $("care-plant-type").value;
      const currentId = $("care-plant-name").value;

      const current = plants.find(
        item => String(item.id) === currentId
      );

      populateCarePlantNames(
        type,
        current?.type === type ? currentId : ""
      );
    }
  );

  // =====================================
  // OPEN CARE REMINDER
  // =====================================

  $("add-care-button").addEventListener(
    "click",
    () => {
      if (!plants.length) {
        error(
          "No Plants Yet!",
          "Add a plant in My Plants before creating a care reminder."
        );
        return;
      }

      $("care-form").reset();

      populateCarePlantTypes();
      populateCarePlantNames();

      $("care-date").value = selectedDate;
      $("care-time").value = "09:00";

      $("care-dialog").showModal();
    }
  );

  $("cancel-care-button").addEventListener(
    "click",
    () => $("care-dialog").close()
  );

  // =====================================
  // SAVE CARE REMINDER
  // =====================================

  $("care-form").addEventListener(
    "submit",
    async event => {
      event.preventDefault();

      const plantId = $("care-plant-name").value;
      const plantType = $("care-plant-type").value;

      const plant = plants.find(
        item => String(item.id) === plantId
      );

      const type = $("care-type").value;
      const date = $("care-date").value;
      const time = $("care-time").value;

      if (
        !plant ||
        plant.type !== plantType ||
        !date ||
        !time
      ) {
        error(
          "Missing Details!",
          "Choose a matching plant name and type, date, and time."
        );
        return;
      }

      try {
        const reminder = await request(
          "POST",
          "/api/reminders",
          {
            plantId,
            plantType,
            type,
            date,
            time
          }
        );

        reminders.push(reminder);
        selectedDate = date;

        viewedMonth = new Date(
          parseDay(date).getFullYear(),
          parseDay(date).getMonth(),
          1
        );

        $("care-dialog").close();
        renderDashboard();

        success(
          "Reminder Added!",
          `${plant.name}'s ${type.toLowerCase()} reminder is ready.`
        );

      } catch (err) {
        error(
          "Reminder Not Saved!",
          err.message
        );
      }
    }
  );

  // =====================================
  // DELETE CARE REMINDER
  // =====================================

  $("keep-care").addEventListener(
    "click",
    () => $("delete-care-dialog").close()
  );

  $("confirm-delete-care").addEventListener(
    "click",
    async () => {
      if (!deleteCareId) return;

      try {
        await request(
          "DELETE",
          `/api/reminders/${encodeURIComponent(deleteCareId)}`
        );

        reminders = reminders.filter(
          item => String(item.id) !== String(deleteCareId)
        );

        deleteCareId = null;

        $("delete-care-dialog").close();
        renderDashboard();

        success(
          "Reminder Deleted!",
          "Care reminder removed."
        );

      } catch (err) {
        error(
          "Delete Failed!",
          err.message
        );
      }
    }
  );

  // =====================================
  // NOTIFICATIONS
  // =====================================

  function renderNotifications() {
    const host = $("notification-list");
    host.replaceChildren();

    const pending = careFor(
      dateKey(new Date())
    ).filter(item => !item.completed);

    if (!pending.length) {
      host.append(
        node(
          "div",
          "notification-entry",
          "🌱 All caught up! No pending care today."
        )
      );
      return;
    }

    pending.forEach((item, index) => {
      const row = node(
        "div",
        "notification-entry"
      );

      const image = node("img");
      image.src =
        `images/notification-flower-${index % 3 + 1}.svg`;
      image.alt = "";

      row.append(
        image,
        node(
          "span",
          "",
          `${item.plantName}: ${item.type} at ${formatTime(item.time)}`
        )
      );

      host.append(row);
    });
  }

  $("notification-toggle").addEventListener(
    "click",
    () => {
      const panel = $("notification-panel");
      panel.hidden = !panel.hidden;

      $("notification-toggle").setAttribute(
        "aria-expanded",
        String(!panel.hidden)
      );

      if (!panel.hidden) renderNotifications();
    }
  );

  $("close-notifications").addEventListener(
    "click",
    () => {
      $("notification-panel").hidden = true;
      $("notification-toggle").setAttribute(
        "aria-expanded",
        "false"
      );
    }
  );

  // =====================================
  // RECENTLY VIEWED - DATE ONLY
  // =====================================

  function renderRecent() {
    const host = $("recent-list");
    host.replaceChildren();

    const existing = recent.filter(
      item => plants.some(
        plant => String(plant.id) === String(item.id)
      )
    );

    if (!existing.length) {
      host.append(
        node(
          "p",
          "empty-message",
          "No recently viewed plants yet. Explore your garden!"
        )
      );
      return;
    }

    existing.slice(0, 3).forEach(item => {
      const plant = plants.find(
        record => String(record.id) === String(item.id)
      );

      const link = node(
        "a",
        "recent-plant"
      );

      link.href = "?page=tracker";

      const date = new Date(
        item.viewedAt
      ).toLocaleDateString(
        undefined,
        {
          year: "numeric",
          month: "short",
          day: "numeric"
        }
      );

      link.append(
        node("small", "", date),
        node("h3", "", plant.name),
        node("p", "", "View Plant Details →")
      );

      link.addEventListener(
        "click",
        event => {
          event.preventDefault();
          go("tracker");
          openPlantDetails(plant);
        }
      );

      host.append(link);
    });
  }

  // =====================================
  // RENDER DASHBOARD
  // =====================================

  function renderDashboard() {
    $("welcome-title").textContent =
      `Welcome back, ${account?.username || "Gardener"}!`;

    renderStats();
    renderCalendar();
    renderCare();
    renderRecent();
    renderNotifications();
  }

  // =====================================
  // SETTINGS
  // =====================================

  function populateSettings() {
    if (!account) return;

    $("settings-username").value =
      account.username;

    $("settings-email").value =
      account.email;
  }

  $("profile-form").addEventListener(
    "submit",
    async event => {
      event.preventDefault();

      if (!account) return;

      try {
        const result = await request(
          "PUT",
          "/api/me",
          {
            username:
              $("settings-username").value.trim(),
            email:
              $("settings-email").value
                .trim().toLowerCase()
          }
        );

        account = result.user;

        success(
          "Profile Updated!",
          "Your account details have been saved."
        );

      } catch (err) {
        error(
          "Update Failed!",
          err.message
        );
      }
    }
  );

  // =====================================
  // DELETE ACCOUNT
  // =====================================

  $("delete-account").addEventListener(
    "click",
    () => $("delete-account-dialog").showModal()
  );

  $("cancel-delete-account").addEventListener(
    "click",
    () => $("delete-account-dialog").close()
  );

  $("confirm-delete-account").addEventListener(
    "click",
    async () => {
      if (!account) return;

      try {
        await request("DELETE", "/api/me");

        try {
          sessionStorage.removeItem(
            `flora-recent-${account.id}`
          );
        } catch {}

        account = null;
        plants = [];
        reminders = [];
        recent = [];
        selectedPlantId = null;

        $("delete-account-dialog").close();

        success(
          "Account Data Deleted!",
          "Your saved information was deleted."
        );

        setTimeout(
          () => go("login", true),
          2000
        );

      } catch (err) {
        error(
          "Delete Failed!",
          err.message
        );
      }
    }
  );

  // =====================================
  // REFRESH
  // =====================================

  async function refresh() {
    if (!account || busy) return;

    try {
      await loadAccountData();

      if (page === "dashboard") {
        renderDashboard();
      }

      if (page === "tracker") {
        renderPlants();
      }

      if (!$("notification-panel").hidden) {
        renderNotifications();
      }

    } catch (err) {
      console.warn(
        "Refresh failed:",
        err.message
      );
    }
  }

  setInterval(refresh, 60000);

  document.addEventListener(
    "visibilitychange",
    () => {
      if (!document.hidden) refresh();
    }
  );

  // =====================================
  // INITIAL PAGE
  // =====================================

  async function initialize() {
    const requested = new URLSearchParams(
      location.search
    ).get("page") || "home";

    try {
      const result = await api("/api/me");

      account = result.user;
      await loadAccountData();

      showPage(requested);

    } catch {
      account = null;
      plants = [];
      reminders = [];
      recent = [];

      showPage(
        PRIVATE.includes(requested)
          ? "login"
          : requested
      );
    }
  }

  initialize();
});
