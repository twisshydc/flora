
document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, "0");

  const SCREENS = [
    "home", "signup", "login", "loading",
    "dashboard", "tracker", "settings"
  ];

  const PRIVATE = [
    "dashboard", "tracker", "settings", "loading"
  ];

  const ICONS = {
    success: "images/check.svg",
    error: "images/x.svg"
  };

  let account = null;
  let plants = [];
  let reminders = [];
  let recent = [];

  let page = "home";
  let selectedPlantId = null;
  let selectedDate = dateKey(new Date());
  let viewedMonth = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1
  );

  let filter = "all";
  let plantMode = "add";
  let temporaryImage = "";
  let imageLoading = false;
  let imageToken = 0;
  let deletePlantId = null;
  let deleteCareId = null;

  let popupTimer;
  let toastTimer;
  let loadingFrame;
  let signupTimer;
  let busy = false;

  /* =====================================
     DATE HELPERS
  ===================================== */

  function dateKey(date) {
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate())
    ].join("-");
  }

  function parseDay(value) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function formatDate(timestamp) {
    if (!Number.isFinite(timestamp)) {
      return "Not yet watered";
    }

    return new Date(timestamp).toLocaleString(
      undefined,
      { dateStyle: "medium", timeStyle: "short" }
    );
  }

  function formatTime(value) {
    const [hour, minute] =
      (value || "09:00").split(":").map(Number);

    return new Date(
      2026, 0, 1, hour, minute
    ).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function displayDate(value, options = {
    weekday: "short",
    month: "short",
    day: "numeric"
  }) {
    return parseDay(value).toLocaleDateString(
      undefined, options
    );
  }

  function node(tag, className = "", value = "") {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = value;
    return element;
  }

  function currentPlant() {
    return plants.find(
      plant => String(plant.id) === String(selectedPlantId)
    ) || null;
  }

  function currentUsername() {
    return account?.username || "Gardener";
  }

  /* =====================================
     EXPRESS API
  ===================================== */

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
        "Cannot connect to Flora. Make sure the Express server is running."
      );
    }

    let result;

    try {
      result = await response.json();
    } catch {
      throw new Error("Invalid response from the server.");
    }

    if (!response.ok) {
      if (response.status === 401 &&
          !url.includes("/api/login") &&
          !url.includes("/api/signup")) {
        account = null;
      }

      throw new Error(
        result.error || "Something went wrong."
      );
    }

    return result;
  }

  function request(method, url, body) {
    return api(url, {
      method,
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body) })
    });
  }

  async function loadAccountData() {
    const [savedPlants, savedReminders] = await Promise.all([
      api("/api/plants"),
      api("/api/reminders")
    ]);

    plants = savedPlants.map(plant => ({
      ...plant,
      frequency: Number(plant.frequency) || 1,
      startTime: plant.startTime || "08:00",
      lastWatered: Number.isFinite(plant.lastWatered)
        ? plant.lastWatered : null
    }));

    reminders = savedReminders;

    const recentKey = `flora-recent-${account.id}`;

    try {
      recent = JSON.parse(
        sessionStorage.getItem(recentKey) || "[]"
      );
      if (!Array.isArray(recent)) recent = [];
    } catch {
      recent = [];
    }
  }

  /* =====================================
     NOTIFICATIONS AND POPUPS
  ===================================== */

  function notify(message) {
    const toast = $("toast");
    clearTimeout(toastTimer);

    toast.textContent = message;

    toastTimer = setTimeout(() => {
      toast.textContent = "";
    }, 2000);
  }

  function popup(title, message, type = "success") {
    clearTimeout(popupTimer);

    $("quick-popup-title").textContent = title;
    $("quick-popup-text").textContent = message;

    $("quick-popup-image").src =
      type === "error"
        ? ICONS.error
        : ICONS.success;

    $("quick-popup").hidden = false;

    popupTimer = setTimeout(() => {
      $("quick-popup").hidden = true;
    }, 2000);
  }

  function success(title, message) {
    popup(title, message, "success");
  }

  function error(title, message) {
    popup(title, message, "error");
  }

  /* =====================================
     PAGE NAVIGATION
  ===================================== */

  function showPage(requested) {
    if (!SCREENS.includes(requested)) {
      requested = "home";
    }

    if (PRIVATE.includes(requested) && !account) {
      requested = "login";
    }

    cancelAnimationFrame(loadingFrame);

    page = requested;
    document.body.dataset.page = requested;

    document.querySelectorAll("[data-screen]")
      .forEach(screen => {
        screen.hidden =
          screen.dataset.screen !== requested;
      });

    const inside = [
      "dashboard", "tracker", "settings"
    ].includes(requested);

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
        if (link.dataset.nav === requested) {
          link.setAttribute("aria-current", "page");
        } else {
          link.removeAttribute("aria-current");
        }
      });

    document.title =
      `${requested === "home"
        ? "Welcome"
        : requested[0].toUpperCase() +
          requested.slice(1)} | Flora`;

    if (requested === "dashboard") {
      renderDashboard();
    }

    if (requested === "tracker") {
      $("greeting").textContent =
        `Hi ${currentUsername()}!`;
      renderPlants();
    }

    if (requested === "settings") {
      populateSettings();
    }

    if (requested === "loading") {
      startLoading();
    }

    window.scrollTo(0, 0);
  }

  function go(target, replace = false) {
    clearTimeout(signupTimer);

    if (!SCREENS.includes(target)) {
      target = "home";
    }

    const url = `?page=${target}`;

    if (replace) {
      history.replaceState({ page: target }, "", url);
    } else {
      history.pushState({ page: target }, "", url);
    }

    showPage(target);
  }

  document.addEventListener("click", event => {
    const link =
      event.target.closest('a[href^="?page="]');

    if (!link) return;

    event.preventDefault();

    const target =
      new URL(link.href).searchParams.get("page");

    go(target);
  });

  window.addEventListener("popstate", () => {
    clearTimeout(signupTimer);

    const requested = new URLSearchParams(
      location.search
    ).get("page") || "home";

    showPage(requested);
  });

  /* =====================================
     SIGNUP
  ===================================== */

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

      const confirm =
        $("signup-confirm").value;

      if (!username || !email) {
        error(
          "Missing Information!",
          "Please complete all required fields."
        );
        return;
      }

      if (password !== confirm) {
        error(
          "Passwords Don't Match!",
          "Please make sure both passwords are the same."
        );
        return;
      }

      if (password.length < 8) {
        error(
          "Password Too Short!",
          "Your password must have at least 8 characters."
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
          "Welcome to Flora! Your little garden is ready to grow."
        );

        signupTimer = setTimeout(() => {
          if (page === "signup") {
            go("loading");
          }
        }, 2000);

      } catch (err) {
        error("Signup Failed!", err.message);
      } finally {
        busy = false;
      }
    }
  );

  /* =====================================
     LOGIN
  ===================================== */

  $("login-form").addEventListener(
    "submit",
    async event => {
      event.preventDefault();
      if (busy) return;

      const email =
        $("login-email").value.trim().toLowerCase();

      const password =
        $("login-password").value;

      busy = true;

      try {
        const result = await request(
          "POST",
          "/api/login",
          { email, password }
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

  /* =====================================
     LOADING SCREEN
  ===================================== */

  function startLoading() {
    const duration = 5000;
    const started = performance.now();

    const progress =
      document.querySelector(".loading-progress");

    progress.style.width = "0%";
    $("loading-percent").textContent = "0%";

    function update(now) {
      if (page !== "loading") return;

      const percent = Math.min(
        100,
        Math.floor(
          ((now - started) / duration) * 100
        )
      );

      $("loading-percent").textContent =
        `${percent}%`;

      progress.style.width = `${percent}%`;

      document.querySelector(".loading-bar")
        .setAttribute(
          "aria-valuenow",
          String(percent)
        );

      if (percent < 100) {
        loadingFrame =
          requestAnimationFrame(update);
      } else {
        go("dashboard", true);
      }
    }

    loadingFrame = requestAnimationFrame(update);
  }

  /* =====================================
     MOBILE MENU AND LOGOUT
  ===================================== */

  $("menu-toggle").addEventListener(
    "click",
    () => {
      const menu = $("mobile-nav");
      menu.hidden = !menu.hidden;

      $("menu-toggle").setAttribute(
        "aria-expanded",
        String(!menu.hidden)
      );
    }
  );

  async function logout() {
    clearTimeout(signupTimer);

    try {
      await request("POST", "/api/logout");
    } catch (err) {
      notify(err.message);
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

  /* =====================================
     WATERING SCHEDULE
  ===================================== */

  function plantSchedule(plant, now = Date.now()) {
    const frequency =
      Number(plant.frequency) || 1;

    const [hour, minute] =
      (plant.startTime || "08:00")
        .split(":").map(Number);

    const slots = [];
    const today = new Date(now);

    for (let day = -2; day <= 2; day++) {
      const base = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate() + day,
        hour,
        minute
      ).getTime();

      for (
        let index = 0;
        index < frequency;
        index++
      ) {
        slots.push(
          base +
          index * (1440 / frequency) * 60000
        );
      }
    }

    slots.sort((a, b) => a - b);

    const previous =
      slots.filter(slot => slot <= now);

    const upcoming =
      slots.find(slot => slot > now);

    const lastDue =
      previous[previous.length - 1];

    const lastWatered =
      Number.isFinite(plant.lastWatered)
        ? plant.lastWatered
        : null;

    const needsWater =
      lastWatered === null ||
      lastWatered < lastDue;

    const dailyTimes = [];

    for (
      let index = 0;
      index < frequency;
      index++
    ) {
      const slot = new Date(
        2026, 0, 1,
        hour,
        minute + index * 1440 / frequency
      );

      dailyTimes.push(
        slot.toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit"
        })
      );
    }

    return {
      needsWater,
      dailyTimes,
      nextWatering:
        needsWater ? lastDue : upcoming
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
          const time = parseDay(date);

          time.setHours(
            hour,
            minute +
              index * 1440 / frequency,
            0,
            0
          );

          const end = new Date(
            time.getFullYear(),
            time.getMonth(),
            time.getDate() + 1
          ).getTime();

          const completed =
            Number.isFinite(plant.lastWatered) &&
            plant.lastWatered >= time.getTime() &&
            plant.lastWatered < end;

          return {
            id: `plant-${plant.id}-${index}`,
            plantName: plant.name,
            type: "Watering",
            date,
            time:
              `${pad(time.getHours())}:` +
              pad(time.getMinutes()),
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
        item => item.date === date
      ),
      ...wateringEvents(date)
    ].sort(
      (a, b) => a.time.localeCompare(b.time)
    );
  }

  /* =====================================
     PLANT TRACKER - READ
  ===================================== */

  function renderPlants() {
    const grid = $("plant-grid");
    grid.replaceChildren();

    const search =
      $("plant-search").value
        .trim().toLowerCase();

    const visible = plants.filter(plant => {
      const matches =
        plant.name.toLowerCase().includes(search) ||
        plant.type.toLowerCase().includes(search);

      return matches && (
        filter === "all" ||
        plantSchedule(plant).needsWater
      );
    });

    $("empty-message").hidden =
      visible.length > 0;

    visible.forEach(plant => {
      const schedule = plantSchedule(plant);

      const card = node(
        "article",
        "plant-card" +
          (String(selectedPlantId) ===
           String(plant.id)
            ? " selected"
            : "")
      );

      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute(
        "aria-label", `Select ${plant.name}`
      );

      const picture =
        node("div", "plant-picture");

      if (plant.image) {
        const image = node("img");
        image.src = plant.image;
        image.alt = plant.name;
        picture.append(image);
      }

      const status = node(
        "span",
        "plant-card-status" +
          (schedule.needsWater
            ? ""
            : " watered"),
        schedule.needsWater
          ? "Needs Water"
          : "Watered"
      );

      picture.append(status);

      const footer =
        node("div", "plant-footer");

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

      const water = node(
        "button", "water-chip"
      );

      water.type = "button";
      water.title = schedule.needsWater
        ? "Water It"
        : "Already Watered";

      const can = node("img");
      can.src = "images/watering-can.svg";
      can.alt = "";
      water.append(can);

      water.addEventListener(
        "click",
        async event => {
          event.stopPropagation();
          await waterPlant(plant);
        }
      );

      footer.append(title, view, water);
      card.append(picture, footer);

      function toggleSelection() {
        selectedPlantId =
          String(selectedPlantId) ===
          String(plant.id)
            ? null
            : plant.id;

        renderPlants();
      }

      card.addEventListener(
        "click", toggleSelection
      );

      card.addEventListener(
        "keydown",
        event => {
          if (
            event.target === card &&
            ["Enter", " "].includes(event.key)
          ) {
            event.preventDefault();
            toggleSelection();
          }
        }
      );

      grid.append(card);
    });
  }

  /* =====================================
     PLANT TRACKER - WATER
  ===================================== */

  async function waterPlant(plant) {
    if (busy) return;

    if (!plantSchedule(plant).needsWater) {
      error(
        "Already Watered!",
        `${plant.name} has already been watered. Come back at the next scheduled time!`
      );
      return;
    }

    busy = true;

    try {
      const updated = await request(
        "PATCH",
        `/api/plants/${encodeURIComponent(plant.id)}/water`
      );

      Object.assign(plant, updated);

      renderPlants();
      renderNotifications();

      if ($("view-plant-dialog").open) {
        $("view-plant-dialog").close();
      }

      success(
        "Plant Watered!",
        `${plant.name} has been watered successfully.`
      );
    } catch (err) {
      error("Unable to Save!", err.message);
    } finally {
      busy = false;
    }
  }

  /* =====================================
     PLANT DETAILS
  ===================================== */

  function saveRecentlyViewed(plant) {
    recent = [
      {
        id: plant.id,
        name: plant.name,
        viewedAt: Date.now()
      },
      ...recent.filter(
        item => String(item.id) !==
          String(plant.id)
      )
    ].slice(0, 10);

    try {
      sessionStorage.setItem(
        `flora-recent-${account.id}`,
        JSON.stringify(recent)
      );
    } catch {
      // Recently viewed is optional.
    }
  }

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

    $("view-water-button").disabled = false;

    $("view-water-button").textContent =
      schedule.needsWater
        ? "Water It"
        : "Already Watered";

    $("view-plant-dialog").showModal();
  }

  $("close-view-plant").addEventListener(
    "click",
    () => $("view-plant-dialog").close()
  );

  $("view-water-button").addEventListener(
    "click",
    async () => {
      const plant = currentPlant();
      if (plant) await waterPlant(plant);
    }
  );

  $("view-edit-button").addEventListener(
    "click",
    () => {
      if (!currentPlant()) return;

      $("view-plant-dialog").close();
      openPlantForm("edit");
    }
  );

  /* =====================================
     ADD AND EDIT FORM
  ===================================== */

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
    $("plant-picture").value = "";

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
      mode === "add"
        ? "Add Plant"
        : "Edit Plant";

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
    () => {
      if (!currentPlant()) {
        error(
          "Select a Plant!",
          "Please select a plant before editing."
        );
        return;
      }

      openPlantForm("edit");
    }
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

  /* =====================================
     PLANT PICTURE UPLOAD
     SAVES IMAGE DATA THROUGH EXPRESS
  ===================================== */

  $("plant-picture").addEventListener(
    "change",
    () => {
      const file = $("plant-picture").files[0];
      if (!file) return;

      const allowed = [
        "image/jpeg",
        "image/png",
        "image/webp"
      ];

      if (
        !allowed.includes(file.type) ||
        file.size > 1.5 * 1024 * 1024
      ) {
        error(
          "Invalid Picture!",
          "Choose a JPG, PNG or WEBP image under 1.5 MB."
        );

        $("plant-picture").value = "";
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

        const imageData = String(reader.result);

        if (imageData.length > 2_000_000) {
          imageLoading = false;
          $("plant-picture").value = "";

          error(
            "Picture Too Large!",
            "Please choose a smaller image."
          );
          return;
        }

        temporaryImage = imageData;
        imageLoading = false;
        showPreview(temporaryImage);
      };

      reader.onerror = () => {
        if (token !== imageToken) return;

        imageLoading = false;

        error(
          "Picture Error!",
          "Your picture could not be loaded."
        );
      };

      reader.readAsDataURL(file);
    }
  );

  /* =====================================
     CREATE AND UPDATE PLANTS
  ===================================== */

  $("plant-form").addEventListener(
    "submit",
    async event => {
      event.preventDefault();

      if (busy) return;

      if (imageLoading) {
        error(
          "Picture Still Loading!",
          "Please try again after the picture loads."
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
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)
      ) {
        error(
          "Invalid Plant Details!",
          "Please complete the plant information."
        );
        return;
      }

      const wasAdding = plantMode === "add";

      const data = {
        name,
        type,
        image: temporaryImage,
        frequency,
        startTime
      };

      busy = true;

      try {
        if (wasAdding) {
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
          wasAdding
            ? "Plant Added!"
            : "Plant Updated!",
          wasAdding
            ? `${name} has joined your garden!`
            : `${name}'s details have been saved.`
        );

      } catch (err) {
        error("Save Failed!", err.message);
      } finally {
        busy = false;
      }
    }
  );

  /* =====================================
     DELETE PLANT
  ===================================== */

  $("delete-plant").addEventListener(
    "click",
    () => {
      const plant = currentPlant();

      if (!plant) {
        error(
          "Select a Plant!",
          "Please select a plant before deleting."
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

      const plant = plants.find(
        item => String(item.id) ===
          String(deletePlantId)
      );

      if (!plant) return;

      busy = true;

      try {
        await request(
          "DELETE",
          `/api/plants/${encodeURIComponent(plant.id)}`
        );

        plants = plants.filter(
          item => String(item.id) !==
            String(plant.id)
        );

        recent = recent.filter(
          item => String(item.id) !==
            String(plant.id)
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
          `${plant.name} has been removed from your garden.`
        );
      } catch (err) {
        error("Delete Failed!", err.message);
      } finally {
        busy = false;
      }
    }
  );

  /* =====================================
     SEARCH AND FILTER
  ===================================== */

  $("plant-search").addEventListener(
    "input", renderPlants
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

  /* =====================================
     DASHBOARD STATISTICS
  ===================================== */

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

  /* =====================================
     CALENDAR
  ===================================== */

  function renderCalendar() {
    const host = $("calendar-days");
    host.replaceChildren();

    $("calendar-title").textContent =
      viewedMonth.toLocaleDateString(
        undefined,
        { month: "long", year: "numeric" }
      );

    const year = viewedMonth.getFullYear();
    const month = viewedMonth.getMonth();

    const count = new Date(
      year, month + 1, 0
    ).getDate();

    const leading = (
      new Date(year, month, 1).getDay() + 6
    ) % 7;

    for (let i = 0; i < leading; i++) {
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
      const today = new Date();

      selectedDate = dateKey(today);

      viewedMonth = new Date(
        today.getFullYear(),
        today.getMonth(),
        1
      );

      renderDashboard();
    }
  );

  /* =====================================
     CARE TODAY
  ===================================== */

  function renderCare() {
    const today =
      selectedDate === dateKey(new Date());

    $("care-title").textContent = today
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
          "Nothing scheduled for this day. Your garden is all caught up!"
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

      const description =
        node("div", "care-description");

      description.append(
        node("strong", "", item.plantName),
        node(
          "small",
          "",
          item.type +
            (item.fromTracker
              ? " · My Plants"
              : "")
        )
      );

      row.append(time, description);

      const checkbox =
        node("input", "care-checkbox");

      checkbox.type = "checkbox";
      checkbox.checked = !!item.completed;

      checkbox.setAttribute(
        "aria-label",
        `Complete ${item.plantName} ${item.type}`
      );

      if (item.fromTracker) {
        checkbox.disabled = true;
        checkbox.title =
          "Water from My Plants to complete.";
      } else {
        checkbox.addEventListener(
          "change",
          async () => {
            const value = checkbox.checked;

            try {
              const updated = await request(
                "PATCH",
                `/api/reminders/${encodeURIComponent(item.id)}`,
                { completed: value }
              );

              Object.assign(item, updated);
              renderDashboard();

              success(
                value
                  ? "Care Complete!"
                  : "Reminder Reopened!",
                value
                  ? `${item.plantName} has been cared for.`
                  : `${item.plantName} is back on your list.`
              );
            } catch (err) {
              renderDashboard();
              error("Save Failed!", err.message);
            }
          }
        );
      }

      row.append(checkbox);

      if (!item.fromTracker) {
        const remove = node(
          "button",
          "care-delete",
          "×"
        );

        remove.type = "button";

        remove.addEventListener(
          "click",
          () => {
            deleteCareId = item.id;

            $("delete-care-text").textContent =
              `Remove ${item.plantName}'s ${item.type.toLowerCase()} reminder?`;

            $("delete-care-dialog").showModal();
          }
        );

        row.append(remove);
      }

      host.append(row);
    });
  }

  /* =====================================
     CREATE CARE REMINDER
  ===================================== */

  $("add-care-button").addEventListener(
    "click",
    () => {
      $("care-form").reset();
      $("care-date").value = selectedDate;
      $("care-time").value = "09:00";
      $("care-dialog").showModal();
    }
  );

  $("cancel-care-button").addEventListener(
    "click",
    () => $("care-dialog").close()
  );

  $("care-form").addEventListener(
    "submit",
    async event => {
      event.preventDefault();

      const name =
        $("care-plant-name").value.trim();

      const type = $("care-type").value;
      const date = $("care-date").value;
      const time = $("care-time").value;

      if (!name || !date || !time) {
        error(
          "Missing Details!",
          "Please complete the care reminder."
        );
        return;
      }

      try {
        const reminder = await request(
          "POST",
          "/api/reminders",
          {
            plantName: name,
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
          `${name}'s ${type.toLowerCase()} reminder is ready.`
        );
      } catch (err) {
        error("Reminder Not Saved!", err.message);
      }
    }
  );

  /* =====================================
     DELETE CARE REMINDER
  ===================================== */

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
          item => String(item.id) !==
            String(deleteCareId)
        );

        deleteCareId = null;

        $("delete-care-dialog").close();
        renderDashboard();

        success(
          "Reminder Deleted!",
          "Your care reminder has been removed."
        );
      } catch (err) {
        error("Delete Failed!", err.message);
      }
    }
  );

  /* =====================================
     NOTIFICATION BELL
  ===================================== */

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
      const entry =
        node("div", "notification-entry");

      const image = node("img");
      image.src =
        `images/notification-flower-${index % 3 + 1}.svg`;
      image.alt = "";

      const text = node(
        "span",
        "",
        `${item.plantName}: ${item.type} at ${formatTime(item.time)}`
      );

      entry.append(image, text);
      host.append(entry);
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

      if (!panel.hidden) {
        renderNotifications();
      }
    }
  );

  $("close-notifications").addEventListener(
    "click",
    () => {
      $("notification-panel").hidden = true;

      $("notification-toggle").setAttribute(
        "aria-expanded", "false"
      );
    }
  );

  /* =====================================
     RECENTLY VIEWED
  ===================================== */

  function renderRecent() {
    const host = $("recent-list");
    host.replaceChildren();

    const existing = recent.filter(
      item => plants.some(
        plant => String(plant.id) ===
          String(item.id)
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
        record => String(record.id) ===
          String(item.id)
      );

      const link =
        node("a", "recent-plant");

      link.href = "?page=tracker";

      link.append(
        node(
          "small",
          "",
          new Date(item.viewedAt).toLocaleString()
        ),
        node("h3", "", plant.name),
        node(
          "p",
          "",
          "View Plant Details →"
        )
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

  function renderDashboard() {
    $("welcome-title").textContent =
      `Welcome back, ${currentUsername()}!`;

    renderStats();
    renderCalendar();
    renderCare();
    renderRecent();
    renderNotifications();
  }

  /* =====================================
     SETTINGS
  ===================================== */

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

      const username =
        $("settings-username").value.trim();

      const email =
        $("settings-email").value
          .trim().toLowerCase();

      if (!username || !email) {
        error(
          "Invalid Information!",
          "Please complete your profile details."
        );
        return;
      }

      try {
        const result = await request(
          "PUT",
          "/api/me",
          { username, email }
        );

        account = result.user;

        success(
          "Profile Updated!",
          "Your account details have been saved."
        );
      } catch (err) {
        error("Update Failed!", err.message);
      }
    }
  );

  /* =====================================
     DELETE ACCOUNT
  ===================================== */

  $("delete-account").addEventListener(
    "click",
    () => {
      $("delete-account-dialog").showModal();
    }
  );

  $("cancel-delete-account").addEventListener(
    "click",
    () => {
      $("delete-account-dialog").close();
    }
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
          "Your saved information has been removed."
        );

        setTimeout(() => {
          go("login", true);
        }, 2000);

      } catch (err) {
        error("Delete Failed!", err.message);
      }
    }
  );

  /* =====================================
     REFRESH
  ===================================== */

  async function refresh() {
    if (!account) return;

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
      console.warn("Refresh failed:", err.message);
    }
  }

  setInterval(refresh, 60000);

  document.addEventListener(
    "visibilitychange",
    () => {
      if (!document.hidden && !busy) {
        refresh();
      }
    }
  );

  /* =====================================
     INITIAL PAGE
  ===================================== */

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
