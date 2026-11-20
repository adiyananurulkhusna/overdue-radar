// Overdue Radar dashboard. Reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, filters, a per-protocol detail drawer with the model's own
// inputs, the protocol's age and overdue band, and its farm plan. No network: every byte
// it shows is in data.js. The page recomputes each row's headline number from the snapshot
// figures it carries, so the page's arithmetic and the board's data are visibly the same.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = {
    q: '', category: 'all', chain: 'all', tvl: 0, band: 'all', watchlist: false,
    tab: 'pre-token', sort: 'implied', dir: -1, selected: null
  };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y (' + days + 'd)';
    return days + 'd';
  }
  function money(n) { return '$' + Number(n).toLocaleString('en-US'); }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (k === 'checked') node.checked = !!attrs[k];
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The model in one function: base value x maturity x overdue x growth. The base
  // value is rebuilt from TVL and the median ratio, exactly as the model does, so the
  // recomputation matches board.json to the dollar.
  function impliedOf(row) {
    var age = row.age_days === null ? DATA.model.unknown_age_days : row.age_days;
    var maturity = DATA.model.maturity_floor + (Math.min(Math.max(age, 0), DATA.model.maturity_days) / DATA.model.maturity_days) * DATA.model.maturity_range;
    var growthPct = Math.min(DATA.model.growth_cap, Math.max(DATA.model.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    var growth = 1 + (growthPct / 100) * DATA.model.growth_weight;
    return Math.max(1, Math.round(row.tvl_usd * DATA.median_ratio * maturity * row.overdue_multiplier * growth));
  }

  function bandClass(band) {
    if (band === 'long overdue') return 'band band-long';
    if (band === 'overdue') return 'band band-overdue';
    if (band === 'on schedule') return 'band band-ok';
    return 'band band-unknown';
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tvl')) state.tvl = Number(params.get('tvl')) || 0;
    if (params.get('band')) state.band = params.get('band');
    if (params.get('wl') === '1') state.watchlist = true;
    if (params.get('sort')) state.sort = params.get('sort');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tvl) params.set('tvl', String(state.tvl));
    if (state.band !== 'all') params.set('band', state.band);
    if (state.watchlist) params.set('wl', '1');
    if (state.sort !== 'implied') params.set('sort', state.sort);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function isWatchlist(r) { return r.tvl_usd >= DATA.floor_usd; }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (state.tvl && r.tvl_usd < state.tvl) return false;
      if (state.band !== 'all' && r.overdue_band !== state.band) return false;
      if (state.watchlist && !isWatchlist(r)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Overdue Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    var overdueCount = DATA.rows.filter(function (r) { return r.overdue_band === 'overdue' || r.overdue_band === 'long overdue'; }).length;
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: 'The longest waiters are the most overdue' }),
        el('p', { text: 'A protocol that has held real TVL for years while recording no token is, in the market\u2019s own terms, overdue for one. This board ranks pre-token protocols by an implied value that rewards maturity above all: four years with no token earns the full premium, a fresh listing almost none, and anything older than the typical pre-token protocol (' + DATA.median_age_days + ' days) earns an extra 5% overdue premium. The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Overdue or long overdue' }), el('b', { text: overdueCount + ' rows' })),
        el('div', { class: 'fact' }, el('span', { text: 'Median mcap / TVL' }), el('b', { text: DATA.median_ratio.toFixed(4) })),
        el('div', { class: 'fact' }, el('span', { text: 'Median pre-token age' }), el('b', { text: DATA.median_age_days + ' days' })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.flatMap(function (r) { return r.chains || []; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var chain = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chain.addEventListener('change', function () { state.chain = chain.value; writeHash(); render(); });
    var tvl = el('select', { id: 'tvl', 'aria-label': 'Filter by minimum TVL' },
      [[0, 'Any TVL'], [50e6, 'TVL \u2265 $50M'], [100e6, 'TVL \u2265 $100M'], [500e6, 'TVL \u2265 $500M'], [1e9, 'TVL \u2265 $1B']].map(function (o) {
        return el('option', { value: String(o[0]), text: o[1], selected: state.tvl === o[0] ? 'selected' : null });
      })
    );
    tvl.addEventListener('change', function () { state.tvl = Number(tvl.value); writeHash(); render(); });
    var band = el('select', { id: 'band', 'aria-label': 'Filter by overdue band' },
      [['all', 'Any overdue band'], ['long overdue', 'Long overdue'], ['overdue', 'Overdue'], ['on schedule', 'On schedule'], ['unknown', 'Unknown age']].map(function (o) {
        return el('option', { value: o[0], text: o[1], selected: state.band === o[0] ? 'selected' : null });
      })
    );
    band.addEventListener('change', function () { state.band = band.value; writeHash(); render(); });
    var sort = el('select', { id: 'sort', 'aria-label': 'Sort the board' },
      [['implied', 'Implied value'], ['tvl', 'TVL'], ['growth', '7-day growth'], ['age', 'Age (days with no token)'], ['name', 'Name']].map(function (o) {
        return el('option', { value: o[0], text: o[1], selected: state.sort === o[0] ? 'selected' : null });
      })
    );
    sort.addEventListener('change', function () { state.sort = sort.value; state.dir = state.sort === 'name' ? 1 : -1; writeHash(); render(); });
    var wl = el('input', { type: 'checkbox', id: 'wl', checked: state.watchlist });
    wl.addEventListener('change', function () { state.watchlist = wl.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chain),
      el('div', { class: 'field' }, el('label', { for: 'tvl', text: 'TVL' }), tvl),
      el('div', { class: 'field' }, el('label', { for: 'band', text: 'Overdue band' }), band),
      el('div', { class: 'field' }, el('label', { for: 'sort', text: 'Sort by' }), sort),
      el('label', { class: 'check', for: 'wl' }, wl, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = (key === 'name') ? 1 : -1; } writeHash(); render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' \u25bc' : ' \u25b2' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category, chain, TVL or overdue band to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.tvl = 0; state.band = 'all'; state.watchlist = false; writeHash(); render(); } })
      ));
    }
    var max = Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; })) || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: r.age_days === null ? 'unknown' : String(r.age_days) + 'd' }),
        el('td', null, el('span', { class: bandClass(r.overdue_band), text: r.overdue_band })),
        el('td', null, el('div', { class: 'value-cell' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'value', text: money(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: isWatchlist(r) ? 'watchlist' : 'early' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, most overdue first by implied value. Select a row for its age, model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            el('th', { scope: 'col', text: 'Overdue band' }),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Set' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel section' },
      el('h2', { text: 'How the ranking is computed' }),
      el('div', { class: 'formula' },
        'implied = tvl_usd x ' + DATA.median_ratio.toFixed(4) + ' (median mcap/TVL of token-bearing protocols) x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x overdue x (1 + ' + m.growth_weight + ' x clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100)'
      ),
      el('div', { class: 'formula' }, 'overdue = ' + m.overdue_factor + ' when age_days > median pre-token age (' + DATA.median_age_days + ' days), else 1.00 — long overdue when age_days > ' + (DATA.median_age_days * 2) + ' days'),
      el('p', { text: 'Maturity is the main weight: a protocol listed four years ago with no token on record earns a 1.15x multiplier; one listed last month earns barely above 0.70x. An unknown listing date counts as ' + m.unknown_age_days + ' days. Growth is clamped so one wild week cannot dominate. No protocol name is special-cased, and no row is hand-picked.' }),
      el('p', { text: 'Implied value is a model, not a price prediction: it says what a token might be worth if the market priced this protocol like the median token-bearing protocol. A protocol may never issue a token at all, and an airdrop is never guaranteed.' })
    );
  }

  function overduePanel() {
    var bands = ['long overdue', 'overdue', 'on schedule', 'unknown'];
    var counts = {};
    bands.forEach(function (b) { counts[b] = 0; });
    DATA.rows.forEach(function (r) { counts[r.overdue_band] = (counts[r.overdue_band] || 0) + 1; });
    return el('section', { class: 'panel section' },
      el('h2', { text: 'How overdue is the board?' }),
      el('p', { text: 'Every row is banded against the median pre-token age of ' + DATA.median_age_days + ' days. A protocol past that line is overdue; past twice that line, long overdue.' }),
      el('table', { class: 'mini-table' },
        el('thead', null, el('tr', null, el('th', { text: 'Overdue band' }), el('th', { text: 'Rows' }), el('th', { text: 'Share' }))),
        el('tbody', null, bands.map(function (b) {
          return el('tr', null,
            el('td', null, el('span', { class: bandClass(b), text: b })),
            el('td', { text: String(counts[b] || 0) }),
            el('td', { text: Math.round(((counts[b] || 0) / DATA.board_size) * 100) + '%' })
          );
        }))
      )
    );
  }

  function costPanel() {
    var entries = Object.entries(DATA.gas_table).sort(function (a, b) { return a[1] - b[1] || (a[0] < b[0] ? -1 : 1); });
    return el('section', { class: 'panel section' },
      el('h2', { text: 'Farm cost table' }),
      el('p', { text: 'Estimated all-in cost of one farm step per chain (gas plus the usual swap/pool fee and slippage allowance for a small position). These are planning estimates, not live prices — gas moves. A chain the table does not name costs $' + DATA.gas_default_usd.toFixed(2) + ' a step.' }),
      el('table', { class: 'mini-table' },
        el('thead', null, el('tr', null, el('th', { text: 'Chain' }), el('th', { text: 'Est. cost / step' }))),
        el('tbody', null, entries.map(function (e) {
          return el('tr', null, el('td', { text: e[0] }), el('td', { text: '$' + e[1].toFixed(2) }));
        }))
      )
    );
  }

  var drawer = el('aside', { class: 'drawer', id: 'detail', hidden: true, 'aria-label': 'Protocol detail' });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    drawer.hidden = false;
    drawer.textContent = '';
    var agePct = row.age_days === null ? 0 : Math.min(100, Math.round((row.age_days / DATA.model.maturity_days) * 100));
    drawer.appendChild(el('div', { class: 'drawer-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (isWatchlist(row) ? ' \u00b7 watchlist' : ' \u00b7 early radar') }),
        el('h2', { text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { closeDetail(); } })
    ));
    drawer.appendChild(el('section', { class: 'drawer-section' },
      el('h3', { text: 'How long with no token' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'First listed' }), el('b', { class: 'num', text: row.listed_at || 'not recorded' })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Median pre-token age' }), el('b', { class: 'num', text: DATA.median_age_days + ' days' })),
        el('div', null, el('span', { text: 'Overdue band' }), el('b', null, el('span', { class: bandClass(row.overdue_band), text: row.overdue_band })))
      ),
      el('div', { class: 'age-line' },
        el('span', { class: 'sub', text: '0d' }),
        el('div', { class: 'age-track', 'aria-hidden': 'true' }, el('i', { style: 'width:' + agePct + '%' })),
        el('span', { class: 'sub', text: DATA.model.maturity_days + 'd = full premium' })
      ),
      el('p', { class: 'sub', text: row.overdue_band === 'long overdue' ? 'More than twice the median pre-token age: this protocol has waited longer than almost every other protocol that still records no token.' : row.overdue_band === 'overdue' ? 'Older than the median pre-token protocol, so it earns the 5% overdue premium.' : row.overdue_band === 'on schedule' ? 'Younger than the median pre-token protocol: still early in its wait for a token.' : 'No listing date on record, so the model treats its age as ' + DATA.model.unknown_age_days + ' days.' })
    ));
    drawer.appendChild(el('section', { class: 'drawer-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Median mcap / TVL' }), el('b', { class: 'num', text: DATA.median_ratio.toFixed(4) })),
        el('div', null, el('span', { text: 'Base value (TVL x ratio)' }), el('b', { class: 'num', text: fmtUsd(row.base_value_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Overdue multiplier' }), el('b', { class: 'num', text: String(row.overdue_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'big', text: money(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. Recomputed in this page as ' + money(impliedOf(row)) + (impliedOf(row) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') })
    ));
    drawer.appendChild(el('section', { class: 'drawer-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    drawer.focus();
  }

  function closeDetail() {
    state.selected = null;
    drawer.hidden = true;
    writeHash();
    render();
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') {
      shell.appendChild(el('div', { class: 'two-col' }, overduePanel(), costPanel()));
      shell.appendChild(modelPanel());
    }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!drawer.isConnected) app.appendChild(drawer);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !drawer.hidden) closeDetail();
  });
})();
