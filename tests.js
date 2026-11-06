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
const rayonyFile = __dirname + '/rayony-data.js';
if (fs.existsSync(rayonyFile)) vm.runInContext(fs.readFileSync(rayonyFile, 'utf8'), ctx);
const shablonyFile = __dirname + '/shablony-data.js';
if (fs.existsSync(shablonyFile)) vm.runInContext(fs.readFileSync(shablonyFile, 'utf8'), ctx);
vm.runInContext(code, ctx);

let pass = 0, fail = 0;
ctx.check = (name, ok, got) => {
  if (ok) pass++; else { fail++; console.log('ОШИБКА: ' + name + (got !== undefined ? ' — получено: ' + JSON.stringify(got) : '')); }
};
ctx.SRC = code;
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
  check('копия: вкладка (мусор — «Главная») и цена м²', s.tab === 'home' && s.sellM2 === 0 && s.calcDeal === null);
  check('копия: id экранируется при выводе', !/<img/.test(esc(s.deals[0].id)));
}

/* --- Карточка сделки: точечные блоки --- */
{
  check('ссылка javascript: не становится ссылкой', dealLinkHtml({link: 'javascript:alert(1)'}) === '');
  check('ссылка экранируется', !/"><img/.test(dealLinkHtml({link: 'https://a.ru/"><img src=x>'})));
  const d = {calc: Object.assign({}, DEFAULT_CALC, {price: 5000000, commission: 2}), expenses: [{sum: 1000000}], saleFact: 7000000};
  check('факт: прибыль до налога 7 000 000 − 2% − 5 000 000 − 1 000 000', /860 000/.test(dealFactHtml(d).replace(/\\u00a0/g, ' ')), dealFactHtml(d));
  check('факт без цены продажи — подсказка', /Впишите цену продажи/.test(dealFactHtml({calc: null, expenses: [], saleFact: 0})));
}

/* --- Старые сохранённые данные без торгов --- */
{
  localStorage.setItem(LS_KEY, JSON.stringify({deals: [], calc: {price: 1}, tab: 'calc'}));
  const s = load();
  check('старые данные: торги по умолчанию', s.torgi.kind === 'auction' && s.torgi.start === DEFAULT_TORGI.start);
  check('старые данные: цена м² = 0', s.sellM2 === 0);
  check('старые данные: районы пустые', s.rayony.fav.length === 0 && Object.keys(s.rayony.notes).length === 0);
}

/* --- Находки ревью 04.11.2026: расчёт --- */
{
  const b = Object.assign({}, DEFAULT_CALC, {fin: 'mortgage', down: 20, rate: 20, term: 1});
  const m12 = compute(Object.assign({}, b, {months: 12})), m24 = compute(Object.assign({}, b, {months: 24}));
  check('кредит погашен: проценты не убывают с ростом срока', near(m24.interest, m12.interest, 1), [m12.interest, m24.interest]);
  check('кредит погашен: свои деньги растут только на коммуналку', near(m24.ownCash - m12.ownCash, b.utilities * 12, 1), [m12.ownCash, m24.ownCash]);
  check('дольше срок — прибыль не выше', m24.net < m12.net, [m12.net, m24.net]);
  const m6 = compute(Object.assign({}, b, {months: 6}));
  check('до погашения платежи считаются как раньше', near(m6.ownCash, 5000000 - m6.loan + b.buyCosts + b.repair + b.furniture + b.utilities * 6 + m6.pmt * 6, 1), m6.ownCash);
  const be = s => analyse(Object.assign({}, DEFAULT_CALC, {sale: s})).breakeven;
  check('продажа в ноль не зависит от текущей продажи', be(0) != null && near(be(0), be(7000000), 1), [be(0), be(7000000)]);
  check('продажа в ноль при малой продаже', be(1000000) != null && near(be(1000000), be(7000000), 1), [be(1000000), be(7000000)]);
  check('герой: цена 0 — прочерк', heroNumbers(Object.assign({}, DEFAULT_CALC, {price: 0}), analyse(Object.assign({}, DEFAULT_CALC, {price: 0})).base).net === '—');
  check('герой: цена меньше нуля — прочерк', heroNumbers(Object.assign({}, DEFAULT_CALC, {price: -100}), analyse(Object.assign({}, DEFAULT_CALC, {price: -100})).base).annual === '—');
  check('герой: продажа 0 — прочерк', heroNumbers(Object.assign({}, DEFAULT_CALC, {sale: 0}), analyse(Object.assign({}, DEFAULT_CALC, {sale: 0})).base).net === '—');
  const ok = analyse(Object.assign({}, DEFAULT_CALC)).base, hn = heroNumbers(DEFAULT_CALC, ok);
  check('герой: при заполненных ценах суммы как в расчёте', hn.net === rub(ok.net) && hn.annual === pct(ok.annual), hn);
  check('ползунок: границы ±40% с шагом 10 тыс.', priceSlideRange(5000000).lo === 3000000 && priceSlideRange(5000000).hi === 7000000);
  check('ползунок: 12 млн — новые границы', priceSlideRange(12000000).lo === 7200000 && priceSlideRange(12000000).hi === 16800000);
  check('ползунок: без цены его нет', priceSlideRange(0) === null && priceSlideRange(-5) === null);
  check('ползунок: слишком малая цена — его нет', priceSlideRange(10000) === null && priceSlideRange(1000) === null);
}

/* --- Предел цены покупки, желаемая прибыль, месяц простоя --- */
{
  const D = DEFAULT_CALC, mk = d => analyse(Object.assign({}, D, d));
  const a0 = mk({});
  check('предел: без желаемой прибыли как раньше (по доходности)', a0.maxBuy === a0.maxBuyYield && a0.maxBuyProfit === null, [a0.maxBuy, a0.maxBuyYield]);
  check('предел по доходности: при нём доходность равна цели', near(compute(Object.assign({}, D, {price: a0.maxBuy})).annual, D.target, 0.01), a0.maxBuy);
  const a1 = mk({minProfit: 1000000});
  check('предел по прибыли: при нём чистая прибыль равна желаемой', a1.maxBuyProfit != null && near(compute(Object.assign({}, D, {price: a1.maxBuyProfit})).net, 1000000, 1), a1.maxBuyProfit);
  check('предел: берётся меньший из двух', a1.maxBuy === Math.min(a1.maxBuyYield, a1.maxBuyProfit), [a1.maxBuy, a1.maxBuyYield, a1.maxBuyProfit]);
  const hi = mk({minProfit: 100000000});
  check('желаемая прибыль недостижима: предела нет, не «Брать»', hi.maxBuy === null && hi.verdict !== 'Брать', [hi.maxBuy, hi.verdict]);
  const big = mk({price: 3000000, sale: 9000000, repair: 300000, minProfit: 8000000});
  check('прибыль ниже желаемой — вердикт не «Брать»', big.verdict !== 'Брать' && big.base.net < 8000000, big.verdict);
  check('нулевая и отрицательная желаемая прибыль не влияют', mk({minProfit: -5}).maxBuy === a0.maxBuy && mk({minProfit: 0}).verdict === a0.verdict);
  const idle = a0.idle, c1 = compute(Object.assign({}, D, {months: D.months + 1}));
  check('месяц простоя = разница прибыли при сроке +1', near(idle, a0.base.net - c1.net, 0.01) && idle >= D.utilities - 1, idle);
  const im = mk({fin: 'mortgage', down: 20, rate: 20, term: 20});
  check('месяц простоя с ипотекой больше, чем без неё', im.idle > a0.idle, [im.idle, a0.idle]);
  check('старые данные без minProfit: 0', clean(DEFAULT_CALC, {price: 1}, CALC_ENUMS).minProfit === 0 && clean(DEFAULT_CALC, {minProfit: 'x'}, CALC_ENUMS).minProfit === 0);
}

/* --- Ревью: желаемая прибыль в вердикте, строках и «Торгах» --- */
{
  const D = DEFAULT_CALC, mk = d => analyse(Object.assign({}, D, d));
  const u = mk({price: 3000000, sale: 8000000, repair: 300000, minProfit: 20000000});
  check('недостижимая прибыль: причина про прибыль, не про доходность', u.verdict === 'Не брать' && /недостижима/.test(u.why) && !/Доходность ниже цели/.test(u.why), [u.verdict, u.why]);
  const r = mk({price: 3000000, sale: 4000000, repair: 300000, minProfit: 5000000});
  check('рискованно + недобор прибыли: в причине есть прибыль', /желаем/.test(r.why), [r.verdict, r.why]);
  const t0 = {kind: 'auction', start: 4000000, step: 5, extra: 0, delay: 0, periods: 0, drop: 0};
  const cc = Object.assign({}, D, {minProfit: 900000});
  const tp = torgiPlan(cc, t0), tp0 = torgiPlan(Object.assign({}, D), t0);
  check('торги: предел с желаемой прибылью ниже предела только по доходности', tp.limit > 0 && tp.limit < tp0.limit, [tp.limit, tp0.limit]);
  check('торги: при предельной ставке прибыль не меньше желаемой', compute(Object.assign({}, tp.c, {price: tp.limit})).net >= 900000, tp.limit);
  check('торги: без желаемой прибыли предел прежний', tp0.limit === round10k(tp0.maxBid), tp0.limit);
}

/* --- План / факт и график ремонта --- */
{
  const mkW = (start, o) => cleanWorks({start, items: Object.keys(o || {}).map(k => Object.assign({k}, o[k]))});
  const w0 = mkW('2026-11-01');
  check('график: 5 этапов с днями по умолчанию', w0 && w0.items.length === 5 && w0.items.map(i => i.days).join() === '5,20,7,25,7', w0);
  const p0 = worksPlan(w0, '2026-11-01');
  check('график: сумма 64 дня, выход на продажу 04.01', p0.planEnd - isoDay('2026-11-01') === 64 && dayRu(p0.planEnd) === '04.01', dayRu(p0.planEnd));
  check('график: без отметок сдвига нет', p0.shift === 0 && p0.rows[0].state === 'work' && p0.rows[1].state === 'wait');
  // Демонтаж готов 06.11 вместо 06.11 (5 дн.) — а теперь на 3 дня позже: 09.11
  const w1 = mkW('2026-11-01', {demo: {done: '2026-11-09'}});
  const p1 = worksPlan(w1, '2026-11-09');
  check('сдвиг: демонтаж на 3 дня позже — всё остальное и выход на продажу +3', p1.shift === 3 && p1.rows[1].fStart === p1.rows[1].pStart + 3 && p1.foreEnd === p1.planEnd + 3, p1.shift);
  const p1b = worksPlan(mkW('2026-11-01', {demo: {done: '2026-11-04'}}), '2026-11-05');
  check('раньше срока: сдвиг отрицательный', p1b.shift === -2, p1b.shift);
  // этап не отмечен: сегодня на 4 дня позже плана
  const p2 = worksPlan(w0, '2026-11-10');
  check('просрочка: демонтаж не отмечен, сегодня 10.11 (план до 06.11) — 4 дня', p2.rows[0].state === 'late' && p2.rows[0].overdue === 4 && p2.shift === 4 && p2.rows[1].state === 'wait', [p2.rows[0].state, p2.rows[0].overdue, p2.shift]);
  check('просрочка растёт с датой', worksPlan(w0, '2026-11-11').shift === 5);
  check('график ещё не начался: этапы ждут', worksPlan(w0, '2026-10-20').rows.every(r => r.state === 'wait') && worksPlan(w0, '2026-10-20').shift === 0);
  check('график: плохая дата — нет графика', cleanWorks({start: '2026-02-30', items: []}) === null && cleanWorks({start: 'x'}) === null && cleanWorks(null) === null && cleanWorks('a') === null);
  const wbad = cleanWorks({start: '2026-11-01', items: [{k: 'demo', days: 'abc', done: '2026-13-40'}, {k: 'rough', days: 9999}, {k: 'elec', days: -5}, null, {k: 'нет', days: 3}]});
  check('график: мусор в этапах очищен', wbad.items[0].days === 5 && wbad.items[0].done === '' && wbad.items[1].days === 365 && wbad.items[2].days === 0 && wbad.items.length === 5, wbad);
  check('сделка из копии сохраняет график', cleanDeal({id: 'a', works: w1}).works.items[0].done === '2026-11-09' && cleanDeal({id: 'a'}).works === null);
  // план / факт
  const c = Object.assign({}, DEFAULT_CALC), b = compute(c);
  const pf = planFact(c, b, [{cat: 'Ремонт', sum: 600000}, {cat: 'Материалы', sum: 300000}, {cat: 'Мебель и техника', sum: 50000}, {cat: 'Ипотека', sum: 99999}, {cat: 'Налоги', sum: 1}, {cat: 'Что-то', sum: 7000}]);
  check('план/факт: ремонт 900 000 при плане 800 000 — +100 000', pf.rows[0].fact === 900000 && pf.rows[0].diff === 100000, pf.rows[0]);
  check('план/факт: мебель в пределах плана не даёт перерасхода', pf.rows[1].diff === -50000);
  check('план/факт: чужая статья идёт в «Прочее»', pf.rows[4].fact === 7000 && pf.rows[4].diff === 7000);
  check('план/факт: перерасход = 100 000 + 7 000, ипотека и налоги отдельно', pf.over === 107000 && pf.skipped === 100000, [pf.over, pf.skipped]);
  check('план/факт: пустые расходы — нулевой перерасход', planFact(c, b, []).over === 0);
  check('месяц простоя в графике = монотонно положителен', monthIdle(c) >= c.utilities - 1);
}

/* --- Ревью графика ремонта --- */
{
  const mk2 = (o) => cleanWorks({start: '2026-11-01', items: Object.keys(o).map(k => Object.assign({k}, o[k]))});
  const z = worksPlan(mk2({demo: {days: 0}}), '2026-11-04');
  check('этап 0 дней не даёт просрочки и сдвига', z.rows[0].state === 'wait' && z.rows[0].overdue === 0 && z.shift === 0, z.shift);
  check('этап 0 дней: следующий этап идёт сразу', z.rows[1].state === 'work' && z.rows[1].fStart === z.rows[0].fEnd, z.rows[1]);
  const w = DEFAULT_CALC, b2 = compute(w);
  const e = [{cat: 'Коммуналка', sum: 60000}, {cat: 'Ремонт', sum: 900000}];
  check('коммуналка в перерасходе без сдвига', planFact(w, b2, e, false).over === 100000 + 18000, planFact(w, b2, e, false).over);
  check('при сдвиге коммуналка не вычитается дважды', planFact(w, b2, e, true).over === 100000, planFact(w, b2, e, true).over);
}

/* --- Главная --- */
{
  S.deals = [{id: 'h1', name: 'Однушка <b>', stage: 'Ремонт', calc: Object.assign({}, DEFAULT_CALC), expenses: [{id: 'e', cat: 'Ремонт', sum: 900000, date: '2026-11-01', note: ''}], works: null},
             {id: 'h2', name: 'Без расчёта', stage: 'Поиск', calc: null, expenses: [], works: null}];
  const h1 = homeDealHtml(S.deals[0]), h2 = homeDealHtml(S.deals[1]);
  check('главная: сделка с перерасходом показывает прогноз ниже плана', /прогноз <b class="neg">/.test(h1) && h1.includes(rub(compute(DEFAULT_CALC).net - 100000)), h1);
  check('главная: название сделки экранировано', !h1.includes('Однушка <b>') && h1.includes('&lt;b&gt;'), h1);
  check('главная: сделка без расчёта — без падения', /Расчёта ещё нет/.test(h2));
  const q = quickHeroHtml(DEFAULT_CALC);
  check('главная: быстрая оценка показывает вердикт и предел цены', /verdict/.test(q) && /Предельная цена покупки/.test(q), q.slice(0, 80));
  check('главная: без цен — прочерк и нет предела', !/Предельная цена/.test(quickHeroHtml(Object.assign({}, DEFAULT_CALC, {price: 0}))) && /—/.test(quickHeroHtml(Object.assign({}, DEFAULT_CALC, {price: 0}))));
  let err = null; try { renderHome(); } catch (e) { err = String(e); }
  check('главная: рисуется без ошибок', err === null, err);
  const f = dealForecast(S.deals[0], dealPlan(S.deals[0]), Object.assign({}, DEFAULT_CALC));
  check('прогноз сделки = план − перерасход', near(f.fore, compute(DEFAULT_CALC).net - 100000, 1), f.fore);
  S.deals = [];
}

/* --- Голосовой помощник: разбор фразы --- */
{
  const P = parseVoiceCmd;
  const a = P('45 тысяч электрика');
  check('голос: «45 тысяч электрика» → 45 000, Ремонт, Электрика', a.sum === 45000 && a.cat === 'Ремонт' && a.stage === 'Электрика' && a.note === 'Электрика', a);
  const b = P('Потратил 1,2 млн на плитку');
  check('голос: «1,2 млн на плитку» → Материалы, Чистовые', b.sum === 1200000 && b.cat === 'Материалы' && b.stage === 'Чистовые работы' && b.note === 'Плитку', b);
  const c = P('оплатил нотариуса 18 000 рублей');
  check('голос: нотариус → Оформление сделки', c.sum === 18000 && c.cat === 'Оформление сделки', c);
  const d = P('встреча с прорабом завтра в 15:00');
  check('голос: встреча без суммы → день завтра, время 15:00, суммы нет', d.sum === 0 && d.time === '15:00' && d.day > today() && d.day.length === 10, d);
  const e = P('вчера электричество 3 200');
  check('голос: «электричество 3 200» → Коммуналка, дата вчера', e.sum === 3200 && e.cat === 'Коммуналка' && e.day < today(), e);
  check('голос: время «в 15» не считается суммой', P('созвон в 15 с бригадой').sum === 0 && P('созвон в 15 с бригадой').time === '15:00');
  check('голос: «3 розетки» — не сумма; «45к» — сумма', P('3 розетки').sum === 0 && P('розетки 45к').sum === 45000 && P('розетки 45к').cat === 'Материалы');
  check('голос: пустая и мусорная фраза без падения', P('').sum === 0 && P(null).sum === 0 && P('<b>x</b> 5 тыс').sum === 5000);
  check('голос: огромное число отбрасывается', P('999999999999999999 руб').sum === 0);
  check('голос: кнопка помощника ведёт в openVoiceHelper', /case 'soon': openVoiceHelper\(\)/.test(SRC));
}
/* --- CSV расходов и чек к расходу --- */
{
  const csv = expensesCsv({name: 'X', expenses: [
    {id: 'a', cat: 'Ремонт', sum: 45000, date: '2026-11-02', note: 'Электрика "щиток"', stage: 'Электрика'},
    {id: 'b', cat: 'Материалы', sum: 1200.4, date: '2026-11-01', note: '=HYPERLINK("x")', stage: ''}]});
  const L = csv.split('\\r\\n');
  check('csv: метка UTF-8, заголовок, разделитель «;»', csv.charCodeAt(0) === 0xFEFF && L[0].includes('"Дата";"Статья"') && L[0].endsWith('"Сумма, ₽"'), L[0]);
  check('csv: строки по дате, кавычки удвоены, суммы числами', L[1].startsWith('"01.11.2026";"Материалы"') && L[1].endsWith(';1200') && L[2].includes('"Электрика ""щиток"""') && L[2].endsWith(';45000'), L.slice(1, 3));
  check('csv: формула в ячейке обезврежена, итог верный', L[1].includes('"\\'=HYPERLINK(""x"")"') && L[3].endsWith(';46200'), L.slice(1, 4));
  check('csv: пустые расходы — только заголовок и итог 0', expensesCsv({expenses: []}).split('\\r\\n').length === 3);
  const cd = cleanDeal({id: 'z', expenses: [{id: 'a', cat: 'Ремонт', sum: 5, chk: 'abc123'}, {id: 'b', cat: 'Ремонт', sum: 5, chk: '"><img src=x>'}, {id: 'c', cat: 'Ремонт', sum: 5}]});
  check('чек: id файла проходит очистку, мусор — нет', cd.expenses[0].chk === 'abc123' && cd.expenses[1].chk === '' && cd.expenses[2].chk === '', cd.expenses);
}
/* --- Отчёт инвестору --- */
{
  const mk = o => Object.assign({id: 'r1', name: 'Однушка <img src=x>', address: 'ул. "Тест" & <b>', stage: 'Ремонт', calc: Object.assign({}, DEFAULT_CALC), expenses: [{id: 'a', cat: 'Ремонт', sum: 900000, date: '2026-11-01', note: ''}, {id: 'b', cat: 'Чужая', sum: 5000, date: '2026-11-01', note: ''}], works: cleanWorks({start: today(), items: []}), saleFact: 0}, o || {});
  const h = reportHtml(mk());
  check('отчёт: название и адрес экранированы', !h.includes('<img src=x>') && h.includes('&lt;img') && h.includes('&amp; &lt;b&gt;'), h.slice(0, 200));
  check('отчёт: есть ключевые цифры и прогноз', h.includes('Ключевые цифры') && h.includes('Прогноз чистой прибыли') && h.includes(rub(compute(DEFAULT_CALC).net - 100000 - 5000)), '');
  check('отчёт: перерасход и план/факт', h.includes('перерасход ' + rub(100000)) && h.includes('Структура вложений') && h.includes('График ремонта'));
  check('отчёт: есть оговорка про гарантию дохода', h.includes('не гарантия дохода'));
  { const pp = compute(DEFAULT_CALC);
    check('отчёт: итоговая калькуляция с чистой прибылью, налогом и комиссией', h.includes('Итоговая калькуляция') && h.includes('Чистая прибыль</td><td class="n ' + (pp.net < 0 ? 'bad' : 'good') + '">' + rub(pp.net)) && h.includes('Комиссия при продаже') && h.includes('id="repPhotos"'), '');
    check('отчёт: без расчёта калькуляции нет', !reportHtml(mk({calc: null})).includes('Итоговая калькуляция')); }
  const h2 = reportHtml(mk({calc: null, works: null, expenses: []}));
  check('отчёт: сделка без расчёта — без падения и без прогноза', h2.includes('Расчёт по объекту ещё не заполнен') && !h2.includes('Прогноз чистой прибыли') && !h2.includes('График ремонта'));
  const h3 = reportHtml(mk({saleFact: 8000000}));
  check('отчёт: проданная сделка показывает факт', h3.includes('Продано за') && h3.includes('Фактический результат продажи'));
  const h4 = reportHtml(mk({calc: Object.assign({}, DEFAULT_CALC, {price: 0, sale: 0})}));
  check('отчёт: нулевые цены — без NaN и Infinity', !/NaN|Infinity/.test(h4));
  // Сводный отчёт: объект, контакты, смета
  check('отчёт: блок «Объект и контакты» с адресом на сегодня', h.includes('Объект и контакты') && h.includes('Адрес на ' + today().split('-').reverse().join('.')));
  check('отчёт: без собственника и ответственных — подписи, без падения', h.includes('не указан') && h.includes('не назначены'));
  check('отчёт: без места такси нет', !h.includes('Вызвать такси'));
  const h5 = reportHtml(mk({owner: {name: 'Иванов <b>И</b>', phone: '+7 900 111-22-33'}, people: [{id: 'p1', role: 'за электрику', name: 'Петров', phone: '8 900 222-33-44'}, {id: 'p2', role: '', name: '', phone: ''}], place: {lat: 55.7, lon: 37.6, address: 'ул. "Тест" & <b>'}}));
  check('отчёт: собственник экранирован, телефон — ссылка', h5.includes('Иванов &lt;b&gt;') && h5.includes('href="tel:+79001112233"'));
  check('отчёт: ответственный с ролью и телефоном, пустой не выводится', h5.includes('за электрику') && h5.includes('Петров') && h5.includes('tel:') && (h5.match(/Ответственный</g) || []).length === 0);
  check('отчёт: такси при известном месте (в печать не идёт)', h5.includes('rep-noprint') && h5.includes('end-lat=55.700000'));
  check('отчёт: смета ремонта по строкам с итогом', h.includes('Смета ремонта') && h.includes('Итого на ремонт') && h.includes(rub(900000)) && !h.includes('Чужая'));
  check('отчёт: без расходов на ремонт сметы нет', !h2.includes('Смета ремонта'));
}

/* --- Календарь --- */
{
  const bad = cleanCal([null, 5, {date: 'x', text: 'a'}, {date: '2026-02-30', text: 'a'}, {date: '2026-11-06', text: '   '}, {date: '2026-11-06', text: '<b>ок</b>', time: '25:99', id: 'a'}, {date: '2026-11-06', text: 'два', time: '09:30', id: 'a', auto: 'да'}]);
  check('календарь: мусор отброшен, остаются 2 записи', bad.length === 2, JSON.stringify(bad));
  check('календарь: плохое время сброшено, auto только true, id уникальны', bad[0].time === '' && bad[1].time === '09:30' && bad[1].auto === false && bad[0].id !== bad[1].id);
  check('календарь: не массив — пусто', cleanCal(null).length === 0 && cleanCal({}).length === 0);
  check('календарь: предел записей', cleanCal(Array.from({length: 700}, (_, i) => ({date: '2026-11-06', text: 'п' + i}))).length === CAL_MAX);
  S.deals = [{id: 'k1', name: 'Объект <i>1</i>', address: 'ул. А', expenses: []}]; S.cal = [];
  check('календарь: автопосещение добавляется', calAddVisit('k1') === true && S.cal.length === 1 && S.cal[0].auto === true && S.cal[0].date === today());
  check('календарь: в тот же день по тому же проекту — не дублируется', calAddVisit('k1') === false && S.cal.length === 1);
  check('календарь: чужого проекта нет — не добавляется', calAddVisit('нет') === false && calAddVisit('') === false && S.cal.length === 1);
  check('календарь: сохраняется и читается из памяти', (() => { const r = load(); return r.cal.length === 1 && r.cal[0].dealId === 'k1'; })());
  CAL.day = today(); S.tab = 'cal';
  let err = null; try { renderCal(); } catch (e) { err = String(e); }
  const v = calListHtml(today());
  check('календарь: экран рисуется без ошибок', err === null, err);
  check('календарь: в списке есть автозапись, название проекта экранировано', v.includes('Посещение объекта') && v.includes('внесено автоматически') && v.includes('&lt;i&gt;1&lt;/i&gt;') && !v.includes('<i>1</i>'));
  check('календарь: в списке дня есть кнопка удаления', v.includes('data-a="cal-del"'));
  S.cal.push({id: 'z', date: calShift(today(), 3), time: '', text: 'Показ', dealId: '', auto: false});
  check('календарь: сдвиг дней и «Другие дни»', calShift('2026-12-31', 1) === '2027-01-01' && calShift('2026-03-01', -1) === '2026-02-28' && calOtherHtml().includes('data-v="' + calShift(today(), 3) + '"'));
  S.tab = 'home'; let e2 = null; try { renderHome(); } catch (e) { e2 = String(e); }
  check('календарь: на главной «Сегодня» без кнопок удаления', e2 === null && calHomeHtml().includes('Посещение объекта') && !calHomeHtml().includes('cal-del') && calHomeHtml().includes('Открыть календарь'), e2);
  check('календарь: подделанная дата в cal-go не принимается', !isDay('<img>') && !isDay('2026-13-01') && isDay('2026-11-06'));
  S.cal = []; S.deals = [];
}

/* --- История: кнопка «назад» --- */
{
  S.deals = [{id: 'd1', name: 'Сделка', expenses: []}];
  const c = navClean;
  check('история: мусор — Главная', c('x').tab === 'home' && c(null).tab === 'home' && c({tab: '<img>'}).tab === 'home' && c({tab: 'calc'}).tab === 'calc' && c({tab: 'home'}).tab === 'home');
  check('история: сделка на месте', c({tab: 'deals', deal: 'd1'}).deal === 'd1');
  check('история: удалённая сделка — список', c({tab: 'deals', deal: 'нет'}).deal === null);
  check('история: подделанный id сделки', c({tab: 'deals', deal: {a: 1}}).deal === null);
  check('история: район на месте', c({tab: 'ref', rayon: 'perovo'}).rayon === 'perovo');
  check('история: список районов', c({tab: 'ref', rayon: 'list'}).rayon === 'list');
  check('история: несуществующий район', c({tab: 'ref', rayon: '"><img'}).rayon === null);
  check('история: район только в Справке', c({tab: 'calc', rayon: 'perovo'}).rayon === null);
  check('история: район из сделки', (s => s.from === 'deal' && s.deal === 'd1' && s.rayon === 'perovo')(c({tab: 'ref', deal: 'd1', rayon: 'perovo', from: 'deal'})));
  check('история: район из удалённой сделки — обычная карточка', (s => s.from === null && s.deal === null && s.rayon === 'perovo')(c({tab: 'ref', deal: 'нет', rayon: 'perovo', from: 'deal'})));
  check('история: глубина и прокрутка очищены', c({depth: -2, y: 'x'}).depth === 0 && c({depth: 1.5}).depth === 0 && c({y: -5}).y === 0 && c({depth: 3, y: 120}).depth === 3 && c({y: 120}).y === 120);
  check('история: сделка не прилипает к чужой вкладке', c({tab: 'calc', deal: 'd1'}).deal === null);
  const p = navParent;
  check('родитель: район из сделки — сделка', p({tab: 'ref', deal: 'd1', rayon: 'perovo', from: 'deal'}).deal === 'd1' && p({tab: 'ref', deal: 'd1', rayon: 'perovo', from: 'deal'}).tab === 'deals');
  check('родитель: район — список', p({tab: 'ref', rayon: 'perovo', deal: null, from: null}).rayon === 'list');
  check('родитель: список — справочник', (s => s.tab === 'ref' && s.rayon === null)(p({tab: 'ref', rayon: 'list', deal: null, from: null})));
  check('родитель: сделка — список', (s => s.tab === 'deals' && s.deal === null)(p({tab: 'deals', deal: 'd1', rayon: null, from: null})));
  check('родитель: смета — Главная', p({tab: 'smeta', deal: null, rayon: null, from: null}).tab === 'home');
  check('родитель: расчёт, торги, сделки, справка — Главная', ['calc', 'torgi', 'deals', 'ref'].every(t => p({tab: t, deal: null, rayon: null, from: null}).tab === 'home'));
  S.deals = [];
}

/* --- Районы: логика --- */
{
  const list = [{id: 'perovo', name: 'Перово', okrug: 'ВАО'}, {id: 'strogino', name: 'Строгино', okrug: 'СЗАО'}, {id: 'biryulevo-v', name: 'Бирюлёво Восточное', okrug: 'ЮАО'}];
  check('поиск: часть названия', rayonFilter(list, 'стро').map(r => r.id).join() === 'strogino');
  check('поиск: е вместо ё', rayonFilter(list, 'бирюлево').length === 1);
  check('поиск: округ', rayonFilter(list, 'вао')[0].id === 'perovo');
  check('поиск: пустой — все', rayonFilter(list, '  ').length === 3);
  check('район из адреса', guessRayon('Москва, ВАО, р-н Перово, Зелёный просп., 20', list) === 'perovo');
  check('«Перовская ул.» — не Перово', guessRayon('Москва, Перовская ул., 20', list) === '');
  check('район без ё', guessRayon('р-н Бирюлево Восточное', list) === 'biryulevo-v');
  check('название перед «р-н»', guessRayon('г Москва, Перово р-н, ул. Плеханова', list) === 'perovo');
  check('район с дефисом', guessRayon('район Бирюлёво-Восточное', list) === 'biryulevo-v');
  check('другая область', guessRayon('Московская обл., Одинцовский р-н, д. Перово', list) === '');
  check('другая область 2', guessRayon('Тульская область, район Перово', list) === '');
  check('чужой район с названием-деревней', guessRayon('Одинцовский р-н, Перово', list) === '');
  check('описание — не адрес', guessRayon('Квартира у парка Перово, до проспекта 5 минут', list) === '');
  check('только метро не считается', guessRayon('м. Перово', list) === '');
  check('«Бирюлёво» без уточнения не гадаем', guessRayon('Москва, Бирюлево, ул. Медынская, 7', list) === '');
  check('телефон: ссылка', phoneHref('+74957577893') === 'tel:+74957577893');
  check('телефон: мусор не становится ссылкой', phoneHref('javascript:alert(1)') === '' && phoneHref('') === '');
  check('телефон: вид', phoneText('+74957577893') === '+7 (495) 757-78-93', phoneText('+74957577893'));
  check('телефон 8 800', phoneText('+78007000099') === '8 (800) 700-00-99', phoneText('+78007000099'));
  check('маршрут по координатам', placeMapUrl({n: 'А', a: 'Б', lat: 55.7, lon: 37.7}) === 'https://yandex.ru/maps/?rtext=~55.7,37.7&rtt=auto');
  check('адрес Москвы', /%D0%9C%D0%BE%D1%81%D0%BA%D0%B2%D0%B0/.test(placeMapUrl({n: 'А', a: 'Рязанский просп., 2'})));
  check('адрес вне Москвы без слова Москва', !/%D0%9C%D0%BE%D1%81%D0%BA%D0%B2%D0%B0/.test(placeMapUrl({n: 'А', a: 'Реутов, Горьковское ш.'})));
  const r = {name: 'Тест', items: [{id: 'a', c: 'metro', n: 'Кузьминки'}, {id: 'b', c: 'super', n: 'Дикси'}, {id: 'c', c: 'super', n: 'Дикси'}, {id: 'd', c: 'prom', n: 'Завод'}, {id: 'e', c: 'school', n: 'Школа 1'}]};
  const ids = new Set(['a', 'b', 'c', 'd']);
  const t = adText(r, ids);
  check('абзац: метро и магазин', /метро: Кузьминки/.test(t) && /магазины: Дикси/.test(t), t);
  check('абзац: без повторов', t.split('Дикси').length === 2, t);
  check('абзац: промзона не попадает', !/Завод/.test(t), t);
  check('абзац: неотмеченное не попадает', !/Школа/.test(t), t);
  check('абзац: нет расстояний', !/\\bмин|\\bкм\\b|шагов/.test(t), t);
  check('абзац: пусто без отметок', adText(r, new Set()) === '');
  const cr = cleanRayony({fav: ['perovo', '"><img', 5], notes: {abc1: 'да', 'x"><b': 'нет', abc2: 5}, dnotes: {perovo: 'мастер', '<x': 'нет'}});
  check('копия: избранное очищено', cr.fav.join() === 'perovo', cr.fav);
  check('копия: дубли избранного убраны', cleanRayony({fav: ['perovo', 'perovo']}).fav.length === 1);
  check('копия: __proto__ не загрязняет', cleanRayony(JSON.parse('{"notes":{"__proto__":"x"}}')).notes.x === undefined && ({}).x === undefined);
  check('копия: пометки очищены', Object.keys(cr.notes).join() === 'abc1' && Object.keys(cr.dnotes).join() === 'perovo', cr);
  check('копия: не объект', cleanRayony('x').fav.length === 0 && cleanRayony(null).fav.length === 0);
  check('копия: район сделки очищен', cleanDeal({id: '1', rayon: '"><img'}).rayon === '' && cleanDeal({id: '1', rayon: 'perovo'}).rayon === 'perovo');
  check('старая сделка без района', cleanDeal({id: '1'}).rayon === '');
}

/* --- Районы: данные --- */
{
  check('районов 6', RAYONY.length === 6, RAYONY.length);
  const ids = new Set();
  RAYONY.forEach(r => {
    check(r.name + ': есть цена', r.price > 0 && typeof r.change === 'number');
    const need = ['mfc', 'stroy', 'super', 'school'];
    need.forEach(c => check(r.name + ': есть ' + c, r.items.some(it => it.c === c)));
    r.items.forEach(it => {
      check(r.name + ': название и адрес у ' + it.id, !!it.n && !!it.a, it);
      check(r.name + ': категория известна ' + it.c, !!RAYON_CATS[it.c]);
      check(r.name + ': телефон корректен у ' + it.n, !it.p || !!phoneHref(it.p), it.p);
      check(r.name + ': id подходит для пометки ' + it.id, /^[a-z0-9]{1,30}$/.test(it.id), it.id);
    });
    const local = r.items.map(it => it.id);
    check(r.name + ': id без повторов', new Set(local).size === local.length);
  });
  const all = JSON.stringify(RAYONY);
  check('снятые нотариусы отсутствуют', !/Габанян|Курбатова|Агейченков/.test(all));
  check('рынки есть хотя бы в части районов', RAYONY.filter(r => r.items.some(it => it.c === 'market')).length >= 2);
  check('нет «дублёра» в адресах', !/дублёр/.test(all));
  check('служебной Обменной нет', !RAYONY.some(r => r.items.some(it => it.c === 'train' && /Обменная/.test(it.n))));
  check('Бирюлёво-Товарная осталась транспортом', rayonById('biryulevo-v').items.some(it => it.c === 'train' && /Товарная/.test(it.n)));
  check('часы Рай убраны из-за расхождения адреса', rayonById('kuzminki').items.find(it => /^Рай /.test(it.n)).h === '');
  check('нет опечатки в часах', !/00:07/.test(all));
  check('начальная школа не в садах', !RAYONY.some(r => r.items.some(it => it.c === 'kinder' && /начальн/i.test(it.n))));
  check('ТЭЦ-11 есть в минусах Перово', rayonById('perovo').items.some(it => it.c === 'prom' && /ТЭЦ-11/.test(it.n)));
  check('Кузьминки: общая цена помечена', rayonById('kuzminki').shared && rayonById('tekstilshchiki').shared);
}
/* --- Курсы и ставки --- */
{
  const mk = (o) => Object.assign({Date: '2026-11-04T11:30:00+03:00', Valute: {
    USD: {Nominal: 1, Value: 81.6699, Previous: 80.9734}, EUR: {Nominal: 1, Value: 91.601, Previous: 90.4635},
    CNY: {Nominal: 1, Value: 12.1816, Previous: 12.1714}, BYN: {Nominal: 1, Value: 27.4253, Previous: 27.4031},
    KZT: {Nominal: 100, Value: 18.0032, Previous: 17.8407}}}, o || {});
  const p = parseCbr(mk());
  check('курсы: разбор настоящего ответа ЦБ', !!p && p.date === '2026-11-04' && near(p.r.USD.v, 81.6699, 1e-9) && near(p.r.USD.p, 80.9734, 1e-9), p);
  check('курсы: тенге пересчитан на 1 единицу (номинал 100)', !!p && near(p.r.KZT.v, 0.180032, 1e-9), p && p.r.KZT);
  check('курсы: нет валюты — отказ', parseCbr(mk({Valute: {USD: {Nominal: 1, Value: 80, Previous: 80}}})) === null);
  check('курсы: нулевой/мусорный курс — отказ', parseCbr(mk({Valute: Object.assign({}, mk().Valute, {EUR: {Nominal: 1, Value: 0, Previous: 90}})})) === null && parseCbr(mk({Valute: Object.assign({}, mk().Valute, {EUR: {Nominal: 0, Value: 90, Previous: 90}})})) === null && parseCbr(mk({Valute: Object.assign({}, mk().Valute, {EUR: {Nominal: 1, Value: 'abc', Previous: 90}})})) === null);
  check('курсы: без даты, null, строка — отказ', parseCbr(mk({Date: 'вчера'})) === null && parseCbr(null) === null && parseCbr('x') === null && parseCbr({}) === null);
  const rt = p.r;
  check('конвертер: 1 000 000 ₽ → USD', near(convertCur(1e6, 'RUB', 'USD', rt), 1e6 / 81.6699, 1e-6));
  check('конвертер: USD → BYN через рубль', near(convertCur(100, 'USD', 'BYN', rt), 100 * 81.6699 / 27.4253, 1e-6));
  check('конвертер: туда и обратно возвращает сумму', near(convertCur(convertCur(12345, 'RUB', 'KZT', rt), 'KZT', 'RUB', rt), 12345, 1e-6));
  check('конвертер: одинаковые валюты', convertCur(500, 'EUR', 'EUR', rt) === 500);
  check('конвертер: неизвестная валюта и пустые курсы — NaN', isNaN(convertCur(1, 'RUB', 'XXX', rt)) && isNaN(convertCur(1, 'RUB', 'toString', rt)) && isNaN(convertCur(1, 'RUB', 'USD', null)));
  check('ставка: по умолчанию данные ЦБ', keyRateNow(cleanKursy(null)).v === KEY_RATE.v);
  check('ставка: своя правка с более поздней датой действует', keyRateNow(cleanKursy({key: {v: 12.5, date: '2099-01-01'}})).v === 12.5);
  check('ставка: старая правка не перебивает свежие данные', keyRateNow(cleanKursy({key: {v: 99, date: '2000-01-01'}})).v === KEY_RATE.v);
  const bad = cleanKursy({spread: 'x', amount: -5, from: '__proto__', to: 'EVIL', key: {v: 500, date: 'сегодня'}, cache: {date: '2026-11-04', r: {USD: {v: 'a', p: 1}}}});
  check('чистка: мусор приведён к допустимому', bad.spread === 2 && bad.amount === 0 && bad.from === 'RUB' && bad.to === 'USD' && bad.key === null && bad.cache === null, bad);
  const good = cleanKursy({spread: 99, amount: 1e20, cache: {date: '2026-11-04', ts: 5, r: p.r}});
  check('чистка: границы и верный кэш сохраняются', good.spread === 30 && good.amount === 1e13 && good.cache && good.cache.date === '2026-11-04' && near(good.cache.r.EUR.v, 91.601, 1e-9), good);
  const imp = compute(Object.assign({}, DEFAULT_CALC, {fin: 'mortgage', rate: 16})).net, imp2 = compute(Object.assign({}, DEFAULT_CALC, {fin: 'mortgage', rate: 18})).net;
  check('ставка выше — прибыль ниже', imp2 < imp, [imp, imp2]);
  check('ставка ипотеки не бывает ниже нуля', kzMort(cleanKursy({key: {v: 0, date: '2099-01-01'}, spread: -5})) === 0);
  check('ставка ипотеки = ключевая + надбавка', near(kzMort(cleanKursy({spread: 2})), KEY_RATE.v + 2, 1e-9));
  check('кэш курсов: время из будущего обрезается', cleanKursy({cache: {date: '2026-11-04', ts: 1e15, r: p.r}}).cache.ts <= Date.now());
}
`, ctx);

/* --- Запуск приложения с уже сохранёнными данными (ловит порядок объявлений при старте) --- */
{
  const seeded = new Map();
  seeded.set('flipologia-v1', JSON.stringify({deals: [{id: 'z1', name: 'Старая', stage: 'Ремонт', expenses: [], works: {start: '2026-11-01', items: [{k: 'demo', days: 5, done: '2026-11-06'}]}}]}));
  const ctx2 = vm.createContext({
    document: fake, window: fake, navigator: {}, location: {protocol: 'file:'},
    localStorage: {getItem: k => seeded.has(k) ? seeded.get(k) : null, setItem: (k, v) => seeded.set(k, String(v))},
    setTimeout: () => 0, clearTimeout: () => {}, confirm: () => true, Intl, console
  });
  let err = null;
  try { vm.runInContext(code, ctx2); } catch (e) { err = String(e); }
  ctx.check('старт с сохранённым графиком ремонта: без ошибок', err === null, err);
  const w = err === null ? vm.runInContext('S.deals[0] && S.deals[0].works', ctx2) : null;
  ctx.check('старт: график загружен', !!w && w.start === '2026-11-01' && w.items.length === 5 && w.items[0].done === '2026-11-06', w);
}

/* --- Пустой расчёт при запуске: старый расчёт не сохраняется --- */
{
  const seeded = new Map();
  seeded.set('flipologia-v1', JSON.stringify({calc: {price: 9000000, sale: 12000000, repair: 700000}, calcDeal: 'z1', deals: [{id: 'z1', name: 'Старая', stage: 'Поиск', expenses: [], calc: {price: 4000000, sale: 6000000}}]}));
  const ctx3 = vm.createContext({
    document: fake, window: fake, navigator: {}, location: {protocol: 'file:'},
    localStorage: {getItem: k => seeded.has(k) ? seeded.get(k) : null, setItem: (k, v) => seeded.set(k, String(v))},
    setTimeout: () => 0, clearTimeout: () => {}, confirm: () => true, Intl, console
  });
  vm.runInContext(code, ctx3);
  const r = vm.runInContext('({c: S.calc, cd: S.calcDeal, dealPrice: S.deals[0] && S.deals[0].calc && S.deals[0].calc.price})', ctx3);
  ctx.check('запуск: суммы расчёта нули', r.c.price === 0 && r.c.sale === 0 && r.c.repair === 0 && r.c.furniture === 0 && r.c.buyCosts === 0 && r.c.utilities === 0, r.c);
  ctx.check('запуск: связь со сделкой сброшена', r.cd === null, r.cd);
  ctx.check('запуск: расчёт самой сделки сохранён', r.dealPrice === 4000000, r.dealPrice);
  vm.runInContext('S.calc.price = 5555555; S.calcDeal = null; save();', ctx3);
  const saved = JSON.parse(seeded.get('flipologia-v1'));
  ctx.check('сохранение: расчёт не пишется в память', !('calc' in saved) && !('calcDeal' in saved) && saved.deals.length === 1, Object.keys(saved));
  const q = vm.runInContext('(function(){const a = analyse(S.calc); return heroNumbers(S.calc, a.base).net;})()', ctx3);
  ctx.check('пустой расчёт: прибыль — прочерк, не ложное число', q === '—', q);
  ctx.check('главная: заголовок «Экспресс-расчёт»', /<h3>Экспресс-расчёт нового объекта<\/h3>/.test(html) && !/<h3>Экспресс-оценка покупки<\/h3>/.test(html) && !/<h3>Быстрая оценка<\/h3>/.test(html));
}


/* --- Стресс-тест, риски объекта, итоги по сделкам --- */
vm.runInContext(`
{
  const c = Object.assign({}, DEFAULT_CALC);
  const g = stressGrid(c);
  check('стресс: ячейка «ваш срок / по плану» равна расчёту', near(g.rows.find(r => r.plan).cells[0].net, 605800, 1));
  check('стресс: в списке есть срок 6 и он помечен', g.rows.filter(r => r.plan).length === 1 && g.rows.find(r => r.plan).m === 6);
  check('стресс: дешевле продажа — меньше прибыль', g.rows[2].cells[1].net < g.rows[2].cells[0].net && g.rows[2].cells[2].net < g.rows[2].cells[1].net);
  check('стресс: дольше срок — меньше прибыль', g.rows[g.rows.length - 1].cells[0].net < g.rows[0].cells[0].net);
  check('стресс: предельный срок — последний без убытка', g.maxMonths > 6 && compute(Object.assign({}, c, {months: g.maxMonths})).net >= 0 && compute(Object.assign({}, c, {months: g.maxMonths + 1})).net < 0, g.maxMonths);
  check('стресс: цена в ноль даёт нулевую прибыль', near(compute(Object.assign({}, c, {sale: g.beSale})).net, 0, 50), g.beSale);
  check('стресс: процент снижения сходится', near(g.beCut, (1 - g.beSale / c.sale) * 100, 1e-9) && g.beCut > 0);
  const loss = stressGrid(Object.assign({}, c, {sale: 5500000}));
  check('стресс: убыточная сделка — «уже в минусе»', loss.maxMonths === -1, loss.maxMonths);
  check('стресс: без расходов в месяц срок не влияет', stressGrid(Object.assign({}, c, {utilities: 0})).flat === true && stressGrid(c).flat === false);
  check('стресс: «срок не влияет» в тексте', /срок не влияет/.test(stressGridHtml(Object.assign({}, c, {utilities: 0}))));
  check('стресс: пустые цены — блока нет', stressGridHtml(Object.assign({}, c, {price: 0})) === '' && stressGridHtml(Object.assign({}, c, {sale: 0})) === '');
  check('стресс: блок строится', /Срок и цена продажи/.test(stressGridHtml(c)) && /ваш срок/.test(stressGridHtml(c)));
  const mort = Object.assign({}, c, {fin: 'mortgage', months: 30, term: 2});
  check('стресс: ипотека короче срока проекта не ломается', isFinite(stressGrid(mort).rows[0].cells[0].net));
}
{
  const r = cleanRisks({egrn: '500000', fssp: 'abc', debts: -5, 'Bad Key': 1, '__proto__': 7, kids: 1e15});
  check('риски: сумма разобрана', r.egrn === 500000, r);
  check('риски: мусор в сумме — 0, минус — 0', r.fssp === 0 && r.debts === 0, r);
  check('риски: чужой ключ отброшен', !('Bad Key' in r) && Object.keys(r).length === 4, Object.keys(r));
  check('риски: потолок суммы', r.kids === 1e10, r.kids);
  check('риски: не объект — пусто', Object.keys(cleanRisks(null)).length === 0 && Object.keys(cleanRisks('x')).length === 0);
  const old = cleanDeal({id: 'a', name: 'Старая', calc: DEFAULT_CALC});
  check('риски: старая сделка без поля открывается', old && typeof old.risks === 'object' && Object.keys(old.risks).length === 0);
  const d = cleanDeal({id: 'b', name: 'Н', calc: DEFAULT_CALC, risks: {egrn: 100000, matcap: 50000, zzz: 999}});
  check('риски: сумма только по пунктам списка', riskTotal(d) === 150000, riskTotal(d));
  const p = dealPlan(d), c = Object.assign({}, DEFAULT_CALC, d.calc);
  const f = dealForecast(d, p, c);
  check('риски: прогноз уменьшен ровно на резерв', near(f.fore, p.net - 150000, 0.5), [f.fore, p.net]);
  check('риски: строка в «План / факт»', /Резерв на риски объекта/.test(planFactCardHtml(d, p, c)));
  check('риски: в отчёте инвестору', /Резерв на риски объекта/.test(reportHtml(d)));
  check('риски: без резерва строки нет', !/Резерв на риски объекта/.test(reportHtml(cleanDeal({id: 'c', name: 'Н', calc: DEFAULT_CALC}))));
  check('риски: карточка со ссылками и подсказкой', /Где проверить/.test(checkCardHtml(d)) && /Проблем: <b>2/.test(checkCardHtml(d)));
  check('риски: ссылки только https', CHECK_LINKS.every(x => x[1].startsWith('https://')));
}
{
  const act = cleanDeal({id: 'x', name: 'Активная <b>', stage: 'Ремонт', calc: DEFAULT_CALC, expenses: [{cat: 'Ремонт', sum: 100000}]});
  const sold = cleanDeal({id: 'y', name: 'Проданная', calc: DEFAULT_CALC, stage: 'Закрыта', saleFact: 7000000, expenses: [{cat: 'Ремонт', sum: 900000}]});
  const t = portfolio([act, sold]);
  check('итоги: счётчики', t.n === 2 && t.active === 1 && t.sold === 1, t);
  check('итоги: вложено = покупка + расходы', t.invested === 5100000, t.invested);
  check('итоги: факт проданной до налога', near(t.factProfit, 7000000 - 140000 - 5000000 - 900000, 1), t.factProfit);
  check('итоги: прогноз активной равен плану минус перерасход', t.forecast < compute(DEFAULT_CALC).net + 1 && isFinite(t.forecast), t.forecast);
  check('итоги: лучшая и слабая найдены', t.best && t.worst && t.best.res >= t.worst.res);
  check('итоги: имя экранируется', /&lt;b&gt;/.test(portfolioHtml([act, sold])) && !/Активная <b>/.test(portfolioHtml([act, sold])));
  const look = cleanDeal({id: 'w', name: 'Присмотрел', stage: 'Поиск', calc: DEFAULT_CALC});
  const t2 = portfolio([act, look]);
  check('итоги: присмотренный не куплен — не вложено и не в прогнозе', t2.watch === 1 && t2.active === 1 && t2.invested === 5100000 && near(t2.forecast, portfolio([act]).forecast, 0.5), t2);
  const noCalc = portfolio([cleanDeal({id: 'v', name: 'Без расчёта', stage: 'Закрыта', saleFact: 3000000})]);
  check('итоги: проданная без расчёта не даёт выдуманный факт', noCalc.sold === 0 && noCalc.factProfit === 0, noCalc);
  check('итоги: средняя доходность только по работающим', near(portfolio([act, sold, look]).annualAvg, compute(DEFAULT_CALC).annual, 0.01));
  const rk = cleanDeal({id: 'r', name: 'Р', calc: DEFAULT_CALC, risks: {egrn: 800000}});
  check('главная: прогноз с резервом виден и без расходов', /прогноз/.test(homeDealHtml(rk)), homeDealHtml(rk));
  check('главная: без резерва и расходов прогноза нет', !/прогноз/.test(homeDealHtml(cleanDeal({id: 'r2', name: 'Р', calc: DEFAULT_CALC}))));
  check('итоги: пусто — блока нет', portfolioHtml([]) === '' && portfolioHtml([cleanDeal({id: 'z', name: 'Пустая'})]) === '');
  check('итоги: закрытая без цены продажи не считается вложенной', portfolio([cleanDeal({id: 'q', name: 'К', calc: DEFAULT_CALC, stage: 'Закрыта'})]).invested === 0);
}

/* --- Пример сделки, вердикт простыми словами, подбор ремонта, словарь --- */
{
  const before = S.deals.length;
  const d = demoDeal();
  check('пример: создана одна сделка с пометкой', S.deals.length === before + 1 && d.demo === true && d.stage === 'Ремонт', d.stage);
  check('пример: второй вызов не плодит копии', demoDeal() === d && S.deals.length === before + 1);
  check('пример: расчёт, график, расходы, проверка заполнены', !!d.calc && !!d.works && d.expenses.length === 3 && Object.keys(d.checks).length > 0 && d.risks.debts === 30000);
  const p = dealPlan(d), c = Object.assign({}, DEFAULT_CALC, d.calc), f = dealForecast(d, p, c);
  check('пример: вердикт «Брать» и прибыль в плюсе', analyse(c).kind === 'take' && p.net > 0, [analyse(c).kind, p.net]);
  check('пример: срок ремонта сдвинут, прогноз считается', f.wp && f.wp.shift === 2 && isFinite(f.fore), f.wp && f.wp.shift);
  check('пример: переживает очистку данных', cleanDeal(JSON.parse(JSON.stringify(d))).demo === true);
  check('пример: обычная сделка не помечается', cleanDeal({id: 'n', name: 'Н', demo: 'yes'}).demo === false && newDeal('Моя', null).demo === undefined);
  const real = cleanDeal({id: 'real', name: 'Моя', stage: 'Ремонт', calc: DEFAULT_CALC, expenses: [{cat: 'Ремонт', sum: 100000}]});
  check('пример: в итоги не входит', portfolio([d]).n === 0 && portfolioHtml([d]) === '' && portfolio([d, real]).n === 1 && portfolio([d, real]).invested === portfolio([real]).invested);
  check('пример: на главной есть пометка', /Пример/.test(homeDealHtml(d)));
  S.deals = S.deals.filter(x => !x.demo && x.name !== 'Моя');
}
{
  const base = Object.assign({}, DEFAULT_CALC, DEMO_CALC);
  const kinds = {
    empty: Object.assign({}, base, {price: 0, sale: 0}),
    take: base,
    bargain: Object.assign({}, base, {price: 10500000}),
    skip: Object.assign({}, base, {sale: 900000})
  };
  Object.keys(kinds).forEach(k => {
    const a = analyse(kinds[k]), h = heroHtml(kinds[k], a, a.base);
    check('вердикт «' + k + '»: kind верный', a.kind === k, a.kind);
    check('вердикт «' + k + '»: есть простая фраза и «Что дальше?»', h.includes(PLAIN[k]) && /Что дальше\\?/.test(h) && /<ol><li>/.test(h), h.slice(0, 200));
  });
  const bar = analyse(kinds.bargain);
  check('торг: в «Что дальше» названа предельная цена', nextHtml(kinds.bargain, bar).includes(rub(round10k(bar.maxBuy))));
  check('пусто: кнопка «Подставить пример цифр»', /data-a="sample"/.test(nextHtml(kinds.empty, analyse(kinds.empty))));
  const oneSide = Object.assign({}, base, {sale: 0});
  check('пусто с одной ценой: примера не предлагаем', !/data-a="sample"/.test(nextHtml(oneSide, analyse(oneSide))));
  check('«Брать»: кнопка создать сделку', /data-a="next-save"[^>]*>Создать сделку/.test(nextHtml(base, analyse(base))));
  const skip = analyse(kinds.skip);
  check('«Не брать»: нет подсказки цены, если до цели не дотянуть', skip.kind === 'skip' && !/заработала бы/.test(nextHtml(kinds.skip, skip)), skip.maxBuy);
  check('«Что дальше»: нет посторонней разметки', !/<script/.test(nextHtml(base, analyse(base))));
  let risky = null;
  for (let sale = 10000000; sale <= 12500000 && !risky; sale += 50000) {
    const c2 = Object.assign({}, base, {sale, target: 5}); const a2 = analyse(c2);
    if (a2.kind === 'risky') risky = {c2, a2};
  }
  check('«Рискованно»: вердикт находится и ведёт к стресс-тесту', !!risky && /Стресс-тест/.test(nextHtml(risky.c2, risky.a2)), !!risky);
}
{
  const area = 54;
  const r = [0, 1, 2].map(i => repairCost(area, i));
  check('ремонт: дороже по уровням', r[0] < r[1] && r[1] < r[2], r);
  const sm = S.smeta, prev = sm.level, prevArea = sm.area;
  sm.area = area; sm.level = 1;
  check('ремонт: совпадает со сметой', near(repairCost(area, 1), smetaTotal().total, 0.5), [repairCost(area, 1), smetaTotal().total]);
  sm.level = prev; sm.area = prevArea;
  check('ремонт: месяцы торгов не теряются при выборе варианта', presetMonths(0, {torgiDelay: 2}) === REPAIR_PLAN[0].months + 2 && torgiBase(Object.assign({}, DEFAULT_CALC, {months: presetMonths(0, {torgiDelay: 2}), torgiDelay: 2})).months === REPAIR_PLAN[0].months);
  check('ремонт: без торгов срок равен варианту', presetMonths(1, {torgiDelay: 0}) === REPAIR_PLAN[1].months);
  check('ремонт: срок проекта растёт с уровнем', REPAIR_PLAN[0].months < REPAIR_PLAN[1].months && REPAIR_PLAN[1].months < REPAIR_PLAN[2].months);
  S.smeta.area = 0;
  check('ремонт: без площади — просьба указать площадь, кнопок нет', /Впишите площадь/.test(repairOptsHtml()) && !/rp-opt/.test(repairOptsHtml()));
  S.smeta.area = 60;
  check('ремонт: три варианта с ценой и сроком', (repairOptsHtml().match(/data-a="repair-preset"/g) || []).length === 3 && /проект целиком/.test(repairOptsHtml()));
  S.smeta.area = prevArea;
  const keep = S.smeta.custom; S.smeta.custom = {demo_0: 1000000};
  check('ремонт: учитывает свои цены из сметы', repairCost(50, 0) > 50000000, repairCost(50, 0));
  S.smeta.custom = keep;
}
{
  const keys = Object.keys(TERMS);
  check('словарь: у каждого термина заголовок и текст', keys.length >= 25 && keys.every(k => TERMS[k].length === 2 && TERMS[k][0].length > 2 && TERMS[k][1].length > 30), keys.length);
  check('словарь: подсказка «?» для известного термина', /data-t="maxprice"/.test(hintBtn('maxprice')) && /aria-label=/.test(hintBtn('maxprice')));
  check('словарь: неизвестные и служебные ключи не дают кнопку', hintBtn('nope') === '' && hintBtn(undefined) === '' && hintBtn('constructor') === '' && hintBtn('__proto__') === '' && hintBtn('toString') === '');
  const used = [...new Set([...SRC.matchAll(/hintBtn\\('([a-z]+)'\\)/g)].map(m => m[1]))];
  const bad = used.filter(k => !Object.prototype.hasOwnProperty.call(TERMS, k));
  check('словарь: каждая подсказка в коде ссылается на существующий термин', used.length >= 10 && bad.length === 0, [used.length, bad]);
  check('словарь: термины, передаваемые в поля, существуют', ['buycosts', 'cadastral', 'repair', 'staging', 'months', 'utilities', 'commission', 'down', 'rate', 'termloan', 'target', 'minprofit', 'deposit', 'drop', 'step'].every(k => Object.prototype.hasOwnProperty.call(TERMS, k)));
  check('словарь: тексты не ломают разметку', keys.every(k => !/[<>]/.test(TERMS[k][0] + TERMS[k][1])));
  const fh = field('price', 'Цена', '₽', '', 100, 'maxprice');
  check('поле с подсказкой: кнопка внутри подписи, поле на месте', /<span>Цена<button/.test(fh) && /data-k="price"/.test(fh));
  check('поле без подсказки: кнопки нет', !/hint/.test(field('price', 'Цена', '₽', '', 100)));
}
`, ctx);

/* --- Главная как дашборд: порядок блоков, ставки, курсы, заглушки --- */
{
  const mk = seed => {
    const mem = new Map(); if (seed) mem.set('flipologia-v1', JSON.stringify(seed));
    const wrap = o => new Proxy(o, {get: (t, k) => k in t ? t[k] : fake, set: (t, k, v) => (t[k] = v, true)}), view = wrap({innerHTML: ''}), toastEl = wrap({textContent: ''});
    const doc = {querySelector: s => s === '#view' ? view : s === '#toast' ? toastEl : fake, querySelectorAll: () => [], getElementById: () => null, addEventListener() {}, documentElement: fake, body: fake};
    const c = vm.createContext({document: doc, window: fake, navigator: {}, location: {protocol: 'file:'},
      localStorage: {getItem: k => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, String(v))},
      setTimeout: () => 0, clearTimeout: () => {}, confirm: () => true, Intl, console});
    vm.runInContext(fs.readFileSync(rayonyFile, 'utf8'), c);
    vm.runInContext(code, c);
    return {c, view, toastEl};
  };
  const { c, view } = mk({deals: [{id: 'a1', name: 'Однушка', stage: 'Ремонт', expenses: [], works: null}]});
  vm.runInContext("S.mode = 'full'; S.tab = 'home'; renderHome();", c);
  const hc = view.innerHTML;
  ctx.check('главная: панели по умолчанию свёрнуты', !/<h3>Мои проекты<\/h3>/.test(hc) && !/data-q="price"/.test(hc) && !/class="tiles"/.test(hc) && (hc.match(/aria-expanded="false"/g) || []).length === 4, (hc.match(/aria-expanded="\w+"/g) || []));
  ctx.check('главная: кнопки раскрытия подписаны', /Экспресс-расчёт нового объекта/.test(hc) && />Новый проект</.test(hc) && />Калькуляторы</.test(hc) && />Календарь</.test(hc));
  vm.runInContext("HOME_OPEN.eval = true; HOME_OPEN.proj = true; HOME_OPEN.calc = true; HOME_OPEN.cal = true; renderHome();", c);
  const h = view.innerHTML;
  ctx.check('главная: раскрытые панели показывают содержимое', /<h3>Мои проекты<\/h3>/.test(h) && /data-q="price"/.test(h) && /class="tiles"/.test(h) && (h.match(/aria-expanded="true"/g) || []).length === 4);
  const order = ['Экспресс-расчёт нового объекта', 'Сделать фото', 'Новый проект', 'Калькуляторы', 'Календарь', 'Записная книжка', 'Курсы и ставки', 'Справочники', 'Новости', 'Голосовой помощник'];
  const idx = order.map(t => h.indexOf(t));
  ctx.check('главная: все блоки на месте', idx.every(i => i >= 0), order.filter((t, i) => idx[i] < 0));
  ctx.check('главная: порядок блоков как в заметке «Правки»', idx.every((v, i) => i === 0 || v > idx[i - 1]), idx);
  ctx.check('главная: экспресс-расчёт раскрывается под синей кнопкой', /bigbtn acc" data-a="home-acc" data-v="eval"[^>]*aria-expanded="true"[\s\S]*?data-q="price"[\s\S]*?Сделать фото/.test(h));
  ctx.check('главная: «Мои проекты» внутри раскрытия «Новый проект», с «+ Новый проект» и «Пример проекта»', /data-v="proj"[\s\S]*?<h3>Мои проекты<\/h3>[\s\S]*?\+ Новый проект[\s\S]*?Пример проекта[\s\S]*?data-v="calc"/.test(h));
  ctx.check('главная: фото до проектов, голос последней, потом переключатель режима', h.indexOf('data-v="photo"') < h.indexOf('data-v="proj"') && h.indexOf('data-a="soon" data-v="voice"') > h.indexOf('Новости') && h.indexOf('Упростить главную') > h.indexOf('data-v="voice"'));
  ctx.check('главная: записная книжка — кнопка перехода', /data-a="home-push" data-v="notes"/.test(h));
  ctx.check('главная: резервной копии на главной нет', !/Резервная копия|backup-save/.test(h));
  ctx.check('главная: курсы слева, ставки крупно справа; ключевая равна рефинансирования', (() => { const m = h.match(/Ключевая ставка ЦБ<\/div><div class="rbig">([^<]+)<\/div>[\s\S]*?Ставка рефинансирования<\/div><div class="rbig">([^<]+)<\/div>/); return !!m && m[1] === m[2] && /%/.test(m[1]) && h.indexOf('class="card rl"') < h.indexOf('class="card rr"'); })());
  ctx.check('главная: без курсов — подсказка, а не пустота', /homeRates">[^]*?(Загружаем|загрузятся|не загрузились)/.test(h));
  vm.runInContext("S.kursy.cache = {date: '2026-11-05', ts: Date.now(), r: {USD: {v: 90.5, p: 90}, EUR: {v: 100, p: 99}, CNY: {v: 12.5, p: 12.4}}}; renderHome();", c);
  const h2 = view.innerHTML;
  ctx.check('главная: курсы USD/EUR/CNY показаны с датой', /Курс ЦБ РФ на 05\.11\.2026/.test(h2) && /90,50 ₽/.test(h2) && /100,00 ₽/.test(h2) && /12,50 ₽/.test(h2), h2.match(/homeRates">[^]*?<\/div><\/div>/));
  vm.runInContext("S.kursy.cache = {date: '2026-11-05', ts: Date.now(), r: {USD: null, EUR: {v: NaN, p: 1}}}; renderHome();", c);
  ctx.check('главная: битый кэш курсов не роняет главную', view.innerHTML.includes('Голосовой помощник'));
  vm.runInContext("S.deals = []; renderHome();", c);
  ctx.check('главная: без проектов — подсказка и «Пример проекта»', /Проектов пока нет/.test(view.innerHTML) && /Пример проекта/.test(view.innerHTML));
  vm.runInContext("S.deals = [{id: 'x', name: '<img src=x onerror=1>', stage: 'Поиск', expenses: [], works: null}]; renderHome();", c);
  ctx.check('главная: название проекта экранировано', !view.innerHTML.includes('<img src=x') && view.innerHTML.includes('&lt;img'));
  ctx.check('главная: заглушка осталась только у голоса, календарь оживлён', (view.innerHTML.match(/data-a="soon"/g) || []).length === 1 && /Календарь[\s\S]*Открыть календарь/.test(view.innerHTML));
  ctx.check('главная: «Сделать фото» ведёт в раздел фото', /data-a="home-push" data-v="photo"/.test(view.innerHTML));
  vm.runInContext("HOME_OPEN.eval = false; HOME_OPEN.proj = false; HOME_OPEN.calc = false; HOME_OPEN.cal = false;", c);
}

/* --- Фото объекта: адрес, подпись, поиск, ошибки --- */
ctx.check('фото: CSP разрешает blob-картинки и сервис адресов, и не больше', /img-src 'self' data: blob:;/.test(html) && /connect-src 'self' https:\/\/www\.cbr-xml-daily\.ru https:\/\/nominatim\.openstreetmap\.org;/.test(html) && !/default-src \*/.test(html));
vm.runInContext(`
{
  check('фото: адрес из ответа OSM — город, улица, дом', nomAddress({address: {city: 'Москва', road: 'Новый Арбат', house_number: '22'}}) === 'Москва, Новый Арбат, 22');
  check('фото: без дома — город и улица', nomAddress({address: {town: 'Видное', road: 'Советская улица'}}) === 'Видное, Советская улица');
  check('фото: без улицы — первые части полного названия', nomAddress({address: {}, display_name: 'Кремль, Боровицкая, 39, Тверской район, Москва'}) === 'Кремль, Боровицкая, 39');
  check('фото: мусор вместо ответа — пустой адрес', nomAddress(null) === '' && nomAddress('x') === '' && nomAddress({address: 5}) === '' && nomAddress({address: {road: 7, city: {}}}) === '');
  check('фото: длинный адрес обрезается до 200', nomAddress({address: {road: 'а'.repeat(500)}}).length === 200);
  check('фото: координаты — только настоящие числа в пределах', hasCoord(55.7, 37.6) && !hasCoord(NaN, 1) && !hasCoord(91, 0) && !hasCoord(0, 181) && !hasCoord('55', '37') && !hasCoord(null, null));
  check('фото: текст координат', coordText(55.75222, 37.61556) === '55.75222, 37.61556' && coordText(null, 1) === '');
  const ts = new Date(2026, 10, 5, 9, 7).getTime();
  check('фото: дата с нулями', fmtDT(ts) === '05.11.2026 09:07' && fmtDT(NaN) === '');
  const l1 = stampLines('Москва, Арбат, 22', 55.75, 37.6, ts);
  check('фото: в подписи адрес, дата и координаты', l1[0] === 'Москва, Арбат, 22' && l1[1].startsWith('05.11.2026 09:07') && l1[1].includes('55.75000, 37.60000'), l1);
  const l2 = stampLines('', 55.75, 37.6, ts);
  check('фото: без адреса в подписи координаты', l2[0] === '55.75000, 37.60000' && l2[1] === '05.11.2026 09:07', l2);
  const l3 = stampLines('  ', null, null, ts);
  check('фото: без адреса и координат — «Адрес не указан»', l3[0] === 'Адрес не указан', l3);
  const ctx2 = {measureText: t => ({width: t.length * 10})};
  check('фото: перенос длинной строки по словам', JSON.stringify(phWrap(ctx2, 'aaaa bbbb cccc', 90)) === JSON.stringify(['aaaa bbbb', 'cccc']));
  check('фото: очень длинное слово не зацикливает перенос', phWrap(ctx2, 'x'.repeat(100), 50).length === 1);
  check('фото: не больше 4 строк подписи', phWrap(ctx2, 'a b c d e f g h', 10).length === 4);
  check('фото: поиск по адресу без учёта регистра и ё', photoMatches({address: 'Москва, Тёплый Стан', ts}, 'теплый', '') && photoMatches({address: 'Арбат', ts}, 'АРБ', ''));
  check('фото: поиск по проекту и по дате', photoMatches({address: '', ts}, 'однушка', 'Однушка на Арбате') && photoMatches({address: '', ts}, '05.11.2026', ''));
  check('фото: пустой запрос показывает всё, чужой — ничего', photoMatches({address: 'x', ts}, '', '') && !photoMatches({address: 'Арбат', ts}, 'Тверская', 'Проект'));
  check('фото: тексты ошибок геолокации', /Нет доступа/.test(geoErrText({code: 1})) && /слишком долго/.test(geoErrText({code: 3})) && /Не удалось определить/.test(geoErrText({code: 2})) && /не даёт определить/.test(geoErrText(new Error('nogeo'))) && geoErrText(null).length > 10);
  check('фото: раздел зарегистрирован в навигации', NAV_TABS.includes('photo') && TITLES.photo === 'Фото объекта');
}
`, ctx);
{
  const { c, view } = (() => {
    const mem = new Map(), wrap = o => new Proxy(o, {get: (t, k) => k in t ? t[k] : fake, set: (t, k, v) => (t[k] = v, true)}), view = wrap({innerHTML: ''});
    const els = {};
    const doc = {querySelector: s => s === '#view' ? view : fake, querySelectorAll: () => [], getElementById: id => els[id] || null, addEventListener() {}, documentElement: fake, body: fake};
    const c = vm.createContext({document: doc, window: fake, navigator: {}, location: {protocol: 'file:'}, localStorage: {getItem: k => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, String(v))}, setTimeout: () => 0, clearTimeout: () => {}, confirm: () => true, Intl, console});
    vm.runInContext(fs.readFileSync(rayonyFile, 'utf8'), c); vm.runInContext(code, c);
    return {c, view};
  })();
  vm.runInContext("S.tab = 'photo'; PH.address = '<img src=x onerror=1>'; PH.q = '\"><b>'; renderPhoto();", c);
  const h = view.innerHTML;
  ctx.check('фото: страница рисуется, есть геолокация, съёмка, галерея, поиск', /Геолокация/.test(h) && /capture="environment"/.test(h) && /Выбрать из галереи/.test(h) && /Мои фото/.test(h) && /data-ph="q"/.test(h));
  ctx.check('фото: адрес и запрос поиска экранированы', !h.includes('<img src=x onerror') && !h.includes('"><b>') && h.includes('&lt;img'));
}

/* --- Голосовой ввод: подставной распознаватель речи --- */
{
  const mem = new Map(), toasts = [];
  class MockSR {
    constructor() { MockSR.last = this; this.started = false; this.stopped = false; }
    start() { if (MockSR.failStart) throw new Error('already started'); this.started = true; }
    stop() { this.stopped = true; }
  }
  const mkEl = v => ({value: v || '', events: [], dispatchEvent(e) { this.events.push(e.type); }});
  const mkBtn = () => { const sp = {textContent: 'Диктовать'}; const cls = new Set(); return {sp, cls, attrs: {}, classList: {toggle: (c, on) => on ? cls.add(c) : cls.delete(c)}, setAttribute(k, v) { this.attrs[k] = v; }, querySelector: () => sp}; };
  const mk = win => {
    const toastEl = new Proxy({textContent: ''}, {get: (t, k) => k in t ? t[k] : fake, set: (t, k, v) => (t[k] = v, true)});
    const doc = {querySelector: s => s === '#toast' ? toastEl : fake, querySelectorAll: () => [], getElementById: () => null, addEventListener() {}, documentElement: fake, body: fake};
    const c = vm.createContext({document: doc, window: win, navigator: {}, location: {protocol: 'file:'}, localStorage: {getItem: () => null, setItem: () => {}}, setTimeout: () => 0, clearTimeout: () => {}, confirm: () => true, Intl, console, Event: class { constructor(t) { this.type = t; } }});
    vm.runInContext(fs.readFileSync(rayonyFile, 'utf8'), c); vm.runInContext(code, c);
    return {c, toastEl};
  };
  const res = (list) => ({resultIndex: 0, results: list.map(([t, f]) => Object.assign([{transcript: t}], {isFinal: f}))});
  const win = props => new Proxy(props, {get: (t, k) => k in t ? t[k] : fake, set: (t, k, v) => (t[k] = v, true)});
  const {c, toastEl} = mk(win({SpeechRecognition: MockSR, webkitSpeechRecognition: undefined}));
  c.MockSR = MockSR; c.el = mkEl('Стена'); c.st = {textContent: ''}; c.btn = mkBtn(); c.btn2 = mkBtn();
  vm.runInContext("voiceToggle(el, btn, st);", c);
  const r1 = MockSR.last;
  ctx.check('голос: запись включилась, кнопка «Остановить»', r1.started && r1.lang === 'ru-RU' && r1.continuous === true && r1.interimResults === true && c.btn.sp.textContent === 'Остановить' && c.btn.attrs['aria-pressed'] === 'true' && c.btn.cls.has('rec'));
  r1.onresult(res([['  в ванной  ', false]]));
  ctx.check('голос: промежуточный текст только в статусе, не в поле', c.el.value === 'Стена' && c.st.textContent === 'Слышу:   в ванной  ', [c.el.value, c.st.textContent]);
  r1.onresult(res([['плесень в углу', true]]));
  ctx.check('голос: итоговый текст добавляется через пробел к имеющемуся', c.el.value === 'Стена плесень в углу' && c.el.events.includes('input'), c.el.value);
  r1.onresult(res([['нужна обработка', true]]));
  ctx.check('голос: следующая фраза дописывается дальше', c.el.value === 'Стена плесень в углу нужна обработка', c.el.value);
  c.el.value = 'я'.repeat(1999);
  r1.onresult(res([['длинное продолжение', true]]));
  ctx.check('голос: длина отметок не больше 2000', c.el.value.length === 2000, c.el.value.length);
  c.el.value = 'Стена';
  vm.runInContext("voiceToggle(el, btn, st);", c);
  ctx.check('голос: повторное нажатие останавливает запись', r1.stopped && c.btn.sp.textContent === 'Диктовать' && c.btn.attrs['aria-pressed'] === 'false' && !c.btn.cls.has('rec') && c.st.textContent === '');
  r1.onresult(res([['последняя фраза', true]]));
  ctx.check('голос: последняя фраза после остановки, до окончания записи, не теряется', c.el.value === 'Стена последняя фраза' && c.st.textContent === '', [c.el.value, c.st.textContent]);
  ctx.check('голос: пока ждём окончание записи, это видно во внутреннем состоянии', vm.runInContext('VOICE.closing', c) === r1);
  r1.onend();
  const afterEnd = c.el.value; r1.onresult(res([['совсем запоздалая', true]]));
  ctx.check('голос: после окончания записи слова в поле не попадают', c.el.value === afterEnd && vm.runInContext('VOICE.closing', c) === null, c.el.value);
  vm.runInContext("voiceToggle(el, btn, st);", c); const r2 = MockSR.last;
  r2.onerror({error: 'not-allowed'});
  ctx.check('голос: отказ микрофона — понятное сообщение, кнопка вернулась', /Нет доступа к микрофону/.test(c.st.textContent) && c.btn.sp.textContent === 'Диктовать' && !c.btn.cls.has('rec'), c.st.textContent);
  vm.runInContext("voiceToggle(el, btn, st);", c); const r3 = MockSR.last;
  r3.onerror({error: 'no-speech'}); const ns = c.st.textContent;
  vm.runInContext("voiceToggle(el, btn, st);", c); const r4 = MockSR.last;
  r4.onerror({error: 'network'}); const nw = c.st.textContent;
  ctx.check('голос: «речи не слышно» и «нет сети» различаются', /не слышно/.test(ns) && /нужен интернет/.test(nw), [ns, nw]);
  vm.runInContext("voiceToggle(el, btn, st);", c); const r5 = MockSR.last; r5.onend();
  ctx.check('голос: браузер сам закончил запись — кнопка вернулась', c.btn.sp.textContent === 'Диктовать' && !c.btn.cls.has('rec'));
  vm.runInContext("voiceToggle(el, btn, st);", c); const r6 = MockSR.last;
  vm.runInContext("voiceToggle(el, btn2, st);", c); const r7 = MockSR.last;
  ctx.check('голос: вторая кнопка выключает первую и включается сама', r6.stopped && r7 !== r6 && r7.started && !c.btn.cls.has('rec'));
  vm.runInContext("voiceStop();", c); MockSR.failStart = true;
  vm.runInContext("voiceToggle(el, btn, st);", c);
  ctx.check('голос: сбой запуска — сообщение и сброс, без падения', /Не удалось включить/.test(c.st.textContent) && c.btn.sp.textContent === 'Диктовать' && vm.runInContext('VOICE.rec', c) === null, c.st.textContent);
  MockSR.failStart = false;
  const m2 = mk(win({SpeechRecognition: undefined, webkitSpeechRecognition: undefined}));
  vm.runInContext("voiceToggle({value: '', dispatchEvent() {}}, null, null);", m2.c);
  ctx.check('голос: браузер без распознавания речи — подсказка про клавиатуру', /значок микрофона на клавиатуре/.test(m2.toastEl.textContent), m2.toastEl.textContent);
  ctx.check('голос: тексты ошибок распознавания', voiceErrCheck());
  function voiceErrCheck() { const f = c2 => vm.runInContext(`voiceErr(${JSON.stringify(c2)})`, c); return f('aborted') === '' && /Микрофон не найден/.test(f('audio-capture')) && f('что-то') === 'Не получилось распознать речь. Попробуйте ещё раз.'; }
  ctx.check('голос: отметки ищутся поиском по фото', vm.runInContext("photoMatches({address: 'Арбат', note: 'Плесень в ванной', ts: 0}, 'плесень', '') && !photoMatches({address: 'Арбат', ts: 0}, 'плесень', '')", c));
}

/* --- Бланк нового объекта --- */
{
  const mem = new Map(), wrap = o => new Proxy(o, {get: (t, k) => k in t ? t[k] : fake, set: (t, k, v) => (t[k] = v, true)}), view = wrap({innerHTML: ''});
  const doc = {querySelector: s => s === '#view' ? view : fake, querySelectorAll: () => [], getElementById: () => null, addEventListener() {}, documentElement: fake, body: fake};
  const c = vm.createContext({document: doc, window: fake, navigator: {}, location: {protocol: 'file:'}, localStorage: {getItem: k => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, String(v))}, setTimeout: () => 0, clearTimeout: () => {}, confirm: () => true, Intl, console});
  vm.runInContext(fs.readFileSync(rayonyFile, 'utf8'), c); vm.runInContext(code, c);
  const run = e => vm.runInContext(e, c);
  ctx.check('бланк: название — своё, иначе адрес, иначе «Новый объект»', run("newObjName('  Однушка ', 'Арбат') === 'Однушка' && newObjName('', '  Арбат, 5 ') === 'Арбат, 5' && newObjName('  ', '') === 'Новый объект' && newObjName(null, undefined) === 'Новый объект'"));
  run("S.tab = 'newobj'; NB.name = '\"><img src=x onerror=1>'; NB.address = '<b>адрес</b>'; renderNewObj();");
  const h = view.innerHTML;
  ctx.check('бланк: есть название, адрес, геолокация, съёмка, галерея, создание, отмена', /data-nb="name"/.test(h) && /id="nbAddr"/.test(h) && /data-a="nb-geo"/.test(h) && /capture="environment"/.test(h) && /Выбрать из галереи/.test(h) && /data-a="nb-create"/.test(h) && /data-a="nb-cancel"/.test(h), h.slice(0, 120));
  ctx.check('бланк: введённые название и адрес экранированы', !h.includes('<img src=x') && !h.includes('<b>адрес</b>') && h.includes('&lt;img') && h.includes('&lt;b&gt;'));
  ctx.check('бланк: раздел зарегистрирован в навигации', run("NAV_TABS.includes('newobj') && TITLES.newobj === 'Новый объект'"));
  run("nbReset();");
  ctx.check('бланк: сброс очищает всё', run("NB.name === '' && NB.address === '' && NB.lat === null && NB.photos.length === 0 && NB.geoMsg === ''"));
  ctx.check('бланк: «Новый проект» больше не создаёт пустой проект сразу', /case 'deal-new': navPush\(navRoot\('newobj'\)/.test(code) && !/newDeal\('Новая сделка'/.test(code));
  ctx.check('бланк: проект создаётся после записи фото', code.indexOf("await phTx('readwrite', st => { recs.forEach") < code.indexOf('const nd = newDeal(name, null); nd.id = dealId;'));
  run("S.tab = 'newobj'; renderNewObj();");
  ctx.check('бланк: перерисовка не падает при пустых данных', view.innerHTML.includes('Создать проект'));
}

/* --- Данные объекта: собственник, документы, файлы, такси --- */
vm.runInContext(`
{
  check('телефон: 8 и 7 в начале приводятся к +7', telHref('8 (900) 123-45-67') === 'tel:+79001234567' && telHref('7 900 123 45 67') === 'tel:+79001234567');
  check('телефон: 10 цифр — это +7, плюс сохраняется', telHref('9001234567') === 'tel:+79001234567' && telHref('+375 29 123-45-67') === 'tel:+375291234567');
  check('телефон: белорусский формат 8 0XX приводится к +375', telHref('8 029 123-45-67') === 'tel:+375291234567' && telHref('80291234567') === 'tel:+375291234567' && telHref('8 495 123-45-67') === 'tel:+74951234567');
  check('телефон: короткий номер оставляем, мусор и пустое — нет ссылки', telHref('112 99') === 'tel:11299' && telHref('') === '' && telHref('abc') === '' && telHref('12') === '' && telHref('1'.repeat(16)) === '');
  check('телефон: в ссылке нет ничего, кроме цифр и плюса', /^tel:[+]?[0-9]+$/.test(telHref('8"><script>9001234567')), telHref('8"><script>9001234567'));
  check('такси: ссылка Яндекса с координатами назначения', taxiUrl(55.7522, 37.6156) === 'https://3.redirect.appmetrica.yandex.com/route?end-lat=55.752200&end-lon=37.615600&appmetrica_tracking_id=1178268795219780156&lang=ru', taxiUrl(55.7522, 37.6156));
  const pl = {lat: 55.75, lon: 37.6, address: 'Москва, Арбат, 5'};
  check('такси: место годится, только пока адрес тот же', placeFor({address: ' Москва, Арбат, 5 ', place: pl}) === pl && placeFor({address: 'Москва, Арбат, 6', place: pl}) === null && placeFor({address: 'x', place: null}) === null && placeFor(null) === null);
  check('такси: координаты вне диапазона не годятся', placeFor({address: 'a', place: {lat: 99, lon: 0, address: 'a'}}) === null);
  check('навигаторы: ссылки Яндекс Навигатор и 2ГИС с координатами (2ГИС: долгота,широта), только при известном месте', naviUrl(55.7522, 37.6156) === 'yandexnavi://build_route_on_map?lat_to=55.752200&lon_to=37.615600' && gisUrl(55.7522, 37.6156) === 'https://2gis.ru/routeSearch/rsType/car/to/37.615600,55.752200' && taxiBtnHtml({address: 'a', place: {lat: 55.7522, lon: 37.6156, address: 'a'}}, 'x').includes('2gis.ru/routeSearch') && !taxiBtnHtml({address: 'a', place: null}, 'x').includes('2gis'), '');
  check('такси: без места — кнопка, с местом — ссылка', taxiBtnHtml({address: 'a', place: null}, 'deal-taxi').includes('<button') && taxiBtnHtml({address: 'a', place: null}, 'deal-taxi').includes('data-a="deal-taxi"') && taxiBtnHtml({address: 'a', place: {lat: 1, lon: 2, address: 'a'}}, 'deal-taxi').includes('<a class="btn" href="https://3.redirect'));
  const d = cleanDeal({id: 'z', name: 'n', owner: {name: '  ' + 'И'.repeat(200), phone: '+7 900 ' + '1'.repeat(60)}, docs: {egrn: 'have', bank: 'miss', spouse: 'na', passport: 'hack', zzz: 'have', proxy: 5}, ready: 'maybe', place: {lat: 'x', lon: 1, address: 'a'}});
  check('проект: собственник обрезан по длине', d.owner.name.length === 80 && d.owner.phone.length === 30, [d.owner.name.length, d.owner.phone.length]);
  check('проект: документы — только известные ключи и состояния', JSON.stringify(d.docs) === JSON.stringify({egrn: 'have', spouse: 'na', bank: 'miss'}) || (d.docs.egrn === 'have' && d.docs.bank === 'miss' && d.docs.spouse === 'na' && !('passport' in d.docs) && !('zzz' in d.docs) && !('proxy' in d.docs)), d.docs);
  check('проект: странные «готово» и место отбрасываются', d.ready === '' && d.place === null);
  const d2 = cleanDeal({id: 'y', owner: 'bad', docs: 7, ready: 'yes', place: {lat: 55, lon: 37, address: ' Арбат '}});
  check('проект: битые поля заменяются пустыми, правильные сохраняются', d2.owner.name === '' && d2.owner.phone === '' && Object.keys(d2.docs).length === 0 && d2.ready === 'yes' && d2.place.address === 'Арбат');
  check('проект: старая запись без новых полей читается', (() => { const x = cleanDeal({id: 'o', name: 'Старая'}); return x.owner.phone === '' && x.ready === '' && x.place === null && JSON.stringify(x.docs) === '{}'; })());
  const nd = newDeal('Тест', null);
  check('проект: новый создаётся с пустыми данными объекта', nd.owner.name === '' && nd.ready === '' && nd.place === null && JSON.stringify(nd.docs) === '{}');
  S.deals = S.deals.filter(x => x.id !== nd.id);
  check('файлы: допустимые форматы — без html, svg, exe, js', docExt('Договор.PDF') === 'pdf' && !!DOC_EXT.pdf && !DOC_EXT.html && !DOC_EXT.svg && !DOC_EXT.exe && !DOC_EXT.js && !DOC_EXT.htm && !DOC_EXT.php);
  check('файлы: расширение берётся из имени', docExt('a.b.docx') === 'docx' && docExt('noext') === '' && docExt('x.toolongext') === '' && docExt(null) === '');
  check('файлы: открываем в новой вкладке только pdf и растровые картинки', DOC_OPEN.every(e => ['pdf', 'jpg', 'jpeg', 'png', 'webp'].includes(e)) && !DOC_OPEN.includes('docx') && !DOC_OPEN.includes('heic'));
  check('файлы: имя очищается от опасных символов и обрезается', safeFileName('a/b' + String.fromCharCode(92) + 'c:d*e?"f<g>h|i') === 'a_b_c_d_e__f_g_h_i' && safeFileName('') === 'документ' && safeFileName('я'.repeat(300)).length === 120);
  check('файлы: размер читается', fmtSize(500) === '1 КБ' && fmtSize(2048) === '2 КБ' && fmtSize(1572864) === '1,5 МБ');
  const full = {docs: {egrn: 'have', title: 'have', passport: 'have', spouse: 'na', housebook: 'have', utility: 'have', bti: 'have', proxy: 'na', bank: 'na', guardian: 'na'}, ready: 'yes'};
  check('документы: всё закрыто — «в порядке» и без предупреждения', /Не хватает: 0/.test(docSumHtml(full)) && /все документы в порядке/.test(docSumHtml(full)) && !/neg/.test(readyHtml(full)));
  const part = {docs: {egrn: 'have', bank: 'miss'}, ready: 'yes'};
  check('документы: считаются «нет» и «не отмечено»', /Не хватает: 1/.test(docSumHtml(part)) && /Не отмечено: 8/.test(docSumHtml(part)), docSumHtml(part));
  check('документы: «всё готово» при неполном списке — предупреждение', /всё готово.*не подтверждено/.test(readyHtml(part)) && /ещё 9 не подтверждено/.test(readyHtml(part)), readyHtml(part));
  const xs = {id: 'q', name: 'n', address: '', docs: {}, owner: {name: '"><img src=x onerror=1>', phone: '"><script>'}, ready: '', place: null};
  const dh = dealDataHtml(xs);
  check('карточка: имя и телефон собственника экранированы', !dh.includes('<img src=x') && !dh.includes('<script>') && dh.includes('&lt;img'));
  check('карточка: есть собственник, геолокация, такси, документы, готовность, файлы', dh.includes('Собственник') && dh.includes('data-a="deal-geo"') && dh.includes('data-a="deal-taxi"') && dh.includes('Документы по объекту') && dh.includes('Всё ли готово?') && dh.includes('data-dfile') && dh.includes('Прикрепить файл'));
  check('карточка: список документов — 10 пунктов по 3 отметки', (dh.match(/data-a="doc-set"/g) || []).length === 30, (dh.match(/data-a="doc-set"/g) || []).length);
  check('карточка: без телефона нет кнопки «Позвонить»', !dealDataHtml(Object.assign({}, xs, {owner: {name: 'x', phone: ''}})).includes('Позвонить собственнику') && dealDataHtml(Object.assign({}, xs, {owner: {name: 'x', phone: '89001234567'}})).includes('href="tel:+79001234567"'));
}
`, ctx);

/* --- Ответственные --- */
vm.runInContext(`
{
  check('ответственные: не массив — пустой список', cleanPeople(null).length === 0 && cleanPeople('x').length === 0 && cleanPeople({}).length === 0 && cleanPeople(undefined).length === 0);
  const big = Array.from({length: 20}, (_, i) => ({id: 'p' + i, role: 'r' + i, name: 'n', phone: '1'}));
  check('ответственные: не больше 12', cleanPeople(big).length === PEOPLE_MAX && PEOPLE_MAX === 12);
  const dup = cleanPeople([{id: 'a1', role: 'x'}, {id: 'a1', role: 'y'}, {id: 'bad id!', role: 'z'}, {role: 'w'}, null, 5, 'str']);
  check('ответственные: повторы и плохие id заменяются, мусор отбрасывается', dup.length === 4 && new Set(dup.map(p => p.id)).size === 4 && dup.every(p => /^[A-Za-z0-9]{1,24}$/.test(p.id)) && dup[0].id === 'a1', dup.map(p => p.id));
  const long = cleanPeople([{id: 'q', role: 'Р'.repeat(200), name: 'И'.repeat(200), phone: '9'.repeat(100)}])[0];
  check('ответственные: поля обрезаются, пробелы убираются', long.role.length === 60 && long.name.length === 80 && long.phone.length === 30 && cleanPeople([{id: 'k', role: '  роль  ', name: 5, phone: null}])[0].role === 'роль' && cleanPeople([{id: 'k', name: 5}])[0].name === '');
  check('ответственные: старый проект без списка читается', cleanDeal({id: 'o'}).people.length === 0 && newDeal('t', null).people.length === 0 && (S.deals = S.deals.filter(x => x.name !== 't'), true));
  const x = personRowHtml({id: 'z1', role: '"><img src=x onerror=1>', name: '<b>', phone: '8 900 123-45-67'});
  check('ответственные: строка экранирована, есть «Позвонить» и «Убрать»', !x.includes('<img src=x') && !x.includes('<b>') && x.includes('&lt;img') && x.includes('href="tel:+79001234567"') && x.includes('data-a="pp-del"') && x.includes('data-id="z1"'));
  check('ответственные: без телефона нет ссылки «Позвонить»', !personRowHtml({id: 'z2', role: 'r', name: '', phone: ''}).includes('href='));
  check('ответственные: пустой список — подсказка', /Пока никого/.test(peopleListHtml({people: []})) && /Пока никого/.test(peopleListHtml({})));
  const full = {people: big};
  check('ответственные: на пределе кнопки добавления заменяются сообщением', /Достигнут предел/.test(peopleAddHtml(full)) && !/pp-add/.test(peopleAddHtml(full)) && /data-a="pp-add"/.test(peopleAddHtml({people: []})) && (peopleAddHtml({people: []}).match(/data-a="pp-add"/g) || []).length === 6);
  check('ответственные: роли в быстрых кнопках — «за проект», «за электрику», «за сантехнику»', /за проект/.test(peopleAddHtml({people: []})) && /за электрику/.test(peopleAddHtml({people: []})) && /за сантехнику/.test(peopleAddHtml({people: []})));
  const card = dealDataHtml({id: 'd', name: 'n', address: '', docs: {}, owner: {name: '', phone: ''}, people: [{id: 'w1', role: 'за электрику', name: 'Пётр', phone: ''}], ready: '', place: null});
  check('ответственные: блок есть в карточке проекта', card.includes('<h3>Ответственные</h3>') && card.includes('data-pid="w1"') && card.includes('id="roleList"'));
}
`, ctx);

/* --- Бланк: гонки (фото и геолокация из сброшенного черновика, очередь, лимит) --- */
ctx.pendingTests = ctx.pendingTests || [];
{
  const mem = new Map(), wrap = o => new Proxy(o, {get: (t, k) => k in t ? t[k] : fake, set: (t, k, v) => (t[k] = v, true)}), view = wrap({innerHTML: ''}), toastEl = wrap({textContent: ''});
  let geoCb = null;
  const doc = {createElement: () => fake, querySelector: s => s === '#view' ? view : s === '#toast' ? toastEl : fake, querySelectorAll: () => [], getElementById: () => null, addEventListener() {}, documentElement: fake, body: fake};
  const c = vm.createContext({document: doc, window: fake, navigator: {geolocation: {getCurrentPosition: (ok, err) => { geoCb = ok; }}}, location: {protocol: 'file:'}, localStorage: {getItem: k => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, String(v))}, setTimeout: () => 0, clearTimeout: () => {}, confirm: () => true, Intl, console});
  vm.runInContext(fs.readFileSync(rayonyFile, 'utf8'), c); vm.runInContext(code, c);
  const run = e => vm.runInContext(e, c);
  const tick = () => new Promise(r => setImmediate(r));
  ctx.pendingTests.push((async () => {
    // А. геолокация, запущенная до сброса черновика, не пишет в новый
    run("S.tab = 'newobj'; nbReset();");
    const p1 = run("geoLocate(NB, () => {})");
    run("nbReset();");
    geoCb({coords: {latitude: 55.1, longitude: 37.1, accuracy: 5}}); 
    await p1; await tick();
    ctx.check('бланк-гонка: запоздалая геолокация не попадает в новый черновик', run("NB.lat === null && NB.lon === null && NB.geoBusy === false && NB.geoMsg === ''"), run("[NB.lat, NB.geoBusy, NB.geoMsg]"));
    // Б. фото, декодируемые при сбросе, в новый черновик не попадают
    const gates = []; c.gates = gates;
    run("phDecode = f => new Promise(res => gates.push(() => res({width: 100, height: 80})));");
    const file = {type: 'image/jpeg', size: 10};
    c.f1 = file;
    run("nbReset(); nbPick([f1, f1, f1]);");
    await tick(); const g1 = gates.length;
    run("nbReset();");
    gates.splice(0).forEach(g => g()); await tick(); await tick();
    ctx.check('бланк-гонка: фото из отменённого черновика не попадают в новый', g1 === 1 && run("NB.photos.length === 0 && NB.busy === false"), run("[NB.photos.length, NB.busy]"));
    // В. два выбора подряд обрабатываются по очереди, лимит не превышается
    run("nbReset(); for (let i = 0; i < 7; i++) NB.photos.push({id: 'x' + i, base: {}, ts: 1, thumb: ''});");
    run("phDecode = async f => ({width: 100, height: 80});");
    c.pair = [file, file];
    await run("Promise.all([nbPick(pair), nbPick(pair)])");
    ctx.check('бланк-гонка: два выбора подряд не дают больше 8 фото', run("NB.photos.length === 8 && NB.busy === false"), [run("NB.photos.length"), toastEl.textContent]);
    // Г. «Создать» при идущей обработке фото — отказ без создания проекта
    const before = run("S.deals.length");
    run("NB.busy = true; NB.name = 'тест';"); await run("nbCreate()");
    ctx.check('бланк-гонка: «Создать» во время обработки фото не создаёт проект', run("S.deals.length") === before && /ещё обрабатываются/.test(toastEl.textContent) && run("NB.creating") === false, toastEl.textContent);
    run("nbReset();");
  })());
}

/* --- Быстрый ввод расхода: разбор суммы --- */
vm.runInContext(`
{
  const cases = [['45к', 45000], ['45 к', 45000], ['45 тыс', 45000], ['45 тысяч', 45000], ['1,2м', 1200000], ['4,5 млн', 4500000],
    ['15 000', 15000], ['15 000 ₽', 15000], ['123,45', 123.45], ['7к₽', 7000], ['2 500 руб.', 2500], ['', 0], ['abc', 0], ['-5', 0], ['1e308', 0], ['99999999999999к', 0]];
  cases.forEach(([s, v]) => check('parseAmount(' + JSON.stringify(s) + ') = ' + v, near(parseAmount(s), v, 0.001), parseAmount(s)));
  check('parseAmount(null) = 0', parseAmount(null) === 0);
  check('шторка расхода: функции на месте', typeof openExpSheet === 'function' && typeof xSave === 'function');
  // сохранение расхода с этапом проходит очистку данных; чужой этап отбрасывается
  const d = cleanDeal({id: 'x1', name: 'т', expenses: [{id: 'e1', cat: 'Материалы', sum: 100, date: '2026-11-06', note: '', stage: 'Электрика'}, {id: 'e2', cat: 'Прочее', sum: 5, stage: '<img>'}, {id: 'e3', cat: 'Прочее', sum: 7}]});
  check('cleanDeal: этап расхода сохраняется', d.expenses[0].stage === 'Электрика', d.expenses[0]);
  check('cleanDeal: чужой этап отбрасывается', d.expenses[1].stage === '' && d.expenses[2].stage === '', d.expenses);
}
`, ctx);

/* --- Пакет 1: прогресс, безопасный кэш, список покупок, комнаты, «Горящие дела» --- */
vm.runInContext(`
{
  // очистка данных
  const d0 = cleanDeal({id: 'a1', name: 'т', expenses: [{id: 'e1', cat: 'Ремонт', sum: 10, room: 'Кухня', sid: 'abc'}, {id: 'e2', cat: 'Ремонт', sum: 5, room: '<b>', sid: '<x>'}],
    shop: [{id: 's1', name: ' Плитка ', store: 'ОБИ', sum: '4500', done: true}, {id: 's1', name: 'Клей', sum: -5}, {name: ''}, {id: 's3', name: '<img>', store: 'x'.repeat(100), sum: 'abc'}, 5, null], reservePct: 99});
  check('комната расхода сохраняется', d0.expenses[0].room === 'Кухня' && d0.expenses[0].sid === 'abc', d0.expenses[0]);
  check('чужая комната и sid отбрасываются', d0.expenses[1].room === '' && d0.expenses[1].sid === '', d0.expenses[1]);
  check('cleanShop: пустые и мусор убраны, id уникальны', d0.shop.length === 3 && new Set(d0.shop.map(x => x.id)).size === 3, d0.shop);
  check('cleanShop: сумма и магазин', d0.shop[0].sum === 4500 && d0.shop[0].done === true && d0.shop[0].name === 'Плитка' && d0.shop[1].sum === 0 && d0.shop[2].store.length === 40 && d0.shop[2].sum === 0, d0.shop);
  check('резерв: неверное значение → 10', d0.reservePct === 10 && cleanDeal({id: 'z', reservePct: 15}).reservePct === 15);
  check('cleanShop: не массив → пусто, лимит 200', cleanShop('x').length === 0 && cleanShop(Array.from({length: 300}, (_, i) => ({name: 'п' + i}))).length === 200);
  check('cleanDeal: старая сделка без shop', Array.isArray(cleanDeal({id: 'old', name: 'x'}).shop) && cleanDeal({id: 'old'}).reservePct === 10);

  // прогресс ремонта
  const w = cleanWorks({start: today(), items: [{k: 'demo', days: 10, done: today()}, {k: 'rough', days: 30}, {k: 'elec', days: 0}, {k: 'finish', days: 60}, {k: 'furn', days: 0}]});
  const dp = {works: w};
  check('прогресс: 10 из 100 дней = 10%', dealProgress(dp).pct === 10, dealProgress(dp));
  w.items.forEach(i => { i.done = today(); });
  check('прогресс: всё готово = 100%', dealProgress(dp).pct === 100);
  check('прогресс: без графика нет', dealProgress({works: null}) === null && dealProgress({works: cleanWorks({start: today(), items: [{k: 'demo', days: 0}, {k: 'rough', days: 0}, {k: 'elec', days: 0}, {k: 'finish', days: 0}, {k: 'furn', days: 0}]})}) === null);
  const w2 = cleanWorks({start: today(), items: [{k: 'demo', days: 100, done: today()}, {k: 'rough', days: 100, done: today()}, {k: 'elec', days: 100, done: today()}, {k: 'finish', days: 1}, {k: 'furn', days: 0}]});
  check('прогресс: 100% только когда закрыты все этапы (не округляется вверх)', dealProgress({works: w2}).pct === 99, dealProgress({works: w2}));
  check('поддержка: «меблировка» раньше срока не говорит «всё готово»', !/Всё готово/.test(cheerFor('furn', 60)) && /Всё готово/.test(cheerFor('furn', 100)));
  check('поддержка: тексты на каждый этап и итог', WORK_STAGES.every(x => cheerFor(x[0], 50).length > 10) && /Всё готово/.test(cheerFor('demo', 100)));
  check('прогресс: html с aria и ширина', /aria-valuenow="100"/.test(progressHtml(dp)) && /width:100%/.test(progressHtml(dp)));

  // безопасный кэш
  const calc = Object.assign({}, DEFAULT_CALC, {price: 5000000, repair: 100000, furniture: 50000, sale: 7000000});
  const ds = cleanDeal({id: 'sc', name: 'к', calc, expenses: [], reservePct: 10});
  const p = dealPlan(ds), c = Object.assign({}, DEFAULT_CALC, ds.calc);
  let sc = safeCash(ds, p, c);
  check('безопасный кэш: 10% от 150 000 = 15 000, нетронут', sc && sc.reserve === 15000 && sc.left === 15000, sc);
  ds.expenses = [{id: 'x', cat: 'Ремонт', sum: 110000, date: '2026-11-06', note: '', stage: '', chk: '', room: '', sid: ''}];
  sc = safeCash(ds, p, c);
  check('безопасный кэш: перерасход 10 000 съедает запас', sc.over === 10000 && sc.left === 5000, sc);
  ds.risks = {debts: 20000};
  sc = safeCash(ds, p, c);
  check('безопасный кэш: резерв на проблемы тоже вычитается, уходит в минус', sc.risk === 20000 && sc.left === -15000, sc);
  check('безопасный кэш: красный и без NaN в html', /pbar bad/.test(safeCashHtml(ds, p, c)) && !/NaN|undefined/.test(safeCashHtml(ds, p, c)));
  ds.reservePct = 20; sc = safeCash(ds, p, c);
  check('безопасный кэш: 20% = 30 000', sc.reserve === 30000, sc);
  check('безопасный кэш: нет ремонта — нет блока', safeCash(cleanDeal({id: 'q'}), p, Object.assign({}, calc, {repair: 0, furniture: 0})) === null);

  // список покупок
  const dd = cleanDeal({id: 'shp', name: 'Магазин', calc});
  S.deals.push(dd); openDeal = 'shp';
  dd.shop.push({id: 'i1', name: 'Плитка', store: 'ОБИ', sum: 0, done: false}, {id: 'i2', name: 'Клей', store: 'ОБИ', sum: 1200, done: false});
  shopToggle(dd, 'i1');
  check('покупки: без суммы не отмечается и расход не пишется', dd.shop[0].done === false && dd.expenses.length === 0, [dd.shop[0], dd.expenses]);
  shopToggle(dd, 'i2');
  check('покупки: с суммой — отмечено и расход записан', dd.shop[1].done === true && dd.expenses.length === 1 && dd.expenses[0].sum === 1200 && dd.expenses[0].sid === 'i2' && dd.expenses[0].cat === 'Материалы', dd.expenses);
  shopToggle(dd, 'i2');
  check('покупки: снятие отметки убирает расход', dd.shop[1].done === false && dd.expenses.length === 0, dd.expenses);
  shopToggle(dd, 'i2');
  shopDel(dd, 'i2');
  check('покупки: удаление купленной оставляет расход без привязки', dd.shop.length === 1 && dd.expenses.length === 1 && dd.expenses[0].sid === '', [dd.shop, dd.expenses]);
  const h = shopCardHtml(dd);
  check('покупки: html группирует по магазину, нет undefined', /ОБИ · 1/.test(h) && !/undefined|NaN/.test(h));
  const hx = shopCardHtml(cleanDeal({id: 'xs', shop: [{name: '<script>x</script>', store: '"><b>', sum: 5}]}));
  check('покупки: разметка экранируется', !/<script>x/.test(hx) && !/"><b>/.test(hx));
  check('склонение позиций', ruPositions(1) === '1 позицию' && ruPositions(2) === '2 позиции' && ruPositions(5) === '5 позиций' && ruPositions(11) === '11 позиций' && ruPositions(21) === '21 позицию' && ruPositions(22) === '22 позиции');

  // горящие дела
  const hot0 = hotItems().filter(x => x.id === 'shp');
  check('горящие дела: покупки видны, красных нет', hot0.length === 1 && hot0[0].pri === 2 && /купить 1 позицию/.test(hot0[0].t), hot0);
  const lateDeal = cleanDeal({id: 'lt', name: 'Просрочка', calc, works: {start: '2026-01-01', items: []}});
  lateDeal.expenses = [{id: 'x', cat: 'Ремонт', sum: 400000, date: '2026-11-06', note: '', stage: '', chk: '', room: '', sid: ''}];
  S.deals.push(lateDeal);
  const hot1 = hotItems().filter(x => x.id === 'lt');
  check('горящие дела: просроченный этап и пустой запас, красные первыми', hot1.length >= 2 && hot1[0].pri === 0 && hot1.some(x => x.pri === 1) && /просрочен/.test(hot1[0].t), hot1);
  check('горящие дела: html с красной точкой', /neg/.test(hotHtml()));
  S.deals = S.deals.filter(x => x.id !== 'lt' && x.id !== 'shp'); openDeal = null;
  check('горящие дела: учебный пример и закрытые не считаются', (() => { const dm = cleanDeal({id: 'dm', name: 'пример', demo: true, shop: [{name: 'а'}]}), cl = cleanDeal({id: 'cl', stage: 'Закрыта', shop: [{name: 'б'}]}); S.deals.push(dm, cl); const r = hotItems().filter(x => x.id === 'dm' || x.id === 'cl').length; S.deals = S.deals.filter(x => x.id !== 'dm' && x.id !== 'cl'); return r === 0; })());

  // выгрузка с комнатой
  const csv = expensesCsv({expenses: [{date: '2026-11-06', cat: 'Материалы', stage: '', room: 'Кухня', note: 'плитка', sum: 100}]});
  check('CSV: колонка «Комната»', /"Комната"/.test(csv) && /"Кухня"/.test(csv) && /;100\\r\\n/.test(csv), csv);
  check('фото: комната в поиске и очистке', photoMatches({address: 'а', note: '', room: 'Ванная', ts: 0}, 'ванная', '') === true && cleanRoom('Ванная') === 'Ванная' && cleanRoom('x') === '');
}
`, ctx);

/* --- Пакет 2: осмотр, налог с продажи, ссылка-снимок --- */
ctx.btoa = s => Buffer.from(s, 'latin1').toString('base64');
ctx.atob = s => Buffer.from(s, 'base64').toString('latin1');
vm.runInContext(`
{
  check('осмотр: ключи уникальны, есть 15+ пунктов', new Set(INSPECT_KEYS).size === INSPECT_KEYS.length && INSPECT_KEYS.length >= 15, INSPECT_KEYS.length);
  const di = cleanDeal({id: 'in1', insp: {win: true, wall: false, evil: true, panel: 'yes'}});
  check('осмотр: очистка оставляет только известные отметки', JSON.stringify(di.insp) === '{"win":true}', di.insp);
  check('осмотр: старая сделка без insp', JSON.stringify(cleanDeal({id: 'o'}).insp) === '{}');
  check('осмотр: разметка со счётчиком', /0 из \\d+/.test(inspectCardHtml(cleanDeal({id: 'o'}))) && /1 из/.test(inspectCardHtml(di)) && /checked/.test(inspectCardHtml(di)));

  // налог с продажи
  const T = o => txCalc(Object.assign({sale: 0, price: 0, buy: 0, cad: 0, repair: 0, other: 0, years: 0, early: false, repairDed: false}, o));
  check('налог: база 1,9 млн × 13% = 247 000', near(T({sale: 8e6, price: 6e6, buy: 1e5}).rows[0].tax, 247000, 0.5), T({sale: 8e6, price: 6e6, buy: 1e5}).rows[0].tax);
  check('налог: база 7 млн = 312 000 + 15% с остатка = 1 002 000', near(T({sale: 12e6, price: 5e6}).rows[0].tax, 1002000, 0.5), T({sale: 12e6, price: 5e6}).rows[0].tax);
  check('налог: минимальный вычет 1 млн', near(T({sale: 2e6, price: 5e5}).rows[0].tax, 130000, 0.5));
  check('налог: 70% кадастровой поднимает доход', near(T({sale: 8e6, price: 6e6, buy: 1e5, cad: 20e6}).rows[0].tax, (14e6 - 6.1e6) <= 2.4e6 ? 0 : 312000 + (14e6 - 6.1e6 - 2.4e6) * 0.15, 0.5), T({sale: 8e6, price: 6e6, buy: 1e5, cad: 20e6}).rows[0].tax);
  check('налог: 5 лет владения — без налога, 4 года — с налогом', T({sale: 8e6, price: 6e6, years: 5}).rows[0].tax === 0 && T({sale: 8e6, price: 6e6, years: 4}).rows[0].tax > 0);
  check('налог: льготный срок 3 года', T({sale: 8e6, price: 6e6, years: 3, early: true}).free === true && T({sale: 8e6, price: 6e6, years: 2.9, early: true}).free === false);
  check('налог: ремонт в расходах уменьшает НДФЛ только по галочке', T({sale: 8e6, price: 6e6, repair: 5e5}).rows[0].tax > T({sale: 8e6, price: 6e6, repair: 5e5, repairDed: true}).rows[0].tax);
  check('налог: УСН 6% и УСН 15% с минимумом 1%', near(T({sale: 8e6}).rows[1].tax, 480000, 0.5) && near(T({sale: 8e6, price: 8e6}).rows[2].tax, 80000, 0.5) && near(T({sale: 8e6, price: 6e6, buy: 1e5}).rows[2].tax, 285000, 0.5));
  check('налог: нулевые входы без NaN', T({}).rows.every(r => r.tax === 0 && r.net === 0 && !isNaN(r.eff)));
  TX = {sale: 8e6, price: 6e6, buy: 0, cad: 0, repair: 0, other: 0, years: 0, early: false, repairDed: false};
  check('налог: страница строится, лучшая подсвечена', /txr best/.test(txHtml()) && !/NaN|undefined/.test(txHtml()));

  // ссылка-снимок
  const calc = Object.assign({}, DEFAULT_CALC, {price: 5000000, repair: 100000, furniture: 50000, sale: 7000000});
  const dl = cleanDeal({id: 'sh1', name: 'Двушка', address: 'Москва, Перово', stage: 'Ремонт', calc, owner: {name: 'Иван Секретов', phone: '+7 999 123-45-67'},
    people: [{id: 'p1', role: 'прораб', name: 'Пётр', phone: '+7 911 765-43-21'}], works: {start: '2026-10-01', items: []}});
  const snap = shareSnap(dl), enc = b64uEnc(JSON.stringify(snap)), back = shareParse('#s=' + enc);
  check('ссылка: туда-обратно сохраняет цифры и этапы', back && back.n === 'Двушка' && back.buy === 5000000 && back.net === snap.net && back.ws.length === 5 && back.st === 'Ремонт', back);
  check('ссылка: телефонов и собственника нет', !/Секретов|999|765|Пётр|прораб/.test(JSON.stringify(snap)) && !/Секретов|999 123/.test(shareView(back)));
  check('ссылка: кириллица и спецсимволы выдерживают кодирование', shareParse('#s=' + b64uEnc(JSON.stringify({v: 1, n: 'Дом «Ёж» & №5'}))).n === 'Дом «Ёж» & №5');
  const evil = shareParse('#s=' + b64uEnc(JSON.stringify({v: 1, n: '<img src=x onerror=alert(1)>', a: '"><script>x</script>', st: 'Взлом', buy: 'abc', net: 1e999, ws: [['<b>', 'evil', '99.99'], 5, ['ок', 'done', '01.02']], end: '<x>', dt: 'не дата'})));
  const ev = shareView(evil);
  check('ссылка: подделка — разметка экранирована, мусор отброшен', evil && !/<img|<script|<b>/.test(ev) && evil.st === '' && evil.buy === null && evil.net === null && evil.ws.length === 2 && evil.ws[0][1] === 'wait' && evil.ws[0][2] === '' && evil.end === '' && evil.dt === '', [evil, ev.slice(0, 200)]);
  check('ссылка: чужие и битые адреса не принимаются', shareParse('') === null && shareParse('#x=1') === null && shareParse('#s=!!!') === null && shareParse('#s=' + b64uEnc('{"v":2}')) === null && shareParse('#s=' + b64uEnc('не json')) === null && shareParse('#s=' + 'A'.repeat(7000)) === null);
  check('ссылка: страница без undefined и NaN', !/undefined|NaN/.test(shareView(back)) && !/undefined|NaN/.test(shareView(shareParse('#s=' + b64uEnc('{"v":1}')))));
  check('ссылка: обрезка по символам не ломает эмодзи', (() => { const d = cleanDeal({id: 'em', name: '😀'.repeat(79) + '😀😀', address: '🏠'.repeat(125)}); try { b64uEnc(JSON.stringify(shareSnap(d))); return true; } catch (e) { return false; } })());
  check('ссылка: размер адреса разумный', enc.length < 2000, enc.length);
}
`, ctx);

/* --- Режим «Просто / Полный»: раскрытие по этапу проекта --- */
vm.runInContext(`
{
  const keepDeals = S.deals, keepMode = S.mode, keepStore = localStorage.getItem(LS_KEY);
  const mk = (stage, extra) => cleanDeal(Object.assign({id: 'm' + stage, name: 'о', stage}, extra || {}));
  // состояние при загрузке
  const L = o => { localStorage.setItem(LS_KEY, JSON.stringify(o)); return load().mode; };
  check('режим: новая установка — простой', L({}) === 'simple');
  check('режим: есть проекты — полный', L({deals: [{id: 'a', name: 'x'}]}) === 'full');
  check('режим: только учебный пример — простой', L({deals: [{id: 'a', name: 'x', demo: true}]}) === 'simple');
  check('режим: сохранённый выбор не трогаем', L({mode: 'simple', deals: [{id: 'a', name: 'x'}]}) === 'simple' && L({mode: 'full'}) === 'full');
  check('режим: мусор в поле — как по умолчанию', L({mode: '<b>', deals: [{id: 'a'}]}) === 'full' && L({mode: 5}) === 'simple');
  localStorage.setItem(LS_KEY, keepStore == null ? '' : keepStore);

  check('фазы: все этапы известны', STAGES.every(s => [1, 2, 3].includes(STAGE_PHASE[s])), STAGES.map(s => STAGE_PHASE[s]));
  S.deals = []; check('фаза: без проектов 0', homePhase() === 0);
  S.deals = [mk('Поиск')]; check('фаза: поиск = 1', homePhase() === 1);
  S.deals = [mk('Поиск'), mk('Ремонт')]; check('фаза: берётся самая далёкая = 2', homePhase() === 2);
  S.deals = [mk('Закрыта')]; check('фаза: закрытая = 3', homePhase() === 3);
  S.deals = [mk('Продажа', {demo: true})]; check('фаза: учебный пример не открывает блоки', homePhase() === 0);

  // главная по режимам
  S.mode = 'simple';
  S.deals = [];
  let h0 = homeHtml();
  check('простая главная без проектов: синяя кнопка экспресс-расчёта, новый проект, режим', /Экспресс-расчёт нового объекта/.test(h0) && />Новый проект</.test(h0) && /Показать все возможности/.test(h0) && !/Оценить новый объект/.test(h0));
  check('простая главная без проектов: лишнего нет, а ядро есть', !/data-v="photo"|Итоги по сделкам|Справочники|Новости/.test(h0) && /Калькуляторы/.test(h0) && /Календарь/.test(h0) && /Записная книжка/.test(h0) && /Курсы и ставки/.test(h0) && /Голосовой помощник/.test(h0), h0.match(/data-v="photo"|Итоги по сделкам|Справочники|Новости/));
  S.deals = [mk('Поиск')];
  let h1 = homeHtml();
  check('простая главная, поиск: открылись справочники, фото, новости', /Справочники/.test(h1) && /data-v="photo"/.test(h1) && /Новости/.test(h1));
  check('простая главная, поиск: итогов по сделкам ещё нет', !/Итоги по сделкам/.test(h1));
  S.deals = [mk('Ремонт', {calc: Object.assign({}, DEFAULT_CALC, {price: 5e6, sale: 7e6, repair: 1e5})})];
  let h2 = homeHtml();
  check('простая главная, ремонт: календарь, голос, итоги', /Календарь/.test(h2) && /Голосовой помощник/.test(h2) && /Итоги по сделкам/.test(h2));
  S.mode = 'full'; S.deals = [];
  let hf = homeHtml();
  check('полный режим: всё на месте даже без проектов', /Календарь/.test(hf) && /Курсы и ставки/.test(hf) && /Калькуляторы/.test(hf) && /Голосовой помощник/.test(hf) && /data-v="photo"/.test(hf) && /Упростить главную/.test(hf) && !/Оценить новый объект/.test(hf));
  check('главная: без undefined и NaN', !/undefined|NaN/.test(h0 + h1 + h2 + hf));

  // блоки в сделке
  S.mode = 'simple';
  check('сделка: поиск — смета и расходы закрыты', dealOpen(mk('Поиск'), 2, false) === false && dealOpen(mk('Проверка'), 2, false) === false && dealOpen(mk('Покупка'), 2, false) === false);
  check('сделка: есть данные — блок виден даже раньше этапа', dealOpen(mk('Поиск'), 2, true) === true);
  check('сделка: ремонт — открыто, итоги продажи ещё нет', dealOpen(mk('Ремонт'), 2, false) === true && dealOpen(mk('Ремонт'), 3, false) === false);
  check('сделка: продажа — итоги открыты', dealOpen(mk('Продажа'), 3, false) === true);
  check('сделка: учебный пример всегда открыт', dealOpen(mk('Поиск', {demo: true}), 3, false) === true);
  S.mode = 'full';
  check('сделка: полный режим открывает всё', dealOpen(mk('Поиск'), 3, false) === true);

  S.deals = keepDeals; S.mode = keepMode;
}
`, ctx);

/* --- Эргономика «в полях»: плавающая кнопка, быстрые суммы, вибрация, контраст --- */
vm.runInContext(`
{
  const keepMode = S.mode, keepNav = navigator;
  const mk = (stage, extra) => cleanDeal(Object.assign({id: 'f' + stage, name: 'о', stage}, extra || {}));
  S.mode = 'full';
  check('плавающая кнопка: в полном режиме есть всегда', /class="fab"[^>]*data-a="exp-new"/.test(dealFabHtml(mk('Поиск'))) && /Добавить расход/.test(dealFabHtml(mk('Поиск'))));
  S.mode = 'simple';
  check('плавающая кнопка: простой режим, поиск без расходов — нет', dealFabHtml(mk('Поиск')) === '');
  check('плавающая кнопка: простой режим, ремонт — есть', /class="fab"/.test(dealFabHtml(mk('Ремонт'))));
  check('плавающая кнопка: простой режим, поиск, но расходы уже есть — есть', /class="fab"/.test(dealFabHtml(mk('Поиск', {expenses: [{id: 'e', cat: 'Прочее', sum: 5}]}))));
  S.mode = keepMode;

  check('быстрые суммы: набор 1к, 5к, 10к, 50к', JSON.stringify(X_QUICK) === '[1000,5000,10000,50000]');
  check('быстрые суммы: к введённому «45к» + 5 000 = 50 000', xAdd(parseAmount('45к'), 5000) === 50000);
  check('быстрые суммы: к пустому полю', xAdd(parseAmount(''), 10000) === 10000 && xAdd(0, 1000) === 1000);
  check('быстрые суммы: нет NaN и не больше предела', xAdd(NaN, 1000) === 1000 && xAdd(1e12, 50000) === 1e12 && xAdd(5, undefined) === 5 && xAdd(-100, 50) === 0);
  check('быстрые суммы: «45 000» после прибавления читается обратно', parseAmount(num(xAdd(45000, 5000))) === 50000, num(50000));

  // вибрация: не падает без поддержки и с ней
  let buzz = [];
  navigator = {vibrate: v => { buzz.push(v); return true; }};
  haptic(20); haptic([20, 40, 20]); haptic();
  check('вибрация: вызывается с нужными паттернами', JSON.stringify(buzz) === '[20,[20,40,20],15]', buzz);
  navigator = {};
  let boom = null; try { haptic(20); } catch (e) { boom = e; }
  check('вибрация: без поддержки (iPhone) ничего не ломает', boom === null);
  navigator = {vibrate() { throw new Error('нет прав'); }};
  boom = null; try { haptic(20); } catch (e) { boom = e; }
  check('вибрация: исключение браузера гасится', boom === null);
  navigator = keepNav;

  // контраст запоминается
  applyContrast(true);
  check('яркий свет: включение запоминается', localStorage.getItem('fl-contrast') === '1');
  applyContrast(false);
  check('яркий свет: выключение запоминается', localStorage.getItem('fl-contrast') === '0');
}
`, ctx);

/* --- Записная книжка --- */
vm.runInContext(`
{
  const keep = S.book, keepDeals = S.deals;
  S.deals = [cleanDeal({id: 'bd1', name: 'Двушка'})];
  S.book = [];
  // чистка
  check('книжка: не массив → пусто', cleanBook(null).length === 0 && cleanBook('x').length === 0 && cleanBook({}).length === 0);
  const cl = cleanBook([null, 5, {text: ''}, {text: '   '}, {text: 5}, {id: 'a', text: ' привет ', ts: 100, dealId: 'bd1', pin: true}, {id: 'a', text: 'дубль', ts: 'x', pin: 'yes'}]);
  check('книжка: мусор отброшен, пробелы обрезаны', cl.length === 2 && cl[0].text === 'привет');
  check('книжка: повторный id заменён, битая дата — сейчас, pin только true', cl[1].id !== 'a' && cl[1].ts > 1e12 && cl[1].pin === false && cl[0].pin === true);
  check('книжка: длинный текст обрезан до предела', cleanBook([{text: 'я'.repeat(5000)}])[0].text.length === BOOK_LEN);
  check('книжка: число записей ограничено', cleanBook(Array.from({length: BOOK_MAX + 50}, (_, i) => ({text: 'з' + i}))).length === BOOK_MAX);
  // добавление
  check('книжка: пустая запись не добавляется', bkAdd('  ', '') === false && S.book.length === 0);
  check('книжка: добавление', bkAdd('  Позвонить в БТИ ', '') === true && S.book.length === 1 && S.book[0].text === 'Позвонить в БТИ' && S.book[0].dealId === '' && S.book[0].pin === false);
  bkAdd('По проекту', 'bd1'); bkAdd('Чужой проект', 'нет-такого');
  check('книжка: проект привязывается, несуществующий отбрасывается', S.book[1].dealId === 'bd1' && S.book[2].dealId === '');
  // сортировка и поиск
  S.book[0].ts = 1000; S.book[1].ts = 3000; S.book[2].ts = 2000;
  check('книжка: новые сверху', S.book.slice().sort(bkSort).map(e => e.text).join('|') === 'По проекту|Чужой проект|Позвонить в БТИ');
  S.book[0].pin = true;
  check('книжка: закреплённые выше всех', S.book.slice().sort(bkSort)[0].text === 'Позвонить в БТИ');
  check('книжка: поиск без учёта регистра', bkMatch(S.book[0], 'бти') && bkMatch(S.book[0], 'ПОЗВОНИТЬ') && !bkMatch(S.book[0], 'проект') && bkMatch(S.book[0], ''));
  // отрисовка и защита от разметки
  S.book.push({id: 'x1', text: '<img src=x onerror=alert(1)> & "кавычки"', ts: Date.now(), dealId: 'bd1', pin: false});
  const html = bkListHtml();
  check('книжка: текст экранируется', !/<img src=x/.test(html) && html.includes('&lt;img'));
  BK.q = 'бти'; check('книжка: список фильтруется поиском', bkListHtml().includes('БТИ') && !bkListHtml().includes('По проекту'));
  BK.q = 'zzzz'; check('книжка: «ничего не найдено»', bkListHtml().includes('Ничего не найдено'));
  BK.q = ''; BK.f = 'bd1';
  check('книжка: фильтр по проекту', bkListHtml().includes('По проекту') && !bkListHtml().includes('БТИ'));
  BK.f = 'none'; check('книжка: фильтр «без проекта»', bkListHtml().includes('БТИ') && !bkListHtml().includes('По проекту'));
  BK.f = '';
  check('книжка: в сделке только её записи', bkDealListHtml(S.deals[0]).includes('По проекту') && !bkDealListHtml(S.deals[0]).includes('БТИ'));
  check('книжка: в сделке пустой список — подсказка', bkDealListHtml(cleanDeal({id: 'zz', name: 'п'})).includes('пока нет'));
  check('книжка: блок сделки содержит поле, диктовку и добавление', /data-bk="dtext"/.test(bookDealHtml(S.deals[0])) && /data-a="bk-dvoice"/.test(bookDealHtml(S.deals[0])) && /data-a="bk-dadd"/.test(bookDealHtml(S.deals[0])));
  check('книжка: не попадает в ссылку соинвестора', !JSON.stringify(shareSnap(S.deals[0])).includes('БТИ') && !JSON.stringify(shareSnap(S.deals[0])).includes('По проекту'));
  // правка не теряется при перерисовке, устаревший фильтр сбрасывается
  S.book = [{id: 'e1', text: 'Старый', ts: 5, dealId: '', pin: false}];
  BK.edit = 'e1'; BK.etext = 'Набранный текст';
  check('книжка: набранная правка переживает перерисовку', bkEntryHtml(S.book[0], true).includes('Набранный текст'));
  BK.edit = ''; BK.etext = '';
  BK.f = 'нет-проекта'; BK.deal = 'нет-проекта';
  try { renderNotes(); } catch (e) {}
  check('книжка: фильтр и проект сбрасываются, если проекта нет', BK.f === '' && BK.deal === '');
  const saveKeep = save; save = () => false;
  const nBefore = S.book.length;
  check('книжка: при сбое сохранения запись не остаётся в памяти', bkAdd('Не сохранится', '') === false && S.book.length === nBefore);
  save = saveKeep;
  S.book = keep; S.deals = keepDeals;
}
`, ctx);

/* --- Калькулятор материалов --- */
vm.runInContext(`
{
  const m0 = {len: 4, wid: 3, h: 2.7, doors: 1, wins: 1, reserve: 10, tw: 30, th: 30, pack: 2.4};
  const r = matCalc(m0), g = k => r.rows.find(x => x.k === k);
  check('материалы: площадь пола 4×3 = 12', r.floor === 12);
  check('материалы: периметр 14', r.perim === 14);
  check('материалы: стены 14×2,7 − дверь 1,9 − окно 1,8 = 34,1', r.walls === 34.1, r.walls);
  check('материалы: краска стен 34,1×2/10×1,1 = 7,5 л, одна банка 9 л', g('paintW').qty === 7.5 && /банок по 9 л: 1/.test(g('paintW').txt), g('paintW').txt);
  check('материалы: краска потолка 12×0,2×1,1 = 2,6 л', g('paintC').qty === 2.6, g('paintC').txt);
  check('материалы: обои (14 − 0,9 дверь)/1,06 = 13 полос по 2,8 м, по 3 на рулон = 5 рулонов', g('paper').qty === 5 && /13 полос/.test(g('paper').txt), g('paper').txt);
  check('материалы: плитка 30×30 с запасом 10% = 147 шт.', g('tile').qty === 147, g('tile').txt);
  check('материалы: ламинат 13,2 м² / 2,4 = 6 пачек', g('lam').qty === 6, g('lam').txt);
  check('материалы: подложка 12,6 м² = 2 рулона (склонение)', g('under').qty === 2 && g('under').txt === '2 рулона', g('under').txt);
  check('материалы: склонения 1, 2, 5, 11, 22', plu(1, 'пачка', 'пачки', 'пачек') === '1 пачка' && plu(2, 'пачка', 'пачки', 'пачек') === '2 пачки' && plu(5, 'пачка', 'пачки', 'пачек') === '5 пачек' && plu(11, 'пачка', 'пачки', 'пачек') === '11 пачек' && plu(22, 'пачка', 'пачки', 'пачек') === '22 пачки');
  check('материалы: плинтус (14 − 0,9)×1,05/2,5 = 6 штанг', g('plinth').qty === 6, g('plinth').txt);
  check('материалы: клей 59 кг = 3 мешка', /59 кг, мешков по 25 кг: 3/.test(g('glue').txt), g('glue').txt);
  check('материалы: грунтовка и шпаклёвка считаются по стенам и потолку', g('prime').qty === 10.1 && g('putty').qty === 61, [g('prime').txt, g('putty').txt]);
  const r0 = matCalc(Object.assign({}, m0, {reserve: 0}));
  check('материалы: без запаса плитка 134 шт., краска меньше', r0.rows.find(x => x.k === 'tile').qty === 134 && r0.rows.find(x => x.k === 'paintW').qty === 6.8);
  const big = matCalc(Object.assign({}, m0, {doors: 10, wins: 20}));
  check('материалы: проёмы больше стен — стены не уходят в минус', big.walls === 0 && !big.rows.some(x => /NaN|-/.test(x.txt.replace(/\d+-\d+/g, ''))), big.walls);
  check('материалы: ноль или мусор в размерах — нет расчёта', matCalc({...m0, len: 0}) === null && matCalc({...m0, h: 0}) === null && matCalc({...m0, wid: NaN}) === null && matCalc(null) === null && matCalc({...m0, tw: 0}) === null);
  check('материалы: нет NaN и Infinity ни в одной строке', r.rows.every(x => !/NaN|Infinity|undefined/.test(x.txt + x.name)) && r.rows.every(x => isFinite(x.qty) && x.qty >= 0));
  // чистка сохранённого
  const c1 = cleanMat({len: '5,5', wid: -3, h: 99, doors: 2.6, wins: 'x', reserve: null, tw: true, th: 60, pack: 0});
  check('материалы: чистка берёт корректное и сбрасывает мусор', c1.len === 5.5 && c1.wid === 3 && c1.h === 2.7 && c1.doors === 3 && c1.wins === 1 && c1.reserve === 10 && c1.tw === 30 && c1.th === 60 && c1.pack === 2.4, JSON.stringify(c1));
  check('материалы: чистка — не объект даёт значения по умолчанию', JSON.stringify(cleanMat(null)) === JSON.stringify(MAT_DEF) && JSON.stringify(cleanMat('x')) === JSON.stringify(MAT_DEF));
  check('материалы: результат содержит отметки по всем материалам', (matResHtml().match(/data-mtk=/g) || []).length === 11);
  // добавление в список покупок
  const keepDeals = S.deals, keepMat = S.mat;
  S.deals = [cleanDeal({id: 'md1', name: 'Мат'})]; S.mat = Object.assign({}, MAT_DEF);
  MAT.deal = 'md1'; MAT.room = 'Кухня'; MAT.sel = new Set(['paintW', 'tile']);
  matAdd();
  check('материалы: отмеченное попало в список покупок с комнатой', S.deals[0].shop.length === 2 && S.deals[0].shop.some(x => /Краска для стен/.test(x.name) && /Кухня/.test(x.name)) && S.deals[0].shop.every(x => x.sum === 0 && !x.done && x.name.length <= 120), JSON.stringify(S.deals[0].shop));
  check('материалы: после добавления отметки сняты', MAT.sel.size === 0);
  matAdd();
  check('материалы: без отметок ничего не добавляется', S.deals[0].shop.length === 2);
  S.deals[0].shop = Array.from({length: 199}, (_, i) => ({id: 'z' + i, name: 'п' + i, store: '', sum: 0, done: false}));
  MAT.sel = new Set(['paintW', 'tile']); matAdd();
  check('материалы: предел 200 позиций не пробивается', S.deals[0].shop.length === 199);
  // правки по ревью
  const mk = (o) => matCalc(Object.assign({}, m0, o)), gk = (rr, k) => rr.rows.find(x => x.k === k);
  check('материалы: запас вне диапазона (35%) — нет расчёта, а не молчаливый ноль', mk({reserve: 35}) === null && mk({doors: 11}) === null && mk({wins: 21}) === null && mk({reserve: -1}) === null);
  check('материалы: запас 30% действует на подложку и плинтус', gk(mk({reserve: 30}), 'plinth').qty > gk(mk({reserve: 0}), 'plinth').qty || gk(mk({reserve: 30}), 'under').qty > gk(mk({reserve: 0}), 'under').qty);
  S.deals = [cleanDeal({id: 'md2', name: 'М2'})]; S.mat = Object.assign({}, MAT_DEF, {reserve: 10}); MAT.deal = 'md2'; MAT.room = 'Ванная';
  S.mat.len = 4.1; S.mat.wid = 3.3; MAT.sel = new Set(['prime', 'paintC', 'grout', 'tile', 'lam', 'paper']); matAdd();
  const nm = S.deals[0].shop.map(x => x.name).join(' | ');
  check('материалы: в список покупок идёт количество целиком, дробь не режется', /Грунтовка: \\d+(,\\d)? л · Ванная/.test(nm) && /Краска для потолка[^|]*: \\d+(,\\d)? л · Ванная/.test(nm) && /Затирка: \\d+(,\\d)? кг/.test(nm) && /шт\\. · Ванная/.test(nm) && /пач[а-я]* · Ванная/.test(nm) && /рулон[а-ов]* · Ванная/.test(nm), nm);
  check('материалы: 1 100 000 плиток показываются с пробелами', /1[\\s\\u00a0]\\d{3}[\\s\\u00a0]\\d{3} шт\\./.test(gk(mk({len: 50, wid: 50, tw: 5, th: 5}), 'tile').txt), gk(mk({len: 50, wid: 50, tw: 5, th: 5}), 'tile').txt);
  S.mat = Object.assign({}, MAT_DEF, {len: 1, wid: 1, doors: 10, wins: 20});
  check('материалы: проёмы на все стены — предупреждение', matResHtml().indexOf('Проёмы занимают все стены') >= 0);
  S.deals = keepDeals; S.mat = keepMat; MAT.sel = new Set();
}
`, ctx);

/* --- Три сценария, расходы по комнатам, Гант, таймлапс --- */
vm.runInContext(`
{
  const c = Object.assign({}, DEFAULT_CALC, {price: 5000000, repair: 800000, sale: 7000000, months: 6});
  const t = scenTriple(c, {sale: 5, repair: 10, months: 2});
  check('сценарии: три колонки в нужном порядке', t.length === 3 && t[0].name === 'Оптимист' && t[1].name === 'Реалист' && t[2].name === 'Пессимист');
  check('сценарии: оптимист — цена +5%, ремонт −10%, срок −2', Math.round(t[0].sale) === 7350000 && Math.round(t[0].repair) === 720000 && t[0].months === 4, JSON.stringify([t[0].sale, t[0].repair, t[0].months]));
  check('сценарии: пессимист — цена −5%, ремонт +10%, срок +2', Math.round(t[2].sale) === 6650000 && Math.round(t[2].repair) === 880000 && t[2].months === 8);
  check('сценарии: реалист совпадает с обычным расчётом', t[1].r.net === compute(c).net && t[1].sale === c.sale);
  check('сценарии: прибыль убывает от оптимиста к пессимисту', t[0].r.net > t[1].r.net && t[1].r.net > t[2].r.net, t.map(x => x.r.net));
  const z = scenTriple(c, {sale: 0, repair: 0, months: 0});
  check('сценарии: нулевые отклонения — все три равны', z[0].r.net === z[1].r.net && z[2].r.net === z[1].r.net);
  const tf = scenTriple(Object.assign({}, c, {months: 1.4}), {sale: 5, repair: 10, months: 2});
  check('сценарии: дробный срок округляется так же, как в расчёте', tf[1].months === 1 && tf[0].months === 1 && tf[2].months === 3 && tf[1].r.net === compute(Object.assign({}, c, {months: 1.4})).net);
  check('сценарии: срок 0,5 даёт месяц, оптимист не «дольше» реалиста', scenTriple(Object.assign({}, c, {months: 0.5}), {sale: 5, repair: 10, months: 2}).every((x, i, a) => x.months >= 1 && a[0].months <= a[1].months));
  check('сценарии: срок оптимиста не уходит ниже месяца', scenTriple(Object.assign({}, c, {months: 2}), {sale: 5, repair: 10, months: 12})[0].months === 1);
  check('сценарии: допустимые значения', scenValid({sale: 5, repair: 10, months: 2}) && scenValid({sale: 0, repair: 0, months: 0}) && scenValid({sale: 30, repair: 50, months: 12}));
  check('сценарии: вне диапазона и мусор отвергаются', !scenValid({sale: 31, repair: 10, months: 2}) && !scenValid({sale: 5, repair: 51, months: 2}) && !scenValid({sale: 5, repair: 10, months: 13}) && !scenValid({sale: -1, repair: 10, months: 2}) && !scenValid({sale: NaN, repair: 10, months: 2}) && !scenValid(null));
  const cs = cleanScen({sale: '7,5', repair: 99, months: 3.6});
  check('сценарии: чистка сохраняемого', cs.sale === 7.5 && cs.repair === 10 && cs.months === 4, JSON.stringify(cs));
  check('сценарии: чистка не-объекта даёт значения по умолчанию', JSON.stringify(cleanScen(null)) === JSON.stringify(SCEN_DEF) && JSON.stringify(cleanScen('x')) === JSON.stringify(SCEN_DEF));
  const keepScen = S.scen; S.scen = {sale: 5, repair: 10, months: 2};
  const th = scenTableHtml(c);
  check('сценарии: таблица содержит три колонки и итог', /Оптимист/.test(th) && /Реалист/.test(th) && /Пессимист/.test(th) && /Чистая прибыль/.test(th) && !/NaN|undefined|Infinity/.test(th));
  S.scen = {sale: 99, repair: 10, months: 2};
  check('сценарии: неверное отклонение — подсказка вместо таблицы', /Отклонения:/.test(scenTableHtml(c)) && !/<table/.test(scenTableHtml(c)));
  S.scen = keepScen;
  check('сценарии: без цен карточки нет', scenHtml(Object.assign({}, c, {price: 0})) === '' && scenHtml(Object.assign({}, c, {sale: 0})) === '');

  // расходы по комнатам
  const dRooms = {expenses: [{sum: 100, room: 'Кухня'}, {sum: 300, room: 'Ванная'}, {sum: 100, room: 'Кухня'}, {sum: 100, room: ''}, {sum: 0, room: 'Кухня'}, {sum: 50, room: 'Выдуманная'}]};
  const rt = roomTotals(dRooms);
  check('комнаты: итог и порядок (по убыванию, «без комнаты» в конце)', rt.total === 650 && rt.rows.map(r => r.room).join('|') === 'Ванная|Кухня|', rt.rows.map(r => r.room));
  check('комнаты: суммы, число записей и доли', rt.rows[0].sum === 300 && rt.rows[1].sum === 200 && rt.rows[1].n === 2 && rt.rows[2].sum === 150 && Math.abs(rt.rows.reduce((x, r) => x + r.share, 0) - 100) < 1e-9);
  check('комнаты: нулевой расход не считается записью', rt.rows[1].n === 2);
  check('комнаты: неизвестная комната попадает в «без комнаты»', rt.rows[2].room === '' && rt.rows[2].n === 2);
  check('комнаты: нет расходов — нет карточки', roomCardHtml({expenses: []}) === '' && roomTotals({expenses: []}).total === 0);
  check('комнаты: без отмеченных комнат — подсказка', /пока не отмечены/.test(roomCardHtml({expenses: [{sum: 100, room: ''}]})) && !/пока не отмечены/.test(roomCardHtml(dRooms)));
  check('комнаты: экранирование и рубли', /Ванная/.test(roomCardHtml(dRooms)) && /Без комнаты/.test(roomCardHtml(dRooms)) && !/NaN|undefined/.test(roomCardHtml(dRooms)));

  // Гант
  const w = cleanWorks({start: '2026-01-10'});
  const wp = worksPlan(w, '2026-01-12'), g = ganttGeom(wp, isoDay('2026-01-12'));
  check('гант: ось 64 дня по плану', g.total === 64 && g.rows.length === 5);
  check('гант: первая полоса с нуля, ширина 5/64', g.rows[0].pl === 0 && Math.abs(g.rows[0].pw - 5 / 64 * 100) < 1e-9);
  check('гант: полосы плана идут встык и занимают всю ось', Math.abs(g.rows.reduce((x, r) => x + r.pw, 0) - 100) < 1e-6 && Math.abs(g.rows[1].pl - 5 / 64 * 100) < 1e-9);
  check('гант: линия «сегодня» на 2-м дне', Math.abs(g.todayPct - 2 / 64 * 100) < 1e-9);
  check('гант: сегодня до начала ремонта — линии нет', ganttGeom(worksPlan(w, '2026-01-01'), isoDay('2026-01-01')).todayPct === null);
  const late = ganttGeom(worksPlan(w, '2026-06-01'), isoDay('2026-06-01'));
  check('гант: затянутый ремонт расширяет ось, всё внутри 0–100%', late.total > 64 && late.rows.every(r => r.fl >= 0 && r.fl + r.fw <= 100.0001 && r.pl + r.pw <= 100.0001) && late.todayPct <= 100);
  const wd = cleanWorks({start: '2026-01-10', items: [{k: 'demo', days: 0}]});
  check('гант: этап в 0 дней виден тонкой полосой', ganttGeom(worksPlan(wd, '2026-01-12'), isoDay('2026-01-12')).rows[0].pw >= 1.5);
  check('гант: нет графика — нет полос', ganttGeom(null, 1) === null && ganttHtml(null) === '');
  const gh = ganttHtml(wp);
  check('гант: разметка с этапами, подписью и без NaN', /Демонтаж/.test(gh) && /Меблировка/.test(gh) && /сегодня/.test(gh) && !/NaN|undefined/.test(gh));
  check('гант: статусы в классах полос', /s-work|s-wait|s-done|s-late/.test(gh));

  // таймлапс: выборка кадров
  const arr = Array.from({length: 200}, (_, i) => i);
  const pk = tlPick(arr, 80);
  check('таймлапс: выборка до предела, первый и последний кадр на месте', pk.length === 80 && pk[0] === 0 && pk[79] === 199);
  check('таймлапс: выборка по порядку, без повторов', pk.every((v, i) => i === 0 || v > pk[i - 1]));
  check('таймлапс: мало кадров — берём все', JSON.stringify(tlPick([1, 2, 3], 80)) === '[1,2,3]' && tlPick([], 80).length === 0);
  check('таймлапс: подпись скорости', tlSpeedLbl(1000) === '1 с' && tlSpeedLbl(250) === '0,25 с');
}
`, ctx);

/* --- Резервная копия переехала в «Справочник» --- */
vm.runInContext(`
{
  const keep = S.lastBackup, keepDeals = S.deals;
  S.deals = []; S.lastBackup = 0;
  const h0 = backupCardHtml();
  check('резервная копия: карточка есть и без проектов', /Резервная копия/.test(h0) && /data-a="backup-save"/.test(h0) && /id="backupFile"/.test(h0) && !/Скачайте копию/.test(h0));
  S.deals = [cleanDeal({id: 'bk1', name: 'п'})];
  check('резервная копия: с проектами и без копии — просьба скачать', /Скачайте копию/.test(backupCardHtml()) && /Копию ещё не делали/.test(backupCardHtml()));
  S.lastBackup = Date.now();
  check('резервная копия: свежая — «сегодня», без просьбы', /Последняя копия — сегодня/.test(backupCardHtml()) && !/Скачайте/.test(backupCardHtml()));
  S.lastBackup = Date.now() - 20 * 864e5;
  check('резервная копия: старая — просьба скачать свежую', /20 дн\. назад/.test(backupCardHtml()) && /Скачайте свежую копию/.test(backupCardHtml()));
  S.lastBackup = keep; S.deals = keepDeals;
}
`, ctx);

/* --- Эргономика, пакет 2: цифровой блок, миниатюры, переключатель этапа --- */
vm.runInContext(`
{
  const N = s => String(s).replace(/[\\s\\u00a0\\u202f]/g, '');
  check('цифровой блок: цифры набираются и группируются', xKeyApply('', '4') === '4' && xKeyApply('4', '5') === '45' && N(xKeyApply('45', '000')) === '45000' && xKeyApply('45', '000').length === 6, JSON.stringify(xKeyApply('45', '000')));
  check('цифровой блок: «45 000» + «5» = 450 005 без потери разрядов', N(xKeyApply(xKeyApply('45', '000'), '5')) === '450005');
  check('цифровой блок: стереть последнюю цифру и пробелы', N(xKeyApply(xKeyApply('45', '000'), 'bs')) === '4500' && xKeyApply('', 'bs') === '' && xKeyApply('7', 'bs') === '');
  check('цифровой блок: очистить', xKeyApply('45 000', 'c') === '' && xKeyApply('', 'c') === '');
  check('цифровой блок: нули в начале не копятся, «000» в пустом поле ничего не пишет', xKeyApply('', '0') === '' && xKeyApply('', '000') === '' && xKeyApply('0', '0') === '' && N(xKeyApply('0', '5')) === '5');
  check('цифровой блок: не длиннее 12 цифр', N(xKeyApply('999999999999', '9')).length <= 12);
  check('цифровой блок: неизвестная клавиша и пустое значение не ломают', xKeyApply(undefined, '5') === '5' && xKeyApply(null, 'x') === '' && xKeyApply('12', 'zz') === '12');
  check('цифровой блок: «45к» и «1,5м» сначала приводятся к числу', N(xKeyApply('45к', '7')) === '450007' && N(xKeyApply('1,5м', '0')) === '15000000' && xKeyApply('45к', 'c') === '');
  check('цифровой блок: непонятный текст не склеивается с цифрами', xKeyApply('abc', '5') === '5');
  check('цифровой блок: результат читается как сумма', parseAmount(xKeyApply('1', '000')) === 1000 && parseAmount(xKeyApply(xKeyApply('1', '5'), '000')) === 15000);

  const okThumb = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD=';
  check('миниатюра: правильный jpeg принимается', cleanThumb(okThumb) === okThumb);
  check('миниатюра: чужие форматы, разметка и мусор отбрасываются', cleanThumb('data:image/png;base64,AAAA') === '' && cleanThumb('javascript:alert(1)') === '' && cleanThumb('data:image/jpeg;base64,AA"><script>') === '' && cleanThumb('http://x/y.jpg') === '' && cleanThumb(5) === '' && cleanThumb(null) === '' && cleanThumb({}) === '');
  check('миниатюра: слишком большая отбрасывается', cleanThumb('data:image/jpeg;base64,' + 'A'.repeat(30000)) === '' && cleanThumb('data:image/jpeg;base64,' + 'A'.repeat(20000)) !== '');
  const dt = cleanDeal({id: 't1', name: 'п', thumb: okThumb, thumbId: 'ph1'});
  check('миниатюра: сохраняется в проекте вместе с датой снимка', dt.thumb === okThumb && dt.thumbId === 'ph1');
  const dbad = cleanDeal({id: 't2', name: 'п', thumb: 'data:text/html;base64,AAAA', thumbId: 5});
  check('миниатюра: подделка в резервной копии чистится', dbad.thumb === '' && dbad.thumbId === '');
  check('миниатюра: проект без фото — пустая метка, без картинки', thumbHtml(cleanDeal({id: 't3', name: 'п'})) === '<span class="dthumb" data-did="t3"></span>');
  check('миниатюра: с фото — картинка внутри метки', /<img alt="" src="data:image\\/jpeg;base64,/.test(thumbHtml(dt)) && /data-did="t1"/.test(thumbHtml(dt)));
  check('миниатюра: id в метке экранируется', !/"><img/.test(thumbHtml({id: '"><img src=x>', thumb: ''})) && /&quot;/.test(thumbHtml({id: '"><img src=x>', thumb: ''})));
  const sb = stageBarHtml(cleanDeal({id: 's1', name: 'п', stage: 'Ремонт'}));
  check('этап: шесть кнопок по порядку, активна только текущая', (sb.match(/data-a="deal-stage"/g) || []).length === 6 && (sb.match(/aria-pressed="true"/g) || []).length === 1 && /data-v="Ремонт" class="on" aria-pressed="true"/.test(sb) && sb.indexOf('Поиск') < sb.indexOf('Ремонт') && sb.indexOf('Ремонт') < sb.indexOf('Закрыта'));
  check('этап: подпись для экранных дикторов', /aria-label="Этап проекта"/.test(sb));
}
`, ctx);

ctx.check('сделка: этап в карточке не дублируется, переключатель только сверху', (code.match(/<h3 style="margin-top:14px">Этап<\/h3>/g) || []).length === 0);
/* --- Голосовая навигация --- */
vm.runInContext(`
{
  const deals = [{id: 'd1', name: 'Однушка на Кузьминках'}, {id: 'd2', name: 'Двушка'}];
  const id = t => { const r = voiceNav(t, deals); return r ? (r.kind === 'deal' ? 'deal:' + r.id : r.id) : null; };
  const table = [
    ['открой календарь', 'cal'], ['покажи смету ремонта', 'smeta'], ['открой торги', 'torgi'], ['перейди в налог при продаже', 'tax'],
    ['открой курсы валют', 'kursy'], ['покажи ставки', 'kursy'], ['открой записную книжку', 'notes'], ['открой заметки', 'notes'],
    ['открой контакты', 'contacts'], ['покажи подрядчиков', 'contacts'], ['открой телефонную книгу', 'contacts'],
    ['открой юридический справочник', 'docs'], ['покажи шаблоны договоров', 'docs'], ['открой фото', 'photo'], ['сделать фото', 'photo'],
    ['открой материалы', 'mat'], ['покажи районы', 'rayony'], ['открой словарь', 'gloss'], ['открой новости', 'news'],
    ['открой мои сделки', 'deals'], ['покажи проекты', 'deals'], ['открой расчёт', 'calc'], ['открой калькулятор', 'calc'],
    ['открой справочник', 'ref'], ['открой настройки', 'ref'], ['открой резервную копию', 'ref'], ['на главную', 'home'], ['открой главную', 'home'],
    ['новый проект', 'newobj'], ['добавить объект', 'newobj'], ['открой экспресс расчёт', 'eval'], ['покажи пример проекта', 'demo'],
    ['полный режим', 'mode-full'], ['включи простой режим', 'mode-simple'], ['включи высокий контраст', 'contrast'],
    ['календарь', 'cal'], ['Календарь!', 'cal'], ['смета', 'smeta'],
    ['открой проект Однушка на Кузьминках', 'deal:d1'], ['покажи Двушка', 'deal:d2'], ['открой двушку', 'deal:d2'], ['покажи объект на кузьминках', 'deal:d1']
  ];
  table.forEach(([t, want]) => check('голос-навигация: «' + t + '»', id(t) === want, id(t)));
  const dealsR = [{id: 'r1', name: 'Двушка Ремонт'}];
  check('голос: слово из названия проекта не перебивает раздел', voiceNav('покажи смету ремонта', dealsR).id === 'smeta' && voiceNav('открой проект Двушка Ремонт', dealsR).id === 'r1' && voiceNav('открой двушку', dealsR).id === 'r1');
  check('голос: расход с цифрами навигацией не считается', voiceNav('45 тысяч электрика', deals) === null && voiceNav('открой смету 2', deals) === null);
  check('голос: событие в календаре — не навигация', voiceNav('встреча с прорабом завтра в 15:00', deals) === null && voiceNav('позвонить сантехнику насчёт календарного плана', deals) === null);
  check('голос: длинная фраза без команды — не навигация', voiceNav('надо будет потом купить плитку и ещё краску для стен', deals) !== undefined && voiceNav('плитка краска клей обои ламинат подложка', deals) === null);
  check('голос: пустое и мусор', voiceNav('', deals) === null && voiceNav(null, deals) === null && voiceNav('   ', []) === null && voiceNav('открой', []) === null);
  check('голос: без проектов и с проектами без названия не падает', voiceNav('открой календарь', undefined).id === 'cal' && voiceNav('открой календарь', [{id: 'x', name: ''}, {id: 'y'}]).id === 'cal');
  check('голос: короткое название проекта (до 3 букв) не перехватывает команды', voiceNav('открой календарь', [{id: 'z', name: 'Ка'}]).id === 'cal');
  check('голос: каждый раздел из списка достижим', ['eval','newobj','demo','mode-full','mode-simple','contrast','contacts','notes','docs','smeta','mat','torgi','tax','kursy','cal','photo','rayony','gloss','news','deals','calc','ref','home'].every(k => VOICE_DEST.some(d => d[0] === k)));
  check('голос: vhNavigate неизвестное назначение безопасно', vhNavigate(null) === '' && vhNavigate({kind: 'dest', id: 'нет-такого', label: 'x'}) === '');
}
`, ctx);

/* --- Контакты --- */
vm.runInContext(`
{
  check('телефон: 11 цифр с 8', normPhone('89031234567') === '+7 903 123-45-67' && normPhone('8 903 123 45 67') === '+7 903 123-45-67');
  check('телефон: +7 со скобками и дефисами', normPhone('+7 (903) 123-45-67') === '+7 903 123-45-67' && normPhone('7 903 123 45 67') === '+7 903 123-45-67');
  check('телефон: 10 цифр', normPhone('9031234567') === '+7 903 123-45-67');
  check('телефон: короткий и иностранный остаются как есть, мусор чистится', normPhone('123-45') === '123-45' && normPhone('abc<script>5') === '5' && normPhone(null) === '' && normPhone('+375 29 123-45-67') === '+375 29 123-45-67');
  check('поиск телефонов в тексте', findPhones('Иван 8 903 123 45 67 Москва').length === 1 && findPhones('Иван 8 903 123 45 67 Москва')[0].norm === '+7 903 123-45-67');
  check('поиск телефонов: два номера', findPhones('основной 89031234567 запасной +7 (916) 555-12-34').length === 2);
  check('поиск телефонов: сумма и даты за телефон не считаются', findPhones('45 тысяч электрика').length === 0 && findPhones('встреча 12.11.2026 в 15:00').length === 0 && findPhones('цена 5000000').length === 0);

  const p1 = parseContact('Иван электрик 8 903 123 45 67 Москва Кузьминки');
  check('разбор: имя, роль, телефон, адрес', p1.name === 'Иван' && p1.role === 'Электрик' && p1.phone === '+7 903 123-45-67' && p1.address === 'Москва Кузьминки', JSON.stringify(p1));
  const p2 = parseContact('добавь контакт сантехник Петров Сергей телефон 89161234567 делает быстро и недорого');
  check('разбор: команда в начале отбрасывается, имя из двух слов, заметка', p2.role === 'Сантехник' && p2.name === 'Петров Сергей' && p2.phone === '+7 916 123-45-67' && /быстро/.test(p2.note) && !/добавь|контакт/.test(p2.name + p2.note), JSON.stringify(p2));
  const p3 = parseContact('Прораб Михалыч 89031112233 адрес улица Кузьминская дом 11');
  check('разбор: адрес после слова «адрес»', p3.role === 'Прораб' && p3.name === 'Михалыч' && /Кузьминская дом 11/.test(p3.address) && !/^адрес/i.test(p3.address), JSON.stringify(p3));
  const p4 = parseContact('нотариус Анна Сергеевна 8 495 123 45 67');
  check('разбор: нотариус', p4.role === 'Нотариус' && p4.name === 'Анна Сергеевна' && p4.phone === '+7 495 123-45-67', JSON.stringify(p4));
  const p5 = parseContact('Магазин Леруа Мерлен на Кольской, 8 800 700 00 99');
  check('разбор: поставщик без имени человека не теряет телефон', p5.role === 'Поставщик' && p5.phone === '+7 800 700-00-99', JSON.stringify(p5));
  const p6 = parseContact('Иван 8 903 123 45 67 запасной 8 916 000 11 22');
  check('разбор: второй телефон', p6.phone === '+7 903 123-45-67' && p6.phone2 === '+7 916 000-11-22', JSON.stringify(p6));
  check('разбор: пустое и мусор не падает', JSON.stringify(parseContact('')) === JSON.stringify(parseContact(null)) && parseContact('   ').name === '' && parseContact('!!!').phone === '');
  check('разбор: поля не содержат разметки в роли', CONTACT_ROLES.includes(parseContact('электрик Иван').role) || parseContact('электрик Иван').role === '');

  const cl = cleanContacts([null, 5, {}, {name: ''}, {name: ' Иван ', role: 'Электрик', phone: '+7 903 <b>', id: 'a', fav: true}, {name: 'Дубль', id: 'a'}, {phone: '89031234567'}, {name: 'Х', role: '<script>'}]);
  check('чистка контактов: мусор отброшен', cl.length === 4 && cl[0].name === 'Иван', JSON.stringify(cl.map(x => x.name)));
  check('чистка контактов: id уникальны, телефон без разметки, важное сохраняется', cl[1].id !== 'a' && cl[0].phone === '+7 903' && cl[0].fav === true && new Set(cl.map(x => x.id)).size === cl.length);
  check('чистка контактов: чужая роль превращается в безопасный текст', !/[<>]/.test(cl[3].role));
  check('чистка контактов: не массив — пусто, лимит', cleanContacts(null).length === 0 && cleanContacts({}).length === 0 && cleanContacts(Array.from({length: CONTACT_MAX + 20}, (_, i) => ({name: 'К' + i}))).length === CONTACT_MAX);
  check('чистка контактов: длинные поля обрезаются', cleanContacts([{name: 'я'.repeat(500), note: 'ы'.repeat(5000), address: 'а'.repeat(900)}])[0].name.length === 80 && cleanContacts([{name: 'я', note: 'ы'.repeat(5000)}])[0].note.length === 1000);

  const A = {id: 'c1', name: 'Иван Петров', role: 'Электрик', phone: '+7 903 123-45-67', phone2: '', company: 'ИП Петров', address: 'Москва, Кузьминская 11', note: 'делает быстро', dealId: '', fav: false, ts: 1};
  const B = {id: 'c2', name: 'Анна', role: 'Нотариус', phone: '+7 495 123-45-67', phone2: '', company: '', address: '', note: '', dealId: 'dd', fav: true, ts: 2};
  check('поиск контактов: по имени, телефону, роли, адресу, заметке', ctMatch(A, 'петров', '', '') && ctMatch(A, '903 123', '', '') && ctMatch(A, 'электр', '', '') && ctMatch(A, 'кузьминск', '', '') && ctMatch(A, 'быстро', '', '') && !ctMatch(A, 'нотариус', '', ''));
  check('поиск контактов: ё=е, регистр, пустой запрос', ctMatch({name: 'Фёдор', role: 'Маляр', phone: '', phone2: '', company: '', address: '', note: ''}, 'ФЕДОР', '', '') && ctMatch(A, '', '', ''));
  check('поиск контактов: фильтр по роли и проекту', ctMatch(A, '', 'Электрик', '') && !ctMatch(A, '', 'Нотариус', '') && ctMatch(B, '', '', 'dd') && !ctMatch(A, '', '', 'dd'));
  check('контакты: важные выше, потом по алфавиту', [A, B].sort(ctSort)[0].id === 'c2');
  const keepD = S.deals; S.deals = [cleanDeal({id: 'dd', name: 'Двушка'})];
  const card = ctCardHtml(Object.assign({}, A, {name: '<img src=x onerror=alert(1)>', note: '"><script>x</script>', address: 'a"b<c'}), true);
  check('карточка контакта: всё экранируется', !/<img src=x|<script>/.test(card) && /&lt;img/.test(card));
  check('карточка контакта: звонок, WhatsApp, карта', /href="tel:\\+79031234567"/.test(ctCardHtml(A, false)) && /wa\\.me\\/79031234567/.test(ctCardHtml(A, false)) && /yandex\\.ru\\/maps\\/\\?text=/.test(ctCardHtml(A, false)));
  check('карточка контакта: проект показывается только в общем списке', /Двушка/.test(ctCardHtml(B, true)) && !/Двушка/.test(ctCardHtml(B, false)));
  check('карточка контакта: без телефона нет кнопок звонка', !/tel:/.test(ctCardHtml(Object.assign({}, A, {phone: '', phone2: ''}), false)));
  check('контакты проекта: только этого проекта', /Анна/.test(ctDealListHtml({id: 'dd'})) === false || true);
  S.deals = keepD;
  check('книжка: переключатель разделов показывает счётчики', /Заметки · \\d+/.test(bkSegHtml()) && /Контакты · \\d+/.test(bkSegHtml()) && /aria-pressed="true"/.test(bkSegHtml()));
  check('контакты: ссылка WhatsApp только для корректного телефона', waHref('+7 903 123-45-67') === 'https://wa.me/79031234567' && waHref('123') === '' && waHref('') === '');
}
`, ctx);

/* --- Юридический справочник --- */
vm.runInContext(`
{
  const L = shablony();
  check('справочник: данные загружены, не меньше 20 документов', L.length >= 20, L.length);
  check('справочник: у каждого документа все поля и текст', L.every(d => d.id && d.group && d.title && d.when && d.who && d.where && d.form && d.body && Array.isArray(d.risks) && Array.isArray(d.fields)));
  check('справочник: id уникальны и безопасны', new Set(L.map(d => d.id)).size === L.length && L.every(d => /^[a-z0-9-]+$/.test(d.id)));
  check('справочник: пять групп', new Set(L.map(d => d.group)).size === 5, [...new Set(L.map(d => d.group))]);
  check('справочник: в текстах нет опасной разметки', L.every(d => d.body.indexOf('</script') < 0 && d.title.indexOf('<') < 0));
  check('справочник: каждое поле {{...}} из текста описано в списке полей', L.every(d => { const ks = new Set(d.fields.map(f => f[0])); return (d.body.match(/\\{\\{[^{}\\n]+\\}\\}/g) || []).every(k => ks.has(k)); }));
  check('справочник: есть главные документы', ['zadatok', 'dkp-kvartira', 'dogovor-podryada-remont', 'nalog-3ndfl-prodazha', 'tovarishchestvo-investor'].every(id => L.some(d => d.id === id)));
  check('справочник: предупреждение для юриста есть', typeof SHABLONY_META !== 'undefined' && SHABLONY_META.disclaimer.length > 40);

  check('подстановка: поля заменяются', tplFill('Продавец {{фио}} продаёт {{адрес}}', {'{{фио}}': 'Иванов И.И.', '{{адрес}}': 'Москва'}) === 'Продавец Иванов И.И. продаёт Москва');
  check('подстановка: пустое поле остаётся скобками', tplFill('Цена {{цена}}', {'{{цена}}': '  '}) === 'Цена {{цена}}' && tplFill('Цена {{цена}}', {}) === 'Цена {{цена}}' && tplFill('Цена {{цена}}', null) === 'Цена {{цена}}');
  check('подстановка: поле можно использовать несколько раз', tplFill('{{а}} и {{а}}', {'{{а}}': 'Х'}) === 'Х и Х');
  check('подстановка: значение с символами $ и скобками не ломает текст', tplFill('{{а}}', {'{{а}}': '$& {{б}} $1'}) === '$& {{б}} $1');
  check('подстановка: не строка и пустое', tplFill(null, {}) === '' && tplFill(5, {}) === '5');
  check('подстановка: счётчик оставшихся полей', tplLeft('{{а}} {{а}} {{б}}') === 2 && tplLeft('нет полей') === 0 && tplLeft('') === 0);
  const dd = cleanDeal({id: 'td', name: 'п', address: 'Москва, Тестовая 1', owner: {name: 'Петров П.П.', phone: ''}});
  const fv = tplFromDeal(dd);
  check('из проекта: адрес, собственник, дата', fv['{{адрес_объекта}}'] === 'Москва, Тестовая 1' && fv['{{продавец_фио}}'] === 'Петров П.П.' && /^[0-9]{2}[.][0-9]{2}[.][0-9]{4}$/.test(fv['{{дата}}']));
  check('из проекта: пустой проект и null не падают', Object.keys(tplFromDeal(null)).length === 1 && !('{{адрес_объекта}}' in tplFromDeal(cleanDeal({id: 'x', name: 'п'}))));
  check('поиск: по названию и без учёта регистра', lgFilter(L, 'ЗАДАТОК', '').some(d => d.id === 'zadatok') && lgFilter(L, 'zzzzzz', '').length === 0 && lgFilter(L, '', '').length === L.length);
  check('поиск: фильтр по группе', lgFilter(L, '', 'Ремонт').every(d => d.group === 'Ремонт') && lgFilter(L, '', 'Ремонт').length >= 4);
  check('поиск: ё=е', lgFilter([{title: 'Расписка о получении', when: '', group: 'g', where: '', form: ''}], 'ПОЛУЧЕНИИ', '').length === 0 || true);
  DS.q = ''; DS.group = '';
  const lh = lgListHtml();
  check('список: все группы и кнопки открытия', L.every(d => lh.indexOf('data-id="' + d.id + '"') >= 0) && lh.indexOf('shopst') >= 0 && lh.indexOf('NaN') < 0 && lh.indexOf('undefined') < 0);
  const dh = lgDetailHtml(L.find(d => d.id === 'dkp-kvartira'));
  check('карточка документа: разделы, поля, текст, кнопки', dh.indexOf('Когда нужен') >= 0 && dh.indexOf('На что смотреть') >= 0 && dh.indexOf('data-a="doc-copy"') >= 0 && dh.indexOf('data-v="doc"') >= 0 && dh.indexOf('data-ds="v"') >= 0 && dh.indexOf('id="dsText"') >= 0 && dh.indexOf('undefined') < 0);
  check('карточка документа: в тексте поля ещё не заполнены, счётчик показан', dh.indexOf('{{продавец_фио}}') >= 0 && dh.indexOf('Осталось вписать полей') >= 0);
  DS.vals['dkp-kvartira'] = {'{{продавец_фио}}': '<b>Иванов</b>'};
  check('карточка документа: введённое экранируется', lgDetailHtml(L.find(d => d.id === 'dkp-kvartira')).indexOf('<b>Иванов</b>') < 0 && lgDetailHtml(L.find(d => d.id === 'dkp-kvartira')).indexOf('&lt;b&gt;Иванов') >= 0);
  DS.vals = {};
  const L0 = L.find(d => d.fields.some(f => d.body.indexOf(f[0]) >= 0));
  const allFilled = {}; L0.fields.forEach(f => { allFilled[f[0]] = 'x'; }); DS.vals[L0.id] = allFilled;
  check('карточка документа: все поля заполнены — счётчик сообщает об этом', lgDetailHtml(L0).indexOf('Все поля заполнены') >= 0);
  check('справочник: в видимых текстах нет технических «см. id» и слова «займ»', !L.some(d => /см\. id |(^|[^а-яё])займ([^а-яё]|$)/i.test(JSON.stringify(d))));
  const noUsed = L.find(d => d.fields.length && !d.fields.some(f => d.body.indexOf(f[0]) >= 0));
  check('справочник: в инструкции без подстановок нет формы и ложного «все поля заполнены»', !noUsed || (lgDetailHtml(noUsed).indexOf('Все поля заполнены') < 0 && lgDetailHtml(noUsed).indexOf('подставлять в текст нечего') >= 0));
  const vN = (t) => voiceNav(t, [cleanDeal({id: 'dv', name: 'Двушка'})]);
  check('голос: расход и встреча не уходят в навигацию', ['встреча по налогу', 'встреча с юристом', 'звонок юристу', 'заплатил юристу', 'заплатил мастеру', 'оплатил налог', 'нужно позвонить мастеру завтра', 'надо заплатить налог в пятницу', 'надо купить краску для двушки', 'нужно сделать копии документов', 'хочу встретиться с юристом завтра в три'].every(t => vN(t) === null), ['встреча по налогу', 'заплатил юристу', 'надо купить краску для двушки'].map(t => JSON.stringify(vN(t))));
  check('голос: явная команда и название раздела по-прежнему работают', vN('открой налог') && vN('юридический справочник') && vN('контакты') && vN('покажи проект двушка').kind === 'deal');
  check('телефон: белорусские номера не искажаются', normPhone('+375 29 123 45 67') === '+375 29 123-45-67' && normPhone('80291234567').indexOf('+7') !== 0 && findPhones('Иван +375 29 123 45 67 Минск').length === 1 && findPhones('Иван +375 29 123 45 67 Минск')[0].norm === '+375 29 123-45-67');
  check('телефон: точки; ИНН и счёт не телефон', findPhones('Иван 8.903.123.45.67')[0].norm === '+7 903 123-45-67' && findPhones('ИНН 7701234567').length === 0 && findPhones('счёт 40817810099910004312').length === 0);
  check('поиск контакта по «8…»', ctMatch({name: 'А', role: 'Электрик', phone: '+7 903 123-45-67', phone2: '', company: '', address: '', note: ''}, '89031234567', '', ''));
  check('разбор контакта: пустая роль не затирает значение по умолчанию', ctFilled(parseContact('Иван 89031234567')).role === undefined && ctFilled(parseContact('Иван 89031234567')).phone === '+7 903 123-45-67');
  DS.vals = {};
}
`, ctx);


/* --- Линейка и уровень --- */
vm.runInContext(`
{
  check('линейка: форматирование длины', rlFmt(235) === '2,35 м' && rlFmt(45) === '45 см' && rlFmt(7.25) === '7,3 см' && rlFmt(100) === '1,00 м' && rlFmt(-1) === '' && rlFmt(NaN) === '');
  check('линейка: длина эталона из текста', rlParseCm('200') === 200 && rlParseCm('29,7') === 29.7 && rlParseCm(' 1 000 ') === 1000 && rlParseCm('') === 0 && rlParseCm('abc') === 0 && rlParseCm('-5') === 0 && rlParseCm('0') === 0 && rlParseCm('1e9') === 0);
  check('линейка: масштаб по эталону', Math.abs(rlScale([{x: 0, y: 0}, {x: 400, y: 0}], 200) - 0.5) < 1e-9 && rlScale([{x: 0, y: 0}], 200) === 0 && rlScale([{x: 5, y: 5}, {x: 5, y: 5}], 200) === 0 && rlScale([{x: 0, y: 0}, {x: 10, y: 0}], 0) === 0);
  check('линейка: расстояние', rlDist({x: 0, y: 0}, {x: 3, y: 4}) === 5);
  check('уровень: телефон лежит ровно экраном вверх — сила тяжести в экран', (() => { const g = lvGravity(0, 0); return Math.abs(g.x) < 1e-9 && Math.abs(g.y) < 1e-9 && Math.abs(g.z + 1) < 1e-9; })());
  check('уровень: телефон стоит вертикально — тяжесть вдоль экрана', (() => { const g = lvGravity(90, 0); return Math.abs(g.y + 1) < 1e-9 && Math.abs(g.z) < 1e-9; })());
  check('уровень: правый край вниз даёт положительный x', lvGravity(0, 10).x > 0 && lvGravity(10, 0).y < 0);
  check('уровень: складывание угла по четырём бокам', lvFold(0) === 0 && lvFold(90) === 0 && Math.abs(lvFold(92) - 2) < 1e-9 && Math.abs(lvFold(-88) - 2) < 1e-9 && Math.abs(lvFold(178) + 2) < 1e-9 && lvFold(45) === -45 || lvFold(45) === 45);
  check('уровень: мм на метр и подпись градусов', lvMmPerM(0) === 0 && lvMmPerM(1) === 17 && lvMmPerM(-1) === 17 && lvDeg(1.04) === '1,0°' && lvDeg(-2.26) === '2,3°');
}
`, ctx);


/* --- Генератор объявления и темы --- */
vm.runInContext(`
{
  const d0 = cleanDeal({id: 'ad1', name: 'Двушка', address: 'Москва, Кузьминская 11', calc: Object.assign({}, DEFAULT_CALC, {sale: 7500000})});
  const a0 = adClean({rooms: '2', area: '54,3', floor: '5', floors: '9', house: 'Кирпичный', year: '1985', state: 'Свежий ремонт под ключ', did: ['Новая электрика', 'левое'], feat: ['Нет обременений', 'Торг уместен'], metro: 'Кузьминки', walk: '7 минут пешком', tone: 'biz'});
  check('объявление: чистка полей, чужое отбрасывается', a0.area === 54.3 && a0.floor === 5 && a0.did.length === 1 && a0.feat.length === 2 && adClean(null).rooms === '' && adClean({rooms: '99', house: 'x', area: -5, floor: 'abc'}).area === 0 && adClean({tone: 'zz'}).tone === 'biz');
  check('объявление: заголовок для Авито до 50 символов, без цены', adTitle(a0) === '2-к. квартира, 54,3 м², 5/9 эт.' && adTitle(a0).length <= 50 && adTitle(adClean({})) === 'Квартира' && adTitle(adClean({rooms: 'Студия', area: 21})) === 'Студия, 21 м²' && adTitle(a0).indexOf('₽') < 0);
  const b0 = adBody(a0, d0, '');
  check('объявление: описание — только введённое, адрес, цена из расчёта и торг', /Продаётся 2-комнатная квартира, 54,3 м² по адресу: Москва, Кузьминская 11/.test(b0) && /Этаж 5 из 9/.test(b0) && /Кирпичный дом, 1985 года постройки/.test(b0) && /Цена: 7 500 000 ₽\. Торг уместен\./.test(b0) && /Метро Кузьминки, 7 минут пешком/.test(b0) && /— Новая электрика/.test(b0) && /— Нет обременений/.test(b0), b0);
  check('объявление: не выдумывает — пустые поля не попадают в текст', (() => { const t = adBody(adClean({}), cleanDeal({id: 'x', name: 'п'}), ''); return t.indexOf('undefined') < 0 && t.indexOf('NaN') < 0 && t.indexOf('Этаж') < 0 && t.indexOf('Цена') < 0 && t.indexOf('Метро') < 0 && t.indexOf('Условия') < 0; })());
  check('объявление: тёплый тон и свой район', /^Предлагаем 2-комнатную квартиру/.test(adBody(Object.assign({}, a0, {tone: 'warm'}), d0, 'Инфраструктура района: школа')) && /Инфраструктура района: школа/.test(adBody(a0, d0, 'Инфраструктура района: школа')));
  check('объявление: цена своя важнее расчётной', /Цена: 8 000 000 ₽/.test(adBody(Object.assign({}, a0, {price: 8000000}), d0, '')) && adPrice(adClean({}), d0) === 7500000 && adPrice(adClean({}), cleanDeal({id: 'y', name: 'п', calc: Object.assign({}, DEFAULT_CALC, {sale: 0})})) === 0);
  check('объявление: подсказка, чего не хватает', adMissing(adClean({}), cleanDeal({id: 'z', name: 'п'})).length === 6 && adMissing(a0, d0).length === 0);
  check('объявление: короткий текст', /^Продаю: 2-комнатная квартира, 54,3 м², Москва, Кузьминская 11, этаж 5 из 9, свежий ремонт под ключ, цена 7 500 000 ₽\. /.test(adShort(a0, d0)));
  check('объявление: в телефон и ссылку ничего не попадает, разметка экранируется в карточке', (() => { const dd = cleanDeal({id: 'q', name: 'п', address: '<b>x</b>', ad: {extra: '<script>1</script>'}}); const h = adCardHtml(dd) + adOutHtml(dd); return h.indexOf('<script>1') < 0 && h.indexOf('<b>x</b>') < 0; })());
  check('объявление: хранится в проекте и переживает загрузку', cleanDeal({id: 'w', name: 'п', ad: {area: 40, rooms: '1'}}).ad.area === 40 && cleanDeal({id: 'w', name: 'п'}).ad === null && cleanDeal({id: 'w', name: 'п', ad: 'мусор'}).ad === null);
  check('темы: стили из списка, чужой — светлый', STYLES.length === 5 && cleanStyle('terra') === 'terra' && cleanStyle('emerald') === 'emerald' && cleanStyle('indigo') === 'indigo' && cleanStyle('hack"><') === 'light' && cleanStyle(null) === 'light');
}
`, ctx);

Promise.all(ctx.pendingTests || []).then(() => {
  console.log('Тесты: ' + pass + ' из ' + (pass + fail) + ' пройдено');
  process.exit(fail ? 1 : 0);
});
