// imot.bg vocabulary: property types, deal kinds and common feature terms,
// with English labels. Shared by the importer (normalisation) and the UI.

// Order matters: first match wins (more specific patterns first).
export const PROPERTY_TYPES = [
  { key: 'studio', re: /^1-СТАЕН/, en: '1-room flat (studio)', short: 'Studio', bg: '1-стаен' },
  { key: 'apt2', re: /^2-СТАЕН/, en: '2-room flat (1 bed)', short: '2-room flat', bg: '2-стаен' },
  { key: 'apt3', re: /^3-СТАЕН/, en: '3-room flat (2 bed)', short: '3-room flat', bg: '3-стаен' },
  { key: 'apt4', re: /^4-СТАЕН/, en: '4-room flat (3 bed)', short: '4-room flat', bg: '4-стаен' },
  { key: 'aptMulti', re: /^МНОГОСТАЕН/, en: 'Multi-room flat', bg: 'Многостаен' },
  { key: 'maisonette', re: /^МЕЗОНЕТ/, en: 'Maisonette', bg: 'Мезонет' },
  { key: 'atelier', re: /^(АТЕЛИЕ|ТАВАН)/, en: 'Studio / attic', bg: 'Ателие, таван' },
  { key: 'houseFloor', re: /^ЕТАЖ ОТ КЪЩА/, en: 'Floor of a house', bg: 'Етаж от къща' },
  { key: 'house', re: /^КЪЩА/, en: 'House', bg: 'Къща' },
  { key: 'villa', re: /^ВИЛА/, en: 'Villa', bg: 'Вила' },
  { key: 'plot', re: /^ПАРЦЕЛ/, en: 'Building plot', bg: 'Парцел' },
  { key: 'land', re: /^ЗЕМЕДЕЛСКА ЗЕМЯ|^ЗЕМЯ/, en: 'Agricultural land', bg: 'Земеделска земя' },
  { key: 'office', re: /^ОФИС/, en: 'Office', bg: 'Офис' },
  { key: 'shop', re: /^МАГАЗИН/, en: 'Shop', bg: 'Магазин' },
  { key: 'restaurant', re: /^ЗАВЕДЕНИЕ/, en: 'Restaurant / bar', bg: 'Заведение' },
  { key: 'warehouse', re: /^СКЛАД/, en: 'Warehouse', bg: 'Склад' },
  { key: 'hotel', re: /^ХОТЕЛ/, en: 'Hotel', bg: 'Хотел' },
  { key: 'industrial', re: /^ПРОМ/, en: 'Industrial premises', bg: 'Пром. помещение' },
  { key: 'garage', re: /^ГАРАЖ/, en: 'Garage', bg: 'Гараж' },
  { key: 'parking', re: /^ПАРКОМЯСТО/, en: 'Parking space', bg: 'Паркомясто' },
  { key: 'business', re: /^БИЗНЕС/, en: 'Business property', bg: 'Бизнес имот' },
];

export const DEALS = [
  { key: 'sale', re: /^продава/i, en: 'For sale', bg: 'Продава' },
  { key: 'rent', re: /^дава под наем/i, en: 'For rent', bg: 'Дава под наем' },
  { key: 'buy', re: /^купува/i, en: 'Wanted to buy', bg: 'Купува' },
  { key: 'wantRent', re: /^(наема|търси)/i, en: 'Wanted to rent', bg: 'Наема' },
  { key: 'swap', re: /^заменя/i, en: 'Exchange', bg: 'Заменя' },
];

/** Split "Продава КЪЩА" / "Дава под Наем 2-СТАЕН" into deal + type. */
export function classifyTitle(title) {
  const t = String(title || '').replace(/\s+/g, ' ').trim();
  const deal = DEALS.find((d) => d.re.test(t));
  let rest = t;
  if (deal) rest = t.replace(deal.re, '').trim();
  const typeBg = rest.toUpperCase();
  const type = PROPERTY_TYPES.find((p) => p.re.test(typeBg));
  return { deal: deal ? deal.key : 'other', type: type ? type.key : 'other', typeBg: rest };
}

export function typeLabel(key, typeBg, lang, short = false) {
  const t = PROPERTY_TYPES.find((p) => p.key === key);
  if (t) return lang === 'bg' ? t.bg : (short && t.short) || t.en;
  return typeBg || key;
}

export function dealLabel(key, lang) {
  const d = DEALS.find((x) => x.key === key);
  return d ? (lang === 'bg' ? d.bg : d.en) : key;
}

// Common terms on imot.bg pages (features, parameter labels, values).
export const TERMS = {
  'Тухла': 'Brick',
  'Панел': 'Panel block',
  'ЕПК': 'Cast-in-place concrete (EPK)',
  'ПК': 'Precast concrete (PK)',
  'Гредоред': 'Timber-beam',
  'Кирпич': 'Adobe',
  'Сглобяема': 'Prefabricated',
  'Сглобяема конструкция': 'Prefabricated',
  'Монолит': 'Monolithic',
  'Асансьор': 'Elevator',
  'Саниран': 'Insulated façade',
  'Обзаведен': 'Furnished',
  'Полуобзаведен': 'Partly furnished',
  'Необзаведен': 'Unfurnished',
  'Интернет връзка': 'Internet',
  'Лизинг': 'Leasing possible',
  'С гараж': 'With garage',
  'Гараж': 'Garage',
  'Паркинг': 'Parking',
  'С паркинг': 'With parking',
  'За ремонт': 'Needs renovation',
  'С преход': 'Walk-through rooms',
  'С действащ бизнес': 'With an operating business',
  'В затворен комплекс': 'In a gated complex',
  'В строеж': 'Under construction',
  'Ипотекиран': 'Mortgaged',
  'Камък': 'Stone',
  'Дървена': 'Timber',
  'Видео наблюдение': 'CCTV',
  'Контрол на достъпа': 'Access control',
  'Охрана': 'Security',
  'Възможност за дан. кредит': 'Mortgage-ready (tax credit)',
  'Регулация': 'Zoned for building',
  'Ток': 'Electricity',
  'Вода': 'Water',
  'Канализация': 'Sewerage',
  'Газ': 'Gas',
  'ТЕЦ': 'District heating',
  'ТEЦ': 'District heating',
  'Лок.отопл.': 'Local heating',
  'Климатик': 'Air conditioning',
  'Камина': 'Fireplace',
  'Басейн': 'Pool',
  'За жил.строителство': 'For residential construction',
  'Ново строителство': 'New build',
  'Ипотека': 'Mortgaged',
  'Бартер': 'Barter',
  'Лукс': 'Luxury',
  'Площ': 'Area',
  'Двор': 'Yard',
  'Етаж': 'Floor',
  'Строителство': 'Construction',
  'Етажност': 'Storeys',
  'Отопление': 'Heating',
  'ДА': 'Yes',
  'НЕ': 'No',
  'Партер': 'Ground floor',
  'Сутерен': 'Basement',
  'Въведен в експлоатация': 'Completed (Act 16)',
  'Не е въведен в експлоатация': 'Not yet completed',
  'Ще бъде въведен в експлоатация': 'Under construction',
  'Цената е без ДДС': 'Price excludes VAT',
  'Не се начислява ДДС': 'No VAT charged',
  'Цената е с ДДС': 'Price includes VAT',
};

export function term(bg, lang) {
  if (lang === 'bg' || !bg) return bg;
  return TERMS[bg] || TERMS[String(bg).trim()] || bg;
}

export const CONSTRUCTION_STATUS = {
  completed: { bg: 'Въведен в експлоатация', en: 'Completed (Act 16)' },
  notCompleted: { bg: 'Не е въведен в експлоатация', en: 'Not yet completed' },
  planned: { bg: 'Ще бъде въведен в експлоатация', en: 'Under construction' },
};

export const SETTLEMENT_KINDS = {
  city: { bg: 'град', en: 'city' },
  town: { bg: 'гр.', en: 'town' },
  village: { bg: 'с.', en: 'village' },
  resort: { bg: 'к.к.', en: 'resort' },
  locality: { bg: 'м-т', en: 'locality' },
  villaZone: { bg: 'в.з.', en: 'villa zone' },
  other: { bg: '', en: '' },
};
