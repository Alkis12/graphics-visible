export const DEFAULT_CLIENT = {
  name: "Odeon Show",
  slug: "odeon-show",
};

export const DEFAULT_DASHBOARD_TABS = [
  {
    key: "operational",
    title: "Оперативный дашборд",
    sortOrder: 10,
  },
  {
    key: "salesMetrics",
    title: "Отслеживание метрик продаж",
    sortOrder: 20,
  },
];

export const DEFAULT_DASHBOARDS = [
  {
    key: "operational-failures",
    tabKey: "operational",
    title: "Проверка сбоев",
    description: "Оперативная проверка сбоев",
    datalensId: "i0yioelotv302",
    filtersEnabled: false,
    sortOrder: 10,
  },
  {
    key: "daily-check",
    tabKey: "operational",
    title: "Ежедневный график проверки",
    description: "Ежедневный график проверки",
    datalensId: "wfanps3o636qf",
    filtersEnabled: false,
    sortOrder: 20,
  },
  {
    key: "max-tickets",
    tabKey: "salesMetrics",
    title: "Билеты",
    description: "Отслеживание билетов MAX",
    datalensId: "i1bvc2rk1gyw2",
    filtersEnabled: false,
    sortOrder: 10,
  },
  {
    key: "max-price",
    tabKey: "salesMetrics",
    title: "Цены продаж",
    description: "Отслеживание цены продаж всех категорий MAX",
    datalensId: "l4f7v9hp1g9a5",
    filtersEnabled: false,
    sortOrder: 20,
  },
  {
    key: "tickets",
    tabKey: "salesMetrics",
    title: "Билеты (базовый)",
    description: "Отслеживание билетов",
    datalensId: "3jbj88gnek4un",
    filtersEnabled: false,
    sortOrder: 30,
  },
  {
    key: "all-categories",
    tabKey: "salesMetrics",
    title: "Все категории (базовый)",
    description: "Отслеживание всех категорий",
    datalensId: "euo4f8jr1ff8y",
    filtersEnabled: false,
    sortOrder: 40,
  },
];
