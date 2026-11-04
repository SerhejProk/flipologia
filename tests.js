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
  check('копия: вкладка и цена м²', s.tab === 'calc' && s.sellM2 === 0 && s.calcDeal === null);
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
`, ctx);

console.log('Тесты: ' + pass + ' из ' + (pass + fail) + ' пройдено');
process.exit(fail ? 1 : 0);
