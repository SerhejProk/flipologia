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

/* --- Отчёт инвестору --- */
{
  const mk = o => Object.assign({id: 'r1', name: 'Однушка <img src=x>', address: 'ул. "Тест" & <b>', stage: 'Ремонт', calc: Object.assign({}, DEFAULT_CALC), expenses: [{id: 'a', cat: 'Ремонт', sum: 900000, date: '2026-11-01', note: ''}, {id: 'b', cat: 'Чужая', sum: 5000, date: '2026-11-01', note: ''}], works: cleanWorks({start: today(), items: []}), saleFact: 0}, o || {});
  const h = reportHtml(mk());
  check('отчёт: название и адрес экранированы', !h.includes('<img src=x>') && h.includes('&lt;img') && h.includes('&amp; &lt;b&gt;'), h.slice(0, 200));
  check('отчёт: есть ключевые цифры и прогноз', h.includes('Ключевые цифры') && h.includes('Прогноз чистой прибыли') && h.includes(rub(compute(DEFAULT_CALC).net - 100000 - 5000)), '');
  check('отчёт: перерасход и план/факт', h.includes('перерасход ' + rub(100000)) && h.includes('Структура вложений') && h.includes('График ремонта'));
  check('отчёт: есть оговорка про гарантию дохода', h.includes('не гарантия дохода'));
  const h2 = reportHtml(mk({calc: null, works: null, expenses: []}));
  check('отчёт: сделка без расчёта — без падения и без прогноза', h2.includes('Расчёт по объекту ещё не заполнен') && !h2.includes('Прогноз чистой прибыли') && !h2.includes('График ремонта'));
  const h3 = reportHtml(mk({saleFact: 8000000}));
  check('отчёт: проданная сделка показывает факт', h3.includes('Продано за') && h3.includes('Фактический результат продажи'));
  const h4 = reportHtml(mk({calc: Object.assign({}, DEFAULT_CALC, {price: 0, sale: 0})}));
  check('отчёт: нулевые цены — без NaN и Infinity', !/NaN|Infinity/.test(h4));
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
  ctx.check('главная: заголовок «Экспресс-расчёт»', /<h3>Экспресс-расчёт<\/h3>/.test(html) && !/<h3>Экспресс-оценка покупки<\/h3>/.test(html) && !/<h3>Быстрая оценка<\/h3>/.test(html));
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
  vm.runInContext("S.tab = 'home'; renderHome();", c);
  const h = view.innerHTML;
  const order = ['Сделать фото', 'Мои проекты', 'Экспресс-расчёт', 'Справочники', 'Календарь', 'Ключевая ставка ЦБ', 'Ставка рефинансирования', 'Ставки и курсы', 'Калькуляторы', 'Новости', 'Голосовой помощник'];
  const idx = order.map(t => h.indexOf(t));
  ctx.check('дашборд: все блоки на месте', idx.every(i => i >= 0), order.filter((t, i) => idx[i] < 0));
  const want = ['Сделать фото', 'Мои проекты', 'Экспресс-расчёт', 'Справочники', 'Календарь', 'Ставки и курсы', 'Калькуляторы', 'Новости', 'Голосовой помощник'].map(t => h.indexOf(t));
  ctx.check('дашборд: порядок блоков как в задаче', want.every((v, i) => i === 0 || v > want[i - 1]), want);
  ctx.check('дашборд: «Новый проект» рядом с «Мои проекты»', /Мои проекты[\s\S]*\+ Новый проект[\s\S]*Экспресс-расчёт/.test(h));
  ctx.check('дашборд: фото первой кнопкой, голос последней', h.indexOf('data-v="photo"') < h.indexOf('Мои проекты') && h.lastIndexOf('<button') === h.lastIndexOf('data-a="soon" data-v="voice"') - '<button class="bigbtn voice" '.length);
  ctx.check('дашборд: ключевая ставка равна ставке рефинансирования', (() => { const m = h.match(/Ключевая ставка ЦБ<\/span><b>([^<]+)<\/b>[\s\S]*?Ставка рефинансирования<\/span><b>([^<]+)<\/b>/); return !!m && m[1] === m[2] && /%/.test(m[1]); })(), h.match(/Ключевая ставка ЦБ<\/span><b>[^<]*/));
  ctx.check('дашборд: без курсов — подсказка, а не пустота', /homeRates">[^]*?(Загружаем|загрузятся|не загрузились)/.test(h));
  vm.runInContext("S.kursy.cache = {date: '2026-11-05', ts: Date.now(), r: {USD: {v: 90.5, p: 90}, EUR: {v: 100, p: 99}, CNY: {v: 12.5, p: 12.4}}}; renderHome();", c);
  const h2 = view.innerHTML;
  ctx.check('дашборд: курсы USD/EUR/CNY показаны с датой', /Курс ЦБ РФ на 05\.11\.2026/.test(h2) && /90,50 ₽/.test(h2) && /100,00 ₽/.test(h2) && /12,50 ₽/.test(h2), h2.match(/homeRates">[^]*?<button/));
  vm.runInContext("S.kursy.cache = {date: '2026-11-05', ts: Date.now(), r: {USD: null, EUR: {v: NaN, p: 1}}}; renderHome();", c);
  ctx.check('дашборд: битый кэш курсов не роняет главную', view.innerHTML.includes('Голосовой помощник'));
  vm.runInContext("S.deals = []; renderHome();", c);
  ctx.check('дашборд: без проектов — подсказка и «Пример проекта»', /Проектов пока нет/.test(view.innerHTML) && /Пример проекта/.test(view.innerHTML));
  vm.runInContext("S.deals = [{id: 'x', name: '<img src=x onerror=1>', stage: 'Поиск', expenses: [], works: null}]; renderHome();", c);
  ctx.check('дашборд: название проекта экранировано', !view.innerHTML.includes('<img src=x') && view.innerHTML.includes('&lt;img'));
  ctx.check('дашборд: заглушка осталась только у голоса, календарь «скоро»', (view.innerHTML.match(/data-a="soon"/g) || []).length === 1 && /Календарь[\s\S]*скоро/.test(view.innerHTML));
  ctx.check('дашборд: «Сделать фото» ведёт в раздел фото', /data-a="home-push" data-v="photo"/.test(view.innerHTML));
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

Promise.all(ctx.pendingTests || []).then(() => {
  console.log('Тесты: ' + pass + ' из ' + (pass + fail) + ' пройдено');
  process.exit(fail ? 1 : 0);
});
