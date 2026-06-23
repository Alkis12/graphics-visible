const app = document.getElementById("app");

const state = {
  user: null,
  clientData: null,
  adminState: null,
  activeAdminTab: "clients",
  activeClientTab: "",
  selectedAdminClientId: "",
  selectedAdminDashboardTabId: "",
  filters: {
    category: "",
    eventValue: "",
  },
  notice: null,
};

const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
const FILTER_PARAMS = {
  category: "ticket_category_tdzf",
  event: "event_id_internal_9r0j",
};
const FILTER_CATEGORIES = [
  "",
  "VIP",
  "Балкон Общая",
  "Партер 1 Фланг",
  "Партер 1 Центр",
  "Партер 2 Общая",
  "Партер 3 Общая",
];
const FILTER_EVENTS = buildEventOptions("2026-05-28", "2026-07-31");

function buildEventOptions(startDate, endDate) {
  const options = [];
  const cursor = dateFromKey(startDate);
  const end = dateFromKey(endDate);

  while (cursor <= end) {
    const day = cursor.getDay();
    if (day !== 1) {
      const date = dateKey(cursor);
      const time = day === 0 ? "18:00:00" : "20:00:00";
      options.push(`${date} ${time}`);
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return options;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function checked(value) {
  return value ? "checked" : "";
}

function dateFromKey(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function dateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatEventLabel(value) {
  const date = value.slice(0, 10);
  const weekday = new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(dateFromKey(date));
  return `${date} (${weekday})`;
}

function formatTodayNote() {
  const today = new Date();
  const date = new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
  }).format(today);
  const weekday = new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(today).replace(".", "");
  return `сегодня ${date}, ${weekday}`;
}

function ensureDefaultFilters() {
  if (state.filters.eventValue) {
    return;
  }

  const today = dateKey(new Date());
  const todayEvent = FILTER_EVENTS.find((eventValue) => eventValue.startsWith(today));
  const nextEvent = FILTER_EVENTS.find((eventValue) => eventValue.slice(0, 10) >= today);
  state.filters.eventValue = todayEvent || nextEvent || FILTER_EVENTS[0] || "";
}

function buildDashboardUrl(dashboard) {
  const baseUrl = dashboard?.datalensId ? `https://datalens.yandex/${dashboard.datalensId}` : dashboard?.url;
  if (!baseUrl) {
    return "";
  }

  try {
    const url = new URL(baseUrl, window.location.origin);
    url.searchParams.set("_embedded", "1");
    url.searchParams.set("_no_controls", "1");
    url.searchParams.set("_theme", "dark");

    if (dashboard.filtersEnabled) {
      ensureDefaultFilters();
      url.searchParams.set(FILTER_PARAMS.event, state.filters.eventValue);
      url.searchParams.set(FILTER_PARAMS.category, state.filters.category);
    }

    return url.toString();
  } catch {
    return dashboard.url;
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    credentials: "same-origin",
    ...options,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Ошибка запроса");
  }

  return payload;
}

function setNotice(message, type = "success") {
  state.notice = message ? { message, type } : null;
}

function noticeHtml() {
  if (!state.notice) {
    return '<div class="notice"></div>';
  }

  const className = state.notice.type === "error" ? "notice-error" : "notice-success";
  return `<div class="notice ${className}">${escapeHtml(state.notice.message)}</div>`;
}

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function generatePassword(length = 18) {
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => PASSWORD_ALPHABET[value % PASSWORD_ALPHABET.length]).join("");
}

async function loadClientData() {
  state.clientData = await api("/api/dashboards");
}

async function loadAdminState() {
  state.adminState = await api("/api/admin/state");
}

async function boot() {
  try {
    const payload = await api("/api/me");
    state.user = payload.user;
    if (state.user?.role === "admin") {
      await loadAdminState();
    } else if (state.user?.role === "client") {
      await loadClientData();
    }
  } catch {
    state.user = null;
  }

  render();
}

function render() {
  if (!state.user) {
    renderLogin();
    return;
  }

  if (state.user.role === "admin") {
    renderAdmin();
    return;
  }

  renderClient();
}

function renderLogin() {
  app.innerHTML = `
    <section class="login-view">
      <form class="login-panel" data-action="login">
        <div class="login-title">
          <div class="brand-word">Odeon</div>
          <h1>Dashboards</h1>
        </div>
        <div class="form">
          <div class="field">
            <label for="login-username">Логин</label>
            <input id="login-username" name="username" autocomplete="username" autocapitalize="none" required>
          </div>
          <div class="field">
            <label for="login-password">Пароль</label>
            <input id="login-password" name="password" type="password" autocomplete="current-password" required>
          </div>
          ${noticeHtml()}
          <button class="button button-primary" type="submit">Войти</button>
        </div>
      </form>
    </section>
  `;
}

function clientDashboardTabs() {
  return state.clientData?.tabs || [];
}

function activeDashboardTab() {
  const tabs = clientDashboardTabs();
  if (!tabs.length) {
    state.activeClientTab = "";
    return null;
  }

  const activeTab = tabs.find((tab) => tab.id === state.activeClientTab) || tabs[0];
  state.activeClientTab = activeTab.id;
  return activeTab;
}

function renderClient() {
  const tabs = clientDashboardTabs();
  const activeTab = activeDashboardTab();
  const dashboards = activeTab?.dashboards || [];
  const clientName = state.clientData?.client?.name || state.user.clientName || "Client";
  const hasFilters = dashboards.some((dashboard) => dashboard.filtersEnabled);

  app.innerHTML = `
    <section class="client-shell">
      <header class="topbar client-topbar">
        <div class="topbar-title">
          <div class="brand-word">Odeon</div>
          <h1>${escapeHtml(clientName)}</h1>
        </div>
        ${hasFilters ? renderClientFilters() : '<div></div>'}
        <div class="topbar-actions">
          <button class="button" type="button" data-action="logout">Выйти</button>
          <div class="topbar-meta">${escapeHtml(state.user.username)}</div>
        </div>
      </header>
      <div class="dashboard-workspace ${hasFilters ? "has-filters" : ""}">
        <nav class="tabs client-view-tabs" aria-label="Представления дашбордов">
          ${tabs
            .map(
              (tab) => `
                <button class="tab ${state.activeClientTab === tab.id ? "is-active" : ""}" type="button" data-action="client-tab" data-tab="${escapeHtml(tab.id)}">
                  ${escapeHtml(tab.title)}
                </button>
              `,
            )
            .join("")}
        </nav>
        ${
          dashboards.length
            ? `<section class="dashboard-stack" aria-label="Дашборды">
                ${renderClientDashboards(dashboards)}
              </section>`
            : '<section class="empty-state">Дашборды не настроены</section>'
        }
      </div>
    </section>
  `;
}

function renderClientDashboards(dashboards) {
  return dashboards
    .map((dashboard, index) => `${renderClientDashboard(dashboard)}${index === 1 ? '<div class="dashboard-row-divider"></div>' : ""}`)
    .join("");
}

function renderClientFilters() {
  ensureDefaultFilters();

  return `
    <section class="client-filters" aria-label="Фильтры дашборда">
      <div class="field">
        <label for="client-event-filter">Дата события</label>
        <select id="client-event-filter" data-action="filter-event">
          ${FILTER_EVENTS.map(
            (eventValue) => `<option value="${escapeHtml(eventValue)}" ${eventValue === state.filters.eventValue ? "selected" : ""}>${escapeHtml(formatEventLabel(eventValue))}</option>`,
          ).join("")}
        </select>
        <div class="field-note">${escapeHtml(formatTodayNote())}</div>
      </div>
      <div class="field">
        <label for="client-category-filter">Категория билета</label>
        <select id="client-category-filter" data-action="filter-category">
          ${FILTER_CATEGORIES.map(
            (category) => `<option value="${escapeHtml(category)}" ${category === state.filters.category ? "selected" : ""}>${escapeHtml(category || "Все")}</option>`,
          ).join("")}
        </select>
      </div>
    </section>
  `;
}

function renderClientDashboard(dashboard) {
  const dashboardUrl = buildDashboardUrl(dashboard);

  return `
    <section class="dashboard-panel">
      <div class="dashboard-panel-head">
        <h2>${escapeHtml(dashboard.title)}</h2>
        ${
          dashboardUrl
            ? `<a class="link-button" href="${escapeHtml(dashboardUrl)}" target="_blank" rel="noopener">Открыть</a>`
            : ""
        }
      </div>
      <section class="dashboard-frame-wrap">
        <iframe class="dashboard-frame" title="${escapeHtml(dashboard.title)}" src="${escapeHtml(dashboardUrl)}" allowfullscreen></iframe>
      </section>
    </section>
  `;
}

function shiftEventFilter(step) {
  ensureDefaultFilters();

  const currentIndex = FILTER_EVENTS.indexOf(state.filters.eventValue);
  if (currentIndex < 0) {
    state.filters.eventValue = FILTER_EVENTS[0] || "";
    render();
    return;
  }

  const nextIndex = Math.min(Math.max(currentIndex + step, 0), FILTER_EVENTS.length - 1);
  if (nextIndex === currentIndex) {
    return;
  }

  state.filters.eventValue = FILTER_EVENTS[nextIndex];
  render();
}

function renderAdmin() {
  app.innerHTML = `
    <section class="admin-shell">
      <header class="topbar">
        <div class="topbar-title">
          <div class="brand-word">Odeon</div>
          <h1>Админ-панель</h1>
          <div class="topbar-meta">${escapeHtml(state.user.username)}</div>
        </div>
        <div class="topbar-actions">
          <button class="button" type="button" data-action="refresh-admin">Обновить</button>
          <button class="button" type="button" data-action="logout">Выйти</button>
        </div>
      </header>
      <section class="admin-workspace">
        <nav class="admin-nav" aria-label="Разделы админ-панели">
          <button class="tab ${state.activeAdminTab === "clients" ? "is-active" : ""}" type="button" data-action="admin-tab" data-tab="clients">Клиенты</button>
          <button class="tab ${state.activeAdminTab === "dashboards" ? "is-active" : ""}" type="button" data-action="admin-tab" data-tab="dashboards">Дашборды</button>
        </nav>
        ${noticeHtml()}
        ${state.activeAdminTab === "clients" ? renderClientsAdmin() : renderDashboardsAdmin()}
      </section>
    </section>
  `;
}

function renderClientsAdmin() {
  const clients = state.adminState?.clients || [];

  return `
    <section class="panel">
      <div class="panel-head">
        <h2>Клиенты</h2>
      </div>
      <form class="form-grid" data-action="create-client">
        <div class="field">
          <label>Название</label>
          <input name="name" value="Odeon Show" required>
        </div>
        <div class="field">
          <label>Slug</label>
          <input name="slug" value="odeon-show" autocapitalize="none" required>
        </div>
        <div class="field">
          <label>Логин</label>
          <input name="username" autocapitalize="none" required>
        </div>
        <div class="field">
          <label>Пароль</label>
          <div class="password-line">
            <input id="new-client-password" name="password" autocomplete="new-password" required>
            <button class="button button-small" type="button" data-action="generate-password" data-target="new-client-password">Сгенерировать</button>
          </div>
        </div>
        <div class="field field-wide">
          <button class="button button-primary" type="submit">Создать клиента</button>
        </div>
      </form>
    </section>
    <section class="panel">
      <div class="list">
        ${
          clients.length
            ? clients.map(renderClientRow).join("")
            : '<div class="empty-state">Клиентов пока нет</div>'
        }
      </div>
    </section>
  `;
}

function renderClientRow(client) {
  return `
    <form class="row-form row-grid client-row-grid" data-action="save-client" data-client-id="${escapeHtml(client.id)}">
      <div class="field">
        <label>Название</label>
        <input name="name" value="${escapeHtml(client.name)}" required>
      </div>
      <div class="field">
        <label>Slug</label>
        <input name="slug" value="${escapeHtml(client.slug)}" autocapitalize="none" required>
      </div>
      <div class="field">
        <label>Логин</label>
        <input name="username" value="${escapeHtml(client.user?.username || "")}" autocapitalize="none" required>
      </div>
      <div class="field">
        <label>Новый пароль</label>
        <input name="password" autocomplete="new-password" placeholder="Без изменений">
      </div>
      <label class="checkbox-field">
        <input name="isActive" type="checkbox" ${checked(client.isActive && client.user?.isActive !== false)}>
        Активен
      </label>
      <div class="row-actions">
        <button class="button button-small" type="submit">Сохранить</button>
        <button class="button button-small button-danger" type="button" data-action="delete-client" data-client-id="${escapeHtml(client.id)}">Удалить</button>
      </div>
    </form>
  `;
}

function adminClients() {
  return state.adminState?.clients || [];
}

function selectedAdminClient() {
  const clients = adminClients();
  if (!clients.length) {
    state.selectedAdminClientId = "";
    state.selectedAdminDashboardTabId = "";
    return null;
  }

  const client = clients.find((item) => item.id === state.selectedAdminClientId) || clients[0];
  state.selectedAdminClientId = client.id;
  return client;
}

function selectedAdminDashboardTab(client) {
  const tabs = client?.tabs || [];
  if (!tabs.length) {
    state.selectedAdminDashboardTabId = "";
    return null;
  }

  const tab = tabs.find((item) => item.id === state.selectedAdminDashboardTabId) || tabs[0];
  state.selectedAdminDashboardTabId = tab.id;
  return tab;
}

function renderDashboardsAdmin() {
  const clients = adminClients();
  const client = selectedAdminClient();
  const tabs = client?.tabs || [];
  const activeTab = selectedAdminDashboardTab(client);
  const dashboards = activeTab?.dashboards || [];

  return `
    <section class="panel">
      <div class="panel-head">
        <h2>Дашборды</h2>
      </div>
      <div class="admin-client-picker">
        <div class="field">
          <label>Клиент</label>
          <select data-action="select-admin-client">
            ${clients
              .map(
                (item) => `<option value="${escapeHtml(item.id)}" ${item.id === client?.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`,
              )
              .join("")}
          </select>
        </div>
      </div>
    </section>
    ${
      client
        ? `
          <section class="panel">
            <div class="panel-head">
              <h2>Вкладки: ${escapeHtml(client.name)}</h2>
            </div>
            <form class="form-grid" data-action="create-dashboard-tab">
              <input name="clientId" type="hidden" value="${escapeHtml(client.id)}">
              <div class="field">
                <label>Название вкладки</label>
                <input name="title" required>
              </div>
              <div class="field">
                <label>Порядок</label>
                <input name="sortOrder" type="number" value="100" inputmode="numeric">
              </div>
              <label class="checkbox-field">
                <input name="isActive" type="checkbox" checked>
                Активна
              </label>
              <div class="field">
                <button class="button button-primary" type="submit">Добавить вкладку</button>
              </div>
            </form>
            <div class="tabs admin-dashboard-tabs" aria-label="Вкладки клиента">
              ${
                tabs.length
                  ? tabs
                      .map(
                        (tab) => `
                          <button class="tab ${tab.id === activeTab?.id ? "is-active" : ""}" type="button" data-action="select-admin-dashboard-tab" data-tab-id="${escapeHtml(tab.id)}">
                            ${escapeHtml(tab.title)}
                          </button>
                        `,
                      )
                      .join("")
                  : '<div class="empty-state compact">Вкладок пока нет</div>'
              }
            </div>
            <div class="list">
              ${tabs.map(renderDashboardTabRow).join("")}
            </div>
          </section>
        `
        : '<section class="panel"><div class="empty-state compact">Сначала создайте клиента</div></section>'
    }
    ${
      activeTab
        ? `
          <section class="panel">
            <div class="panel-head">
              <h2>Графики: ${escapeHtml(activeTab.title)}</h2>
            </div>
            <form class="form-grid" data-action="create-dashboard">
              <input name="tabId" type="hidden" value="${escapeHtml(activeTab.id)}">
              <div class="field">
                <label>Название</label>
                <input name="title" required>
              </div>
              <div class="field">
                <label>Порядок</label>
                <input name="sortOrder" type="number" value="100" inputmode="numeric">
              </div>
              <div class="field field-wide">
                <label>Ссылка, id или iframe DataLens</label>
                <input name="url" required>
              </div>
              <div class="field">
                <label>Описание</label>
                <input name="description">
              </div>
              <label class="checkbox-field">
                <input name="isActive" type="checkbox" checked>
                Активен
              </label>
              <label class="checkbox-field">
                <input name="filtersEnabled" type="checkbox" checked>
                Фильтры
              </label>
              <div class="field">
                <button class="button button-primary" type="submit">Добавить график</button>
              </div>
            </form>
          </section>
          <section class="panel">
            <div class="list">
              ${
                dashboards.length
                  ? dashboards.map(renderDashboardRow).join("")
                  : '<div class="empty-state">Графиков во вкладке пока нет</div>'
              }
            </div>
          </section>
        `
        : ""
    }
  `;
}

function renderDashboardTabRow(tab) {
  return `
    <form class="row-form row-grid dashboard-tab-row-grid" data-action="save-dashboard-tab" data-tab-id="${escapeHtml(tab.id)}">
      <div class="field">
        <label>Название</label>
        <input name="title" value="${escapeHtml(tab.title)}" required>
      </div>
      <div class="field">
        <label>Порядок</label>
        <input name="sortOrder" type="number" value="${escapeHtml(tab.sortOrder)}" inputmode="numeric">
      </div>
      <label class="checkbox-field">
        <input name="isActive" type="checkbox" ${checked(tab.isActive)}>
        Активна
      </label>
      <div class="row-actions">
        <button class="button button-small" type="submit">Сохранить</button>
        <button class="button button-small button-danger" type="button" data-action="delete-dashboard-tab" data-tab-id="${escapeHtml(tab.id)}">Удалить</button>
      </div>
    </form>
  `;
}

function renderDashboardRow(dashboard) {
  return `
    <form class="dashboard-row row-grid dashboard-row-grid" data-action="save-dashboard" data-dashboard-id="${escapeHtml(dashboard.id)}">
      <input name="tabId" type="hidden" value="${escapeHtml(dashboard.tabId)}">
      <div class="field">
        <label>Название</label>
        <input name="title" value="${escapeHtml(dashboard.title)}" required>
      </div>
      <div class="field">
        <label>Ссылка, id или iframe DataLens</label>
        <input name="url" value="${escapeHtml(dashboard.datalensId || dashboard.url)}" required>
      </div>
      <div class="field">
        <label>Порядок</label>
        <input name="sortOrder" type="number" value="${escapeHtml(dashboard.sortOrder)}" inputmode="numeric">
      </div>
      <label class="checkbox-field">
        <input name="isActive" type="checkbox" ${checked(dashboard.isActive)}>
        Активен
      </label>
      <label class="checkbox-field">
        <input name="filtersEnabled" type="checkbox" ${checked(dashboard.filtersEnabled)}>
        Фильтры
      </label>
      <div class="row-actions">
        <button class="button button-small" type="submit">Сохранить</button>
        <button class="button button-small button-danger" type="button" data-action="delete-dashboard" data-dashboard-id="${escapeHtml(dashboard.id)}">Удалить</button>
      </div>
    </form>
  `;
}

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("form[data-action]");
  if (!form) {
    return;
  }

  event.preventDefault();
  const action = form.dataset.action;

  try {
    if (action === "login") {
      const payload = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(formValues(form)),
      });
      state.user = payload.user;
      setNotice(null);
      if (state.user.role === "admin") {
        await loadAdminState();
      } else {
        await loadClientData();
      }
      render();
    }

    if (action === "create-client") {
      const values = formValues(form);
      state.adminState = await api("/api/admin/clients", {
        method: "POST",
        body: JSON.stringify(values),
      });
      setNotice("Клиент создан");
      render();
    }

    if (action === "save-client") {
      const values = formValues(form);
      if (!values.password) {
        delete values.password;
      }
      values.isActive = form.elements.isActive.checked;
      state.adminState = await api(`/api/admin/clients/${form.dataset.clientId}`, {
        method: "PATCH",
        body: JSON.stringify(values),
      });
      setNotice("Клиент сохранен");
      render();
    }

    if (action === "create-dashboard-tab") {
      const values = formValues(form);
      values.isActive = form.elements.isActive.checked;
      state.adminState = await api("/api/admin/dashboard-tabs", {
        method: "POST",
        body: JSON.stringify(values),
      });
      state.selectedAdminDashboardTabId = "";
      setNotice("Вкладка добавлена");
      render();
    }

    if (action === "save-dashboard-tab") {
      const values = formValues(form);
      values.isActive = form.elements.isActive.checked;
      state.adminState = await api(`/api/admin/dashboard-tabs/${form.dataset.tabId}`, {
        method: "PATCH",
        body: JSON.stringify(values),
      });
      setNotice("Вкладка сохранена");
      render();
    }

    if (action === "create-dashboard") {
      const values = formValues(form);
      values.isActive = form.elements.isActive.checked;
      values.filtersEnabled = form.elements.filtersEnabled.checked;
      state.adminState = await api("/api/admin/dashboards", {
        method: "POST",
        body: JSON.stringify(values),
      });
      setNotice("Дашборд добавлен");
      render();
    }

    if (action === "save-dashboard") {
      const values = formValues(form);
      values.isActive = form.elements.isActive.checked;
      values.filtersEnabled = form.elements.filtersEnabled.checked;
      state.adminState = await api(`/api/admin/dashboards/${form.dataset.dashboardId}`, {
        method: "PATCH",
        body: JSON.stringify(values),
      });
      setNotice("Дашборд сохранен");
      render();
    }

  } catch (error) {
    setNotice(error.message, "error");
    render();
  }
});

document.addEventListener("change", (event) => {
  const control = event.target.closest("[data-action]");
  if (!control) {
    return;
  }

  if (control.dataset.action === "filter-event") {
    state.filters.eventValue = control.value;
    render();
  }

  if (control.dataset.action === "filter-category") {
    state.filters.category = control.value;
    render();
  }

  if (control.dataset.action === "select-admin-client") {
    state.selectedAdminClientId = control.value;
    state.selectedAdminDashboardTabId = "";
    setNotice(null);
    render();
  }
});

document.addEventListener("keydown", (event) => {
  const activeTab = state.user?.role === "client" ? clientDashboardTabs().find((tab) => tab.id === state.activeClientTab) : null;
  if (
    state.user?.role !== "client" ||
    !activeTab?.dashboards?.some((dashboard) => dashboard.filtersEnabled) ||
    !["ArrowLeft", "ArrowRight"].includes(event.key)
  ) {
    return;
  }

  const activeElement = document.activeElement;
  if (activeElement && ["INPUT", "SELECT", "TEXTAREA"].includes(activeElement.tagName)) {
    return;
  }

  event.preventDefault();
  shiftEventFilter(event.key === "ArrowRight" ? 1 : -1);
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) {
    return;
  }

  const action = button.dataset.action;

  try {
    if (action === "logout") {
      await api("/api/auth/logout", { method: "POST" });
      state.user = null;
      state.clientData = null;
      state.adminState = null;
      setNotice(null);
      render();
    }

    if (action === "admin-tab") {
      state.activeAdminTab = button.dataset.tab;
      setNotice(null);
      render();
    }

    if (action === "client-tab") {
      state.activeClientTab = button.dataset.tab;
      setNotice(null);
      render();
    }

    if (action === "select-admin-dashboard-tab") {
      state.selectedAdminDashboardTabId = button.dataset.tabId;
      setNotice(null);
      render();
    }

    if (action === "refresh-admin") {
      await loadAdminState();
      setNotice("Данные обновлены");
      render();
    }

    if (action === "generate-password") {
      const input = document.getElementById(button.dataset.target);
      if (input) {
        input.value = generatePassword();
        input.focus();
      }
    }

    if (action === "delete-client") {
      if (!confirm("Удалить клиента, его доступ и дашборды?")) {
        return;
      }
      state.adminState = await api(`/api/admin/clients/${button.dataset.clientId}`, { method: "DELETE" });
      if (state.selectedAdminClientId === button.dataset.clientId) {
        state.selectedAdminClientId = "";
        state.selectedAdminDashboardTabId = "";
      }
      setNotice("Клиент удален");
      render();
    }

    if (action === "delete-dashboard-tab") {
      if (!confirm("Удалить вкладку и все графики внутри нее?")) {
        return;
      }
      state.adminState = await api(`/api/admin/dashboard-tabs/${button.dataset.tabId}`, { method: "DELETE" });
      if (state.selectedAdminDashboardTabId === button.dataset.tabId) {
        state.selectedAdminDashboardTabId = "";
      }
      setNotice("Вкладка удалена");
      render();
    }

    if (action === "delete-dashboard") {
      if (!confirm("Удалить дашборд?")) {
        return;
      }
      state.adminState = await api(`/api/admin/dashboards/${button.dataset.dashboardId}`, { method: "DELETE" });
      setNotice("Дашборд удален");
      render();
    }

  } catch (error) {
    setNotice(error.message, "error");
    render();
  }
});

boot();
