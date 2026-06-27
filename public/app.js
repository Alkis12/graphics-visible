const app = document.getElementById("app");

const state = {
  user: null,
  clientData: null,
  adminState: null,
  activeAdminTab: "clients",
  activeClientTab: "",
  selectedAdminClientId: "",
  selectedAdminDashboardTabId: "",
  modal: null,
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
const DEFAULT_CLIENT_DESIGN = {
  brandText: "Odeon",
  logoDataUrl: "",
  colors: {
    background: "#000000",
    surface: "#111111",
    surfaceSoft: "#1c1c1c",
    surfaceStrong: "#252525",
    text: "#ffffff",
    mutedText: "#adadad",
    primary: "#e8cd7d",
    primaryStrong: "#eba611",
    primaryText: "#111111",
    border: "#343434",
    frameBackground: "#151515",
  },
};
const DESIGN_COLOR_FIELDS = [
  ["background", "Фон страницы"],
  ["surface", "Основные панели"],
  ["surfaceSoft", "Мягкие панели"],
  ["surfaceStrong", "Кнопки и активные зоны"],
  ["text", "Основной текст"],
  ["mutedText", "Вторичный текст"],
  ["primary", "Акцент"],
  ["primaryStrong", "Акцент при наведении"],
  ["primaryText", "Текст на акценте"],
  ["border", "Границы"],
  ["frameBackground", "Фон графиков"],
];

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

function mergeDesign(design = {}) {
  return {
    brandText: design.brandText || DEFAULT_CLIENT_DESIGN.brandText,
    logoDataUrl: design.logoDataUrl || "",
    colors: DESIGN_COLOR_FIELDS.reduce(
      (acc, [key]) => ({
        ...acc,
        [key]: design.colors?.[key] || DEFAULT_CLIENT_DESIGN.colors[key],
      }),
      {},
    ),
  };
}

function designStyle(design) {
  const colors = mergeDesign(design).colors;
  return [
    `--bg: ${colors.background}`,
    `--panel: ${colors.surface}`,
    `--panel-soft: ${colors.surfaceSoft}`,
    `--panel-strong: ${colors.surfaceStrong}`,
    `--text: ${colors.text}`,
    `--muted: ${colors.mutedText}`,
    `--muted-strong: ${colors.mutedText}`,
    `--gold: ${colors.primary}`,
    `--gold-strong: ${colors.primaryStrong}`,
    `--primary-text: ${colors.primaryText}`,
    `--line: ${colors.border}`,
    `--line-strong: ${colors.primary}`,
    `--input-bg: ${colors.surface}`,
    `--button-bg: ${colors.surfaceStrong}`,
    `--button-text: ${colors.text}`,
    `--frame-bg: ${colors.frameBackground}`,
  ].join("; ");
}

function renderBrandMark(design, fallbackText = "Odeon") {
  const normalized = mergeDesign(design);
  const brandText = normalized.brandText || fallbackText;

  if (normalized.logoDataUrl) {
    return `<img class="brand-logo" src="${escapeHtml(normalized.logoDataUrl)}" alt="${escapeHtml(brandText)}">`;
  }

  return `<div class="brand-word">${escapeHtml(brandText)}</div>`;
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
  const [year, month, day] = date.split("-");
  return `${day}.${month}.${year} (${weekday})`;
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

function designValues(form) {
  return {
    brandText: form.elements.brandText.value,
    logoDataUrl: form.elements.logoDataUrl.value,
    colors: DESIGN_COLOR_FIELDS.reduce((acc, [key]) => {
      acc[key] = form.elements[`colorText_${key}`].value || form.elements[`color_${key}`].value;
      return acc;
    }, {}),
  };
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
          <div class="brand-word">Planetra</div>
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
  const design = mergeDesign(state.clientData?.client?.design);
  const hasFilters = dashboards.some((dashboard) => dashboard.filtersEnabled);

  app.innerHTML = `
    <section class="client-shell" style="${escapeHtml(designStyle(design))}">
      <header class="topbar client-topbar">
        <div class="topbar-title">
          ${renderBrandMark(design, clientName)}
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
          <div class="brand-word">Planetra</div>
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
          <button class="tab ${state.activeAdminTab === "design" ? "is-active" : ""}" type="button" data-action="admin-tab" data-tab="design">Дизайн</button>
        </nav>
        ${noticeHtml()}
        ${state.activeAdminTab === "clients" ? renderClientsAdmin() : ""}
        ${state.activeAdminTab === "dashboards" ? renderDashboardsAdmin() : ""}
        ${state.activeAdminTab === "design" ? renderDesignAdmin() : ""}
      </section>
      ${renderAdminModal()}
    </section>
  `;
}

function renderClientsAdmin() {
  const clients = state.adminState?.clients || [];

  return `
    <section class="panel">
      <div class="panel-head">
        <h2>Клиенты</h2>
        <button class="button button-primary" type="button" data-action="open-create-client-modal">Создать клиента</button>
      </div>
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

function renderDesignAdmin() {
  const clients = adminClients();
  const client = selectedAdminClient();
  const design = mergeDesign(client?.design);

  return `
    <section class="panel">
      <div class="panel-head">
        <h2>Дизайн</h2>
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
            <form class="form-grid design-form" data-action="save-client-design" data-client-id="${escapeHtml(client.id)}">
              <input name="logoDataUrl" type="hidden" value="${escapeHtml(design.logoDataUrl)}">
              <div class="design-preview" style="${escapeHtml(designStyle(design))}">
                <div class="design-preview-top">
                  ${renderBrandMark(design, client.name)}
                  <strong>${escapeHtml(client.name)}</strong>
                </div>
                <div class="design-preview-body">
                  <span>Вкладка</span>
                  <button class="button button-primary" type="button">Кнопка</button>
                </div>
              </div>
              <div class="field">
                <label>Текст бренда без лого</label>
                <input name="brandText" value="${escapeHtml(design.brandText)}">
              </div>
              <div class="field">
                <label>Лого клиента</label>
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" data-action="logo-upload">
              </div>
              <div class="field">
                <label>Лого</label>
                <button class="button" type="button" data-action="clear-logo">Убрать лого</button>
              </div>
              <div class="design-colors">
                ${DESIGN_COLOR_FIELDS.map(([key, label]) => renderColorField(key, label, design.colors[key])).join("")}
              </div>
              <div class="modal-actions">
                <button class="button button-primary" type="submit">Сохранить дизайн</button>
              </div>
            </form>
          </section>
        `
        : '<section class="panel"><div class="empty-state compact">Сначала создайте клиента</div></section>'
    }
  `;
}

function renderColorField(key, label, value) {
  return `
    <div class="field color-field">
      <label>${escapeHtml(label)}</label>
      <div class="color-line">
        <input class="color-input" name="color_${escapeHtml(key)}" type="color" value="${escapeHtml(value)}">
        <input name="colorText_${escapeHtml(key)}" value="${escapeHtml(value)}" pattern="#[0-9a-fA-F]{6}">
      </div>
    </div>
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

  const tab = tabs.find((item) => item.id === state.selectedAdminDashboardTabId);
  if (!tab) {
    state.selectedAdminDashboardTabId = "";
    return null;
  }

  return tab;
}

function renderDashboardsAdmin() {
  const clients = adminClients();
  const client = selectedAdminClient();
  const tabs = client?.tabs || [];
  const activeTab = selectedAdminDashboardTab(client);

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
              <button class="button button-primary" type="button" data-action="open-create-dashboard-tab-modal" data-client-id="${escapeHtml(client.id)}">Добавить вкладку</button>
            </div>
            <div class="list">
              ${
                tabs.length
                  ? tabs.map((tab) => renderDashboardTabRow(tab, tab.id === activeTab?.id)).join("")
                  : '<div class="empty-state compact">Вкладок пока нет</div>'
              }
            </div>
          </section>
        `
        : '<section class="panel"><div class="empty-state compact">Сначала создайте клиента</div></section>'
    }
  `;
}

function renderDashboardTabRow(tab, isOpen) {
  const dashboards = tab.dashboards || [];

  return `
    <article class="dashboard-tab-item ${isOpen ? "is-open" : ""}">
      <button class="dashboard-tab-toggle" type="button" data-action="select-admin-dashboard-tab" data-tab-id="${escapeHtml(tab.id)}">
        <span>${escapeHtml(tab.title)}</span>
        <span class="muted">${escapeHtml(dashboards.length)} граф.</span>
      </button>
      <div class="dashboard-tab-body" ${isOpen ? "" : "hidden"}>
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
        <div class="dashboard-tab-content-head">
          <h3>Графики</h3>
          <button class="button button-primary button-small" type="button" data-action="open-create-dashboard-modal" data-tab-id="${escapeHtml(tab.id)}">Добавить график</button>
        </div>
        <div class="list">
          ${
            dashboards.length
              ? dashboards.map(renderDashboardRow).join("")
              : '<div class="empty-state compact">Графиков во вкладке пока нет</div>'
          }
        </div>
      </div>
    </article>
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

function renderAdminModal() {
  if (!state.modal) {
    return "";
  }

  if (state.modal.type === "createClient") {
    return `
      <div class="modal-backdrop" data-action="close-modal">
        <section class="modal-panel modal-panel-wide" role="dialog" aria-modal="true" aria-labelledby="create-client-title">
          <div class="modal-head">
            <h2 id="create-client-title">Создать клиента</h2>
            <button class="button button-small" type="button" data-action="close-modal">Закрыть</button>
          </div>
          <form class="form-grid" data-action="create-client">
            <div class="field">
              <label>Название</label>
              <input name="name" value="Odeon Show" required autofocus>
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
            <div class="modal-actions">
              <button class="button" type="button" data-action="close-modal">Отмена</button>
              <button class="button button-primary" type="submit">Создать клиента</button>
            </div>
          </form>
        </section>
      </div>
    `;
  }

  if (state.modal.type === "createTab") {
    const client = adminClients().find((item) => item.id === state.modal.clientId);
    if (!client) {
      return "";
    }

    return `
      <div class="modal-backdrop" data-action="close-modal">
        <section class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="create-tab-title">
          <div class="modal-head">
            <h2 id="create-tab-title">Добавить вкладку</h2>
            <button class="button button-small" type="button" data-action="close-modal">Закрыть</button>
          </div>
          <form class="form-grid" data-action="create-dashboard-tab">
            <input name="clientId" type="hidden" value="${escapeHtml(client.id)}">
            <div class="field">
              <label>Название вкладки</label>
              <input name="title" required autofocus>
            </div>
            <div class="field">
              <label>Порядок</label>
              <input name="sortOrder" type="number" value="100" inputmode="numeric">
            </div>
            <label class="checkbox-field">
              <input name="isActive" type="checkbox" checked>
              Активна
            </label>
            <div class="modal-actions">
              <button class="button" type="button" data-action="close-modal">Отмена</button>
              <button class="button button-primary" type="submit">Добавить вкладку</button>
            </div>
          </form>
        </section>
      </div>
    `;
  }

  if (state.modal.type === "createDashboard") {
    const tab = (selectedAdminClient()?.tabs || []).find((item) => item.id === state.modal.tabId);
    if (!tab) {
      return "";
    }

    return `
      <div class="modal-backdrop" data-action="close-modal">
        <section class="modal-panel modal-panel-wide" role="dialog" aria-modal="true" aria-labelledby="create-dashboard-title">
          <div class="modal-head">
            <h2 id="create-dashboard-title">Добавить график</h2>
            <button class="button button-small" type="button" data-action="close-modal">Закрыть</button>
          </div>
          <form class="form-grid" data-action="create-dashboard">
            <input name="tabId" type="hidden" value="${escapeHtml(tab.id)}">
            <div class="field">
              <label>Вкладка</label>
              <input value="${escapeHtml(tab.title)}" disabled>
            </div>
            <div class="field">
              <label>Порядок</label>
              <input name="sortOrder" type="number" value="100" inputmode="numeric">
            </div>
            <div class="field">
              <label>Название</label>
              <input name="title" required autofocus>
            </div>
            <div class="field">
              <label>Описание</label>
              <input name="description">
            </div>
            <div class="field field-wide">
              <label>Ссылка, id или iframe DataLens</label>
              <input name="url" required>
            </div>
            <label class="checkbox-field">
              <input name="isActive" type="checkbox" checked>
              Активен
            </label>
            <label class="checkbox-field">
              <input name="filtersEnabled" type="checkbox" checked>
              Фильтры
            </label>
            <div class="modal-actions">
              <button class="button" type="button" data-action="close-modal">Отмена</button>
              <button class="button button-primary" type="submit">Добавить график</button>
            </div>
          </form>
        </section>
      </div>
    `;
  }

  return "";
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
      state.modal = null;
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
      state.modal = null;
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
      state.modal = null;
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

    if (action === "save-client-design") {
      state.adminState = await api(`/api/admin/clients/${form.dataset.clientId}/design`, {
        method: "PATCH",
        body: JSON.stringify(designValues(form)),
      });
      setNotice("Дизайн сохранен");
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

  if (control.dataset.action === "logo-upload") {
    const file = control.files?.[0];
    if (!file) {
      return;
    }

    if (file.size > 900 * 1024) {
      setNotice("Лого должно быть до 900 КБ", "error");
      control.value = "";
      render();
      return;
    }

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const form = control.closest("form");
      const logoInput = form?.elements.logoDataUrl;
      const previewTop = form?.querySelector(".design-preview-top");
      if (!form || !logoInput || !previewTop) {
        return;
      }

      logoInput.value = reader.result;
      const currentLogo = previewTop.querySelector(".brand-logo, .brand-word");
      currentLogo?.remove();
      previewTop.insertAdjacentHTML(
        "afterbegin",
        `<img class="brand-logo" src="${escapeHtml(reader.result)}" alt="${escapeHtml(form.elements.brandText.value || "Logo")}">`,
      );
    });
    reader.readAsDataURL(file);
  }

  if (control.classList.contains("color-input")) {
    const textInput = control.closest(".color-line")?.querySelector('input[type="text"], input:not([type="color"])');
    if (textInput) {
      textInput.value = control.value;
    }
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
  if (action === "close-modal" && button.classList.contains("modal-backdrop") && event.target !== button) {
    return;
  }

  try {
    if (action === "close-modal") {
      state.modal = null;
      render();
      return;
    }

    if (action === "open-create-client-modal") {
      state.modal = {
        type: "createClient",
      };
      setNotice(null);
      render();
      return;
    }

    if (action === "open-create-dashboard-tab-modal") {
      state.modal = {
        type: "createTab",
        clientId: button.dataset.clientId,
      };
      setNotice(null);
      render();
      return;
    }

    if (action === "open-create-dashboard-modal") {
      state.modal = {
        type: "createDashboard",
        tabId: button.dataset.tabId,
      };
      state.selectedAdminDashboardTabId = button.dataset.tabId;
      setNotice(null);
      render();
      return;
    }

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
      state.selectedAdminDashboardTabId = state.selectedAdminDashboardTabId === button.dataset.tabId ? "" : button.dataset.tabId;
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

    if (action === "clear-logo") {
      const form = button.closest("form");
      const logoInput = form?.elements.logoDataUrl;
      const previewTop = form?.querySelector(".design-preview-top");
      if (form && logoInput && previewTop) {
        logoInput.value = "";
        form.querySelector('input[data-action="logo-upload"]').value = "";
        previewTop.querySelector(".brand-logo, .brand-word")?.remove();
        previewTop.insertAdjacentHTML("afterbegin", `<div class="brand-word">${escapeHtml(form.elements.brandText.value || "Odeon")}</div>`);
      }
      return;
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
