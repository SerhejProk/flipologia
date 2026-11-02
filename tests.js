// Автотесты логики Флипологии: node tests.js
// Загружает скрипт из index.html в песочницу с заглушками DOM и проверяет расчёты и разбор объявлений.
'use strict';
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// Заглушка DOM: любой элемент, свойство или вызов возвращает её же
const fake = new Proxy(function () {}, {
  get: (t, k) => k === Symbol.toPrimitive ? () => '' : k === 'forEach' ? () => {} : fake,
  set: () => true,
  apply: () => fake
});
const store = new Map();
const ctx = vm.createContext({
  document: fake, window: fake, navigator: {}, location: {protocol: 'file:'},
  localStorage: {getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v))},
  setTimeout: () => 0, clearTimeout: () => {}, confirm: () => true, Intl, console
});
vm.runInContext(code, ctx);

let pass = 0, fail = 0;
ctx.check = (name, ok, got) => {
  if (ok) pass++; else { fail++; console.log('ОШИБКА: ' + name + (got !== undefined ? ' — получено: ' + JSON.stringify(got) : '')); }
};
ctx.near = (a, b, tol) => Math.abs(a - b) <= tol;

vm.runInContext(`
/* --- Калькулятор: прежние результаты не изменились --- */
{
  const b = compute(Object.assign({}, DEFAULT_CALC));
  check('чистая прибыль по умолчанию 605 800', near(b.net, 605800, 1), b.net);
  check('годовых по умолчанию 20,2%', near(b.annual, 20.2, 0.05), b.annual);
}

/* --- Разбор объявлений --- */
{
  const r = parseListing('2-к. квартира, 54,3 м², 5/9 эт.\\n12 500 000 ₽\\n230 203 ₽ за м²\\nМосква, Кузьминская ул., 11\\nм. Кузьминки 10 мин');
  check('Авито: цена', r.price === 12500000, r.price);
  check('Авито: площадь', r.area === 54.3, r.area);
  check('Авито: комнаты', r.rooms === 2, r.rooms);
  check('Авито: этаж', r.floor === 5 && r.floors === 9, [r.floor, r.floors]);
  check('Авито: адрес', r.address === 'Москва, Кузьминская ул., 11', r.address);
  check('Авито: метро', r.metro === 'Кузьминки', r.metro);
}
{
  const r = parseListing('Продается 1-комн. квартира, 38 м²\\n9 800 000 ₽\\n257 895 ₽/м²\\nОбщая площадь\\n38 м²\\nЭтаж\\n3 из 12\\nМосква, ВАО, р-н Перово, Зелёный просп., 20\\nм. Перово\\nhttps://www.cian.ru/sale/flat/123/');
  check('ЦИАН: цена', r.price === 9800000, r.price);
  check('ЦИАН: площадь', r.area === 38, r.area);
  check('ЦИАН: комнаты', r.rooms === 1, r.rooms);
  check('ЦИАН: этаж 3 из 12', r.floor === 3 && r.floors === 12, [r.floor, r.floors]);
  check('ЦИАН: адрес', /^Москва, ВАО/.test(r.address), r.address);
  check('ЦИАН: ссылка', r.link === 'https://www.cian.ru/sale/flat/123/', r.link);
}
{
  const r = parseListing('Студия, 25 м², 12/17 эт.\\n6,9 млн ₽');
  check('млн: цена 6,9 млн', r.price === 6900000, r.price);
  check('студия', r.rooms === 1 && r.studio, r);
  check('студия: этаж', r.floor === 12 && r.floors === 17, [r.floor, r.floors]);
}
{
  const r = parseListing('450 000 ₽ за м²\\n20 250 000 ₽\\n45 м²');
  check('цена за м² выше 300 тыс. не путается с ценой', r.price === 20250000, r.price);
  const r2 = parseListing('Ипотека от 185 000 ₽ в месяц\\nСрочно продаю трёхкомнатную квартиру 64,5 кв. м\\nЦена 15 900 000 руб.');
  check('платёж по ипотеке не путается с ценой', r2.price === 15900000, r2.price);
  check('трёхкомнатная', r2.rooms === 3, r2.rooms);
  check('площадь «кв. м»', r2.area === 64.5, r2.area);
  check('пустой текст', !parseListing('').price && !parseListing('').area);
  check('«5 км» не комнаты', parseListing('До центра 5 км').rooms === undefined);
}
{
  check('название сделки', parseTitle({rooms: 2, area: 54.3, address: 'Москва, Кузьминская ул., 11'}) === '2-к, 54,3 м², Москва, Кузьминская ул., 11');
  check('название студии', parseTitle({rooms: 1, studio: true, area: 25}) === 'Студия, 25 м²');
}

/* --- Перенос разобранного в расчёт --- */
{
  S.calc = Object.assign({}, DEFAULT_CALC); S.smeta = Object.assign({}, DEFAULT_SMETA, {custom: {}}); S.sellM2 = 300000;
  applyParse({price: 9800000, area: 38, rooms: 1});
  check('цена в расчёт', S.calc.price === 9800000, S.calc.price);
  check('площадь и комнаты в смету', S.smeta.area === 38 && S.smeta.rooms === 1);
  check('ремонт по смете', S.calc.repair === Math.round(smetaTotal().total) && S.calc.repair > 0, S.calc.repair);
  check('продажа = 38 × 300 000', S.calc.sale === 11400000, S.calc.sale);
  S.sellM2 = 0; const before = S.calc.sale;
  applyParse({price: 5000000});
  check('без цены м² продажа не меняется', S.calc.sale === before);
}

/* --- Торги --- */
{
  const c = Object.assign({}, DEFAULT_CALC);
  const t = Object.assign({}, DEFAULT_TORGI, {start: 3000000});
  const a = torgiPlan(c, t);
  check('предел найден', a.maxBid > 0, a.maxBid);
  check('на пределе доходность = цели', near(a.at(a.maxBid).annual, c.target, 0.01), a.at(a.maxBid).annual);
  check('ставка без убытка: прибыль 0', near(a.at(a.zeroBid).net, 0, 1), a.at(a.zeroBid).net);
  check('без убытка дороже предела', a.zeroBid > a.maxBid);
  check('торги учитывают доп. расходы и срок', a.c.buyCosts === c.buyCosts + t.extra && a.c.months === c.months + t.delay);
  check('аукцион ниже предела → брать', a.cls === 'good' && /^Ставка до/.test(a.verdict), a.verdict);
  check('предел округлён вниз до 10 тыс.', a.limit <= a.maxBid && a.limit % 10000 === 0, a.limit);
  check('шагов до предела', a.steps === Math.floor((a.maxBid - 3000000) / 150000), a.steps);
  check('задаток 20% от начальной', a.deposit === 600000, a.deposit);
  const hi = torgiPlan(c, Object.assign({}, t, {start: 6000000}));
  check('аукцион выше предела → не участвовать', hi.cls === 'bad' && hi.verdict === 'Не участвовать', hi.verdict);
}
{
  const c = Object.assign({}, DEFAULT_CALC);
  const t = Object.assign({}, DEFAULT_TORGI, {kind: 'offer', start: 6000000, drop: 10, periods: 8});
  const a = torgiPlan(c, t);
  check('этапов = periods + 1', a.stages.length === 9, a.stages.length);
  check('этап найден', !!a.entry, a.entry);
  check('цена этапа не выше предела', a.entry.p <= a.maxBid);
  check('предыдущий этап выше предела', a.entry.i === 0 || a.stages[a.entry.i - 1].p > a.maxBid);
  check('вердикт с номером этапа', a.verdict === 'Заявка на этапе ' + (a.entry.i + 1), a.verdict);
  check('задаток от цены этапа', near(a.deposit, a.entry.p * 0.2, 0.01), a.deposit);
  const none = torgiPlan(c, Object.assign({}, t, {periods: 1}));
  check('не дошли до предела → не участвовать', none.cls === 'bad' && !none.entry, none.verdict);
  const big = torgiPlan(c, Object.assign({}, t, {drop: 60, periods: 5}));
  check('цена этапа не уходит в ноль и минус', big.stages.every(s => s.p > 0), big.stages.map(s => s.p));
}
{
  const a = torgiPlan(Object.assign({}, DEFAULT_CALC, {sale: 0}), DEFAULT_TORGI);
  check('нет цены продажи → заполните расчёт', a.verdict === 'Заполните расчёт', a.verdict);
}

/* --- Находки ревью 03.11.2026: разбор объявлений --- */
{
  const p = s => parseListing(s);
  check('«кухня-студия» не делает трёшку студией', p('3-к. квартира, 74 м², 4/9 эт.\\nПросторная кухня-студия, рядом танцевальная студия').rooms === 3);
  check('корпус «5к1» не комнаты', p('Москва, Ленинский пр-т, 5к1\\n12 000 000 ₽').rooms === undefined, p('Москва, Ленинский пр-т, 5к1').rooms);
  check('корпус «11к2» не комнаты', p('ул. Ленина, 11к2').rooms === undefined);
  check('корпус «5 к. 1» не комнаты', p('Москва, ул. Ленина, д. 5 к. 1').rooms === undefined);
  check('«Количество комнат: 2»', p('Количество комнат: 2\\nОбщая площадь: 54 м²').rooms === 2);
  check('«2к кв»', p('Продам 2к кв 45 м²').rooms === 2);
  check('скидка 1 млн — не цена', p('Скидка 1 млн при 100% оплате\\n12 500 000 ₽').price === 12500000, p('Скидка 1 млн при 100% оплате\\n12 500 000 ₽').price);
  check('«было … стало …» — берём новую цену', p('Было 13 000 000 ₽, стало 12 500 000 ₽').price === 12500000, p('Было 13 000 000 ₽, стало 12 500 000 ₽').price);
  check('ежемесячный платёж — не цена', p('Ежемесячный платёж 320 000 ₽\\n9 900 000 ₽').price === 9900000);
  check('«за 1 кв. м» — не цена', p('450 000 руб. за 1 кв. м\\n20 250 000 руб.').price === 20250000);
  check('«за 1 м²» — не цена', p('450 000 ₽ за 1 м²\\n20 250 000 ₽').price === 20250000);
  check('«12 500 тыс. руб.»', p('Цена 12 500 тыс. руб.').price === 12500000, p('Цена 12 500 тыс. руб.').price);
  check('табуляция перед ₽', p('Цена\\t12 500 000\\t₽').price === 12500000, p('Цена\\t12 500 000\\t₽').price);
  check('подписанная «Цена» важнее', p('Ипотека 1 200 000 ₽ первый взнос\\nЦена: 8 700 000 ₽').price === 8700000);
  check('«от собственника» перед ценой — не мешает', p('Квартира от собственника 12 500 000 ₽').price === 12500000);
  check('кухня выше общей площади', p('Кухня 10 м²\\nОбщая\\n54 м²').area === 54, p('Кухня 10 м²\\nОбщая\\n54 м²').area);
  check('значение перед подписью «Общая»', p('38 м² Общая площадь 20 м² Жилая').area === 38, p('38 м² Общая площадь 20 м² Жилая').area);
  check('подпись перед значением', p('Общая площадь\\n54 м²\\nЖилая площадь\\n30 м²\\nПлощадь кухни\\n10 м²').area === 54);
  check('заголовок важнее параметров', p('Кухня 9 м²\\n2-к. квартира, 54,3 м², 5/9 эт.').area === 54.3);
  check('цена «за 1 м²» не съедает площадь', p('230 000 ₽ за 1 м²\\n45 м²').area === 45, p('230 000 ₽ за 1 м²\\n45 м²').area);
  check('«кв. м. Светлая» — не метро', p('45 кв. м. Светлая, тёплая').metro === undefined, p('45 кв. м. Светлая').metro);
  check('«метро Пешком» — не метро', p('До метро Пешком 10 минут').metro === undefined);
  check('метро после запятой', p('Москва, ул. Ленина, 5, м. Сокол').metro === 'Сокол');
  check('«Супер. ремонт» — не адрес', p('Супер. ремонт\\n12 000 000 ₽').address === '');
  check('адрес с домом важнее «тихой улицы»', p('Тихая улица, рядом парк\\nМосква, ул. Ленина, 5').address === 'Москва, ул. Ленина, 5');
  check('«Невский пр.»', p('Невский пр., 10').address === 'Невский пр., 10');
  check('ссылка без хвостовой пунктуации', p('(https://avito.ru/123), смотрите').link === 'https://avito.ru/123', p('(https://avito.ru/123), смотрите').link);
}

/* --- Находки ревью 03.11.2026: торги --- */
{
  const c = Object.assign({}, DEFAULT_CALC);
  const t = Object.assign({}, DEFAULT_TORGI, {start: 3000000});
  const a1 = torgiPlan(c, t);
  const a2 = torgiPlan(a1.c, t);   // сделка по лоту → калькулятор → снова «Торги»
  check('расходы торгов не задваиваются', a2.c.buyCosts === a1.c.buyCosts && a2.c.months === a1.c.months, [a1.c.buyCosts, a2.c.buyCosts]);
  check('предел тот же при повторном заходе', near(a2.maxBid, a1.maxBid, 1), [a1.maxBid, a2.maxBid]);
  const a3 = torgiPlan(a1.c, Object.assign({}, t, {extra: 0, delay: 0}));
  check('смена расходов торгов заменяет, а не добавляет', a3.c.buyCosts === c.buyCosts && a3.c.months === c.months, [a3.c.buyCosts, a3.c.months]);
  // Начальная цена между округлённым пределом и точным
  const mb = a1.maxBid, lim = a1.limit, mid = lim + (mb - lim) / 2;
  const a4 = torgiPlan(c, Object.assign({}, t, {start: mid}));
  check('предел не ниже начальной при «Ставка до»', a4.cls !== 'good' || a4.limit >= mid, [a4.verdict, a4.limit, mid]);
  check('почти на пределе → только по начальной', a4.verdict === 'Только по начальной цене', a4.verdict);
  const a5 = torgiPlan(c, Object.assign({}, t, {kind: 'offer', start: 6000000}));
  check('этап предложения не выше округлённого предела', a5.entry && a5.entry.p <= a5.limit, a5.entry && [a5.entry.p, a5.limit]);
  const a6 = torgiPlan(c, Object.assign({}, t, {step: 0}));
  check('шаг 0: без «0 шаг. по 0 ₽»', !/0 шаг/.test(a6.why), a6.why);
}

/* --- Находки ревью 03.11.2026: подделанная копия --- */
{
  const evil = '<img src=x onerror=alert(1)>';
  localStorage.setItem(LS_KEY, JSON.stringify({
    deals: [{id: '"><img src=x onerror=alert(1)>', name: 'x', calc: {months: evil, commission: evil, fin: evil}, expenses: [{id: evil, sum: evil}], stage: evil}, null, 5],
    calc: {months: evil, fin: evil, tax: evil}, smeta: {contingency: evil, level: 7, custom: {demo_1: evil, 'x"><b': 5, walls_2: 3000}},
    torgi: {periods: 10000000, kind: evil, start: evil}, sellM2: evil, tab: evil, calcDeal: {}
  }));
  const s = load();
  check('копия: числа расчёта — числа', typeof s.calc.months === 'number' && s.calc.fin === 'own' && s.calc.tax === 'ndfl');
  check('копия: смета очищена', typeof s.smeta.contingency === 'number' && s.smeta.level === 1 && Object.keys(s.smeta.custom).join() === 'walls_2');
  check('копия: этапов не больше 30', s.torgi.periods === 30 && s.torgi.kind === 'auction' && typeof s.torgi.start === 'number');
  check('копия: мусорные сделки отброшены', s.deals.length === 1, s.deals.length);
  check('копия: числа сделки — числа', typeof s.deals[0].calc.commission === 'number' && s.deals[0].calc.fin === 'own' && s.deals[0].expenses[0].sum === 0 && s.deals[0].stage === 'Поиск');
  check('копия: вкладка и цена м²', s.tab === 'calc' && s.sellM2 === 0 && s.calcDeal === null);
  check('копия: id экранируется при выводе', !/<img/.test(esc(s.deals[0].id)));
}

/* --- Старые сохранённые данные без торгов --- */
{
  localStorage.setItem(LS_KEY, JSON.stringify({deals: [], calc: {price: 1}, tab: 'calc'}));
  const s = load();
  check('старые данные: торги по умолчанию', s.torgi.kind === 'auction' && s.torgi.start === DEFAULT_TORGI.start);
  check('старые данные: цена м² = 0', s.sellM2 === 0);
}
`, ctx);

console.log('Тесты: ' + pass + ' из ' + (pass + fail) + ' пройдено');
process.exit(fail ? 1 : 0);
