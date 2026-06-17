export const DEFAULT_CLIENT = {
  name: "Odeon Show",
  slug: "odeon-show",
};

export const DEFAULT_DASHBOARDS = [
  {
    key: "max-tickets",
    title: "Билеты MAX",
    description: "Отслеживание билетов MAX",
    url: "https://datalens.yandex/i1bvc2rk1gyw2?_embedded=1&_no_controls=1&_theme=dark",
    filtersEnabled: true,
    sortOrder: 10,
  },
  {
    key: "max-price",
    title: "Цены продаж MAX",
    description: "Отслеживание цены продаж всех категорий MAX",
    url: "https://datalens.yandex/l4f7v9hp1g9a5?_embedded=1&_no_controls=1&_theme=dark",
    filtersEnabled: true,
    sortOrder: 20,
  },
  {
    key: "tickets",
    title: "Билеты",
    description: "Отслеживание билетов",
    url: "https://datalens.yandex/3jbj88gnek4un?_embedded=1&_no_controls=1&_theme=dark",
    filtersEnabled: true,
    sortOrder: 30,
  },
  {
    key: "all-categories",
    title: "Все категории",
    description: "Отслеживание всех категорий",
    url: "https://datalens.yandex/euo4f8jr1ff8y?_embedded=1&_no_controls=1&_theme=dark",
    filtersEnabled: true,
    sortOrder: 40,
  },
];
