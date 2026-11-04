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

console.log('Тесты: ' + pass + ' из ' + (pass + fail) + ' пройдено');
process.exit(fail ? 1 : 0);
