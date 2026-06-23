const app = document.getElementById("app");

const state = {
  user: null,
  clientData: null,
  adminState: null,
  etlState: null,
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
const ETL_STAGES = [
  "",
  "Подключение к источнику",
  "Чтение данных",
  "Трансформация",
  "Запись в БД SCDO",
];
const ETL_HANDLERS = {
  google_data: "Workbook Google Sheets",
  marketing_statistics: "Маркетинговая статистика",
};

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

function formatDateTime(value) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(value));
}

function etlStatusLabel(status) {
  return (
    {
      queued: "В очереди",
      running: "Выполняется",
      success: "Успешно",
      error: "Ошибка",
    }[status] || status
  );
}

function etlStatusClass(status) {
  return status === "success" ? "status-success" : status === "error" ? "status-error" : "status-progress";
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

async function loadEtlState() {
  state.etlState = await api("/api/etl/state");
}

async function boot() {
  try {
    const payload = await api("/api/me");
    state.user = payload.user;
    if (state.user?.role === "admin") {
      await Promise.all([loadAdminState(), loadEtlState()]);
    } else if (state.user?.role === "client") {
      await Promise.all([loadClientData(), loadEtlState()]);
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
  const activeTab = state.activeClientTab === "dataLoad" ? null : activeDashboardTab();
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
          <button class="tab ${state.activeClientTab === "dataLoad" ? "is-active" : ""}" type="button" data-action="client-tab" data-tab="dataLoad">Загрузка данных</button>
        </nav>
        ${
          state.activeClientTab === "dataLoad"
            ? renderClientEtl()
            : dashboards.length
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

function renderClientEtl() {
  const scripts = state.etlState?.scripts || [];
  const runs = state.etlState?.runs || [];

  return `
    <section class="etl-workspace">
      <section class="panel">
        <div class="panel-head">
          <h2>Загрузки</h2>
          <button class="button button-small" type="button" data-action="refresh-etl">Обновить</button>
        </div>
        <div class="etl-script-grid">
          ${
            scripts.length
              ? scripts.map(renderClientEtlScript).join("")
              : '<div class="empty-state compact">Загрузки пока не настроены</div>'
          }
        </div>
      </section>
      ${renderEtlRuns(runs)}
    </section>
  `;
}

function renderClientEtlScript(script) {
  return `
    <article class="etl-script-card">
      <div class="etl-script-title">
        <h3>${escapeHtml(script.name)}</h3>
        <span class="muted">${escapeHtml(script.sourceType === "file" ? "Файл" : "Google Sheets")}</span>
      </div>
      <dl class="etl-meta">
        <div><dt>Скрипт</dt><dd>${escapeHtml(ETL_HANDLERS[script.handler] || script.handler || "—")}</dd></div>
        <div><dt>ID таблицы</dt><dd>${escapeHtml(script.spreadsheetId || "—")}</dd></div>
        <div><dt>Диапазон</dt><dd>${escapeHtml(script.sheetRange || "—")}</dd></div>
        <div><dt>Цель</dt><dd>${escapeHtml(`${script.targetSchema || "sdco"}.${script.targetTable || "по умолчанию"}`)}</dd></div>
      </dl>
      <div class="row-actions">
        <button class="button button-primary" type="button" data-action="run-etl" data-script-id="${escapeHtml(script.id)}">Запустить перелив</button>
      </div>
    </article>
  `;
}

function renderEtlRuns(runs) {
  return `
    <section class="panel">
      <div class="panel-head">
        <h2>Журнал запусков</h2>
      </div>
      <div class="etl-run-list">
        ${
          runs.length
            ? runs.map(renderEtlRun).join("")
            : '<div class="empty-state compact">Запусков пока нет</div>'
        }
      </div>
    </section>
  `;
}

function renderEtlRun(run) {
  return `
    <article class="etl-run-row">
      <div class="etl-run-main">
        <div>
          <h3>${escapeHtml(run.scriptName)}</h3>
          <div class="muted">${escapeHtml(formatDateTime(run.createdAt))} · ${escapeHtml(run.startedBy?.username || "—")}</div>
        </div>
        <span class="status-pill ${etlStatusClass(run.status)}">${escapeHtml(etlStatusLabel(run.status))}</span>
      </div>
      <dl class="etl-meta">
        <div><dt>Источник</dt><dd>${escapeHtml(run.sourceName || run.sourceType || "—")}</dd></div>
        <div><dt>Строк прочитано</dt><dd>${escapeHtml(run.rowsRead)}</dd></div>
      </dl>
      ${renderEtlStages(run.stages || [])}
      ${run.error ? renderEtlError(run.error) : ""}
    </article>
  `;
}

function renderEtlStages(stages) {
  if (!stages.length) {
    return '<div class="muted">Ожидает запуска фоновой задачи</div>';
  }

  return `
    <ol class="etl-stage-list">
      ${stages
        .map(
          (stage) => `
            <li>
              <span class="status-dot ${etlStatusClass(stage.status)}"></span>
              <div>
                <strong>${escapeHtml(stage.name)}</strong>
                <span>${escapeHtml(stage.detail || stage.error?.message || "")}</span>
              </div>
            </li>
          `,
        )
        .join("")}
    </ol>
  `;
}

function renderEtlError(error) {
  return `
    <div class="etl-error">
      Ошибка: этап "${escapeHtml(error.stage || "—")}", элемент "${escapeHtml(error.element || "—")}".
      ${escapeHtml(error.message || "")}
    </div>
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
          <button class="tab ${state.activeAdminTab === "etl" ? "is-active" : ""}" type="button" data-action="admin-tab" data-tab="etl">Загрузки</button>
        </nav>
        ${noticeHtml()}
        ${
          state.activeAdminTab === "clients"
            ? renderClientsAdmin()
            : state.activeAdminTab === "dashboards"
            ? renderDashboardsAdmin()
            : renderEtlAdmin()
        }
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

function renderEtlAdmin() {
  const clients = state.etlState?.clients || state.adminState?.clients || [];
  const scripts = state.etlState?.scripts || [];
  const runs = state.etlState?.runs || [];

  return `
    <section class="panel">
      <div class="panel-head">
        <h2>Настройка загрузки</h2>
        <button class="button button-small" type="button" data-action="refresh-etl">Обновить журнал</button>
      </div>
      <form class="form-grid" data-action="create-etl-script">
        <div class="field">
          <label>Клиент</label>
          <select name="clientId" required>
            ${clients.map((client) => `<option value="${escapeHtml(client.id)}">${escapeHtml(client.name)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Название</label>
          <input name="name" required>
        </div>
        <div class="field">
          <label>Ключ</label>
          <input name="key" autocapitalize="none" placeholder="sales-import">
        </div>
        <div class="field">
          <label>Скрипт</label>
          <select name="handler">
            <option value="google_data">Workbook Google Sheets</option>
            <option value="marketing_statistics">Маркетинговая статистика</option>
          </select>
        </div>
        <div class="field">
          <label>Тип источника</label>
          <select name="sourceType">
            <option value="googleSheets">Google Sheets</option>
            <option value="file">Файл</option>
          </select>
        </div>
        <div class="field field-wide">
          <label>URL источника</label>
          <input name="sourceUrl" placeholder="https://docs.google.com/spreadsheets/d/.../edit#gid=...">
        </div>
        <div class="field">
          <label>ID Google Sheets</label>
          <input name="spreadsheetId">
        </div>
        <div class="field">
          <label>Лист / диапазон</label>
          <input name="sheetRange" placeholder="Client или Лист1!A:Z">
        </div>
        <div class="field">
          <label>Схема БД</label>
          <input name="targetSchema" value="sdco">
        </div>
        <div class="field">
          <label>Таблица БД</label>
          <input name="targetTable" placeholder="Marketing_Statistics">
        </div>
        <div class="field">
          <label>Режим</label>
          <select name="loadMode">
            <option value="replace">replace</option>
            <option value="delete-insert">delete-insert</option>
            <option value="append">append</option>
          </select>
        </div>
        <div class="field">
          <label>Ожидаемо строк</label>
          <input name="expectedRows" type="number" min="0" inputmode="numeric">
        </div>
        <div class="field">
          <label>Порядок</label>
          <input name="sortOrder" type="number" value="100" inputmode="numeric">
        </div>
        <div class="field">
          <label>Тестовая ошибка</label>
          <select name="mockFailureStage">
            ${ETL_STAGES.map((stage) => `<option value="${escapeHtml(stage)}">${escapeHtml(stage || "Нет")}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Элемент ошибки</label>
          <input name="mockFailureElement" placeholder="строка 42, колонка email">
        </div>
        <label class="checkbox-field">
          <input name="isActive" type="checkbox" checked>
          Активна
        </label>
        <div class="field">
          <button class="button button-primary" type="submit">Добавить загрузку</button>
        </div>
      </form>
    </section>
    <section class="panel">
      <div class="panel-head">
        <h2>Загрузки клиентов</h2>
      </div>
      <div class="list">
        ${
          scripts.length
            ? scripts.map((script) => renderEtlScriptRow(script, clients)).join("")
            : '<div class="empty-state compact">Загрузки пока не настроены</div>'
        }
      </div>
    </section>
    ${renderEtlRuns(runs)}
  `;
}

function renderEtlScriptRow(script, clients) {
  return `
    <form class="etl-row row-grid etl-row-grid" data-action="save-etl-script" data-script-id="${escapeHtml(script.id)}">
      <div class="field">
        <label>Клиент</label>
        <select name="clientId" required>
          ${clients
            .map(
              (client) =>
                `<option value="${escapeHtml(client.id)}" ${client.id === script.clientId ? "selected" : ""}>${escapeHtml(client.name)}</option>`,
            )
            .join("")}
        </select>
      </div>
      <div class="field">
        <label>Название</label>
        <input name="name" value="${escapeHtml(script.name)}" required>
      </div>
      <div class="field">
        <label>Ключ</label>
        <input name="key" value="${escapeHtml(script.key)}" autocapitalize="none" required>
      </div>
      <div class="field">
        <label>Скрипт</label>
        <select name="handler">
          ${Object.entries(ETL_HANDLERS)
            .map(
              ([key, label]) => `<option value="${escapeHtml(key)}" ${key === script.handler ? "selected" : ""}>${escapeHtml(label)}</option>`,
            )
            .join("")}
        </select>
      </div>
      <div class="field">
        <label>URL</label>
        <input name="sourceUrl" value="${escapeHtml(script.sourceUrl)}">
      </div>
      <div class="field">
        <label>ID таблицы</label>
        <input name="spreadsheetId" value="${escapeHtml(script.spreadsheetId)}">
      </div>
      <div class="field">
        <label>Лист</label>
        <input name="sheetRange" value="${escapeHtml(script.sheetRange)}">
      </div>
      <div class="field">
        <label>Схема</label>
        <input name="targetSchema" value="${escapeHtml(script.targetSchema)}">
      </div>
      <div class="field">
        <label>Таблица</label>
        <input name="targetTable" value="${escapeHtml(script.targetTable)}">
      </div>
      <div class="field">
        <label>Режим</label>
        <select name="loadMode">
          <option value="replace" ${script.loadMode === "replace" ? "selected" : ""}>replace</option>
          <option value="delete-insert" ${script.loadMode === "delete-insert" ? "selected" : ""}>delete-insert</option>
          <option value="append" ${script.loadMode === "append" ? "selected" : ""}>append</option>
        </select>
      </div>
      <div class="field">
        <label>Тип</label>
        <select name="sourceType">
          <option value="googleSheets" ${script.sourceType === "googleSheets" ? "selected" : ""}>Google Sheets</option>
          <option value="file" ${script.sourceType === "file" ? "selected" : ""}>Файл</option>
        </select>
      </div>
      <div class="field">
        <label>Строк</label>
        <input name="expectedRows" type="number" min="0" value="${escapeHtml(script.expectedRows)}" inputmode="numeric">
      </div>
      <div class="field">
        <label>Ошибка</label>
        <select name="mockFailureStage">
          ${ETL_STAGES.map(
            (stage) => `<option value="${escapeHtml(stage)}" ${stage === script.mockFailureStage ? "selected" : ""}>${escapeHtml(stage || "Нет")}</option>`,
          ).join("")}
        </select>
      </div>
      <div class="field">
        <label>Элемент</label>
        <input name="mockFailureElement" value="${escapeHtml(script.mockFailureElement)}">
      </div>
      <div class="field">
        <label>Порядок</label>
        <input name="sortOrder" type="number" value="${escapeHtml(script.sortOrder)}" inputmode="numeric">
      </div>
      <label class="checkbox-field">
        <input name="isActive" type="checkbox" ${checked(script.isActive)}>
        Активна
      </label>
      <div class="row-actions">
        <button class="button button-small" type="button" data-action="run-etl" data-script-id="${escapeHtml(script.id)}">Запуск</button>
        <button class="button button-small" type="submit">Сохранить</button>
        <button class="button button-small button-danger" type="button" data-action="delete-etl-script" data-script-id="${escapeHtml(script.id)}">Удалить</button>
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
        await Promise.all([loadAdminState(), loadEtlState()]);
      } else {
        await Promise.all([loadClientData(), loadEtlState()]);
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

    if (action === "create-etl-script") {
      const values = formValues(form);
      values.isActive = form.elements.isActive.checked;
      state.etlState = await api("/api/admin/etl/scripts", {
        method: "POST",
        body: JSON.stringify(values),
      });
      setNotice("Загрузка добавлена");
      render();
    }

    if (action === "save-etl-script") {
      const values = formValues(form);
      values.isActive = form.elements.isActive.checked;
      state.etlState = await api(`/api/admin/etl/scripts/${form.dataset.scriptId}`, {
        method: "PATCH",
        body: JSON.stringify(values),
      });
      setNotice("Загрузка сохранена");
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
  const activeTab =
    state.user?.role === "client" && state.activeClientTab !== "dataLoad"
      ? clientDashboardTabs().find((tab) => tab.id === state.activeClientTab)
      : null;
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
      state.etlState = null;
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
      await Promise.all([loadAdminState(), loadEtlState()]);
      setNotice("Данные обновлены");
      render();
    }

    if (action === "refresh-etl") {
      await loadEtlState();
      setNotice("Журнал обновлен");
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

    if (action === "delete-etl-script") {
      if (!confirm("Удалить настройку загрузки? Журнал запусков останется.")) {
        return;
      }
      state.etlState = await api(`/api/admin/etl/scripts/${button.dataset.scriptId}`, { method: "DELETE" });
      setNotice("Загрузка удалена");
      render();
    }

    if (action === "run-etl") {
      await api(`/api/etl/scripts/${button.dataset.scriptId}/run`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await loadEtlState();
      setNotice("Загрузка поставлена в очередь");
      render();
      window.setTimeout(async () => {
        try {
          await loadEtlState();
          render();
        } catch {
          // Ручное обновление останется доступным в интерфейсе.
        }
      }, 1200);
    }
  } catch (error) {
    setNotice(error.message, "error");
    render();
  }
});

boot();
