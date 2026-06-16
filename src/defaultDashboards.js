export const DEFAULT_CLIENT = {
  name: "Odeon Show",
  slug: "odeon-show",
};

export const DEFAULT_DASHBOARDS = [
  {
    key: "operational-control",
    title: "Оперативный контроль",
    description: "Ежедневный контроль продаж",
    url: "https://datalens.yandex/i0yioelotv302?_embedded=1&_no_controls=1&_theme=dark",
    sortOrder: 10,
  },
  {
    key: "sales-filters",
    title: "Продажи с фильтрами",
    description: "Дата события и категория билета",
    url: "/internal/clients/odeon-show/filters",
    kind: "internal",
    sortOrder: 20,
  },
  {
    key: "max-tickets",
    title: "Билеты MAX",
    description: "Отслеживание билетов MAX",
    url: "https://datalens.yandex/i1bvc2rk1gyw2?_embedded=1&_no_controls=1&_theme=dark",
    sortOrder: 30,
  },
  {
    key: "max-price",
    title: "Цены продаж MAX",
    description: "Отслеживание цены продаж всех категорий MAX",
    url: "https://datalens.yandex/l4f7v9hp1g9a5?_embedded=1&_no_controls=1&_theme=dark",
    sortOrder: 40,
  },
  {
    key: "tickets",
    title: "Билеты",
    description: "Отслеживание билетов",
    url: "https://datalens.yandex/3jbj88gnek4un?_embedded=1&_no_controls=1&_theme=dark",
    sortOrder: 50,
  },
  {
    key: "all-categories",
    title: "Все категории",
    description: "Отслеживание всех категорий",
    url: "https://datalens.yandex/euo4f8jr1ff8y?_embedded=1&_no_controls=1&_theme=dark",
    sortOrder: 60,
  },
];
