#!/usr/bin/env node
// Поиск профилей артистов на 6 стримингах с проверкой лейбла по строке ℗.
//
//   cd tools/streaming-links && npm install && npx playwright install chromium
//   node find-links.mjs --login                              # один раз: войти во VK в окне браузера
//   node find-links.mjs ../../streaming/artists/2026-11-16.txt
//   node find-links.mjs "Владимир Мартынов | Vladimir Martynov"
//
// Ключи: --headed (с окном), --no-verify (без проверки лейбла), --label "Fancymusic" (какой лейбл считать своим),
//        --only Apple,Spotify,YT (только эти площадки — например, из-за рубежа, где остальные закрыты).
// Результат: streaming/results/<имя>.json (все кандидаты с лейблами и слушателями) и <имя>.md (черновик ответа).

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const PROFILE_DIR = path.join(HERE, '.browser-profile');
const RESULTS_DIR = path.resolve(HERE, '..', '..', 'streaming', 'results');
const WAIT_MS = 4000;
// YouTube Music без «настоящего» user agent отвечает «браузер не поддерживается»
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const PLATFORMS = [
  { key: 'Yandex', url: q => `https://music.yandex.ru/search?text=${q}&type=artists`, sel: 'a[href*="/artist/"]',
    norm: h => (h.match(/^(https:\/\/music\.yandex\.ru\/artist\/\d+)/) || [])[1] },
  { key: 'VK', url: q => `https://vk.ru/audio?q=${q}`, sel: 'a[href*="/artist/"]',
    norm: h => (h.match(/^(https:\/\/vk\.(?:ru|com)\/artist\/[^/?#]+)/) || [])[1]?.replace('vk.com', 'vk.ru') },
  { key: 'Zvuk', url: q => `https://zvuk.com/search?query=${q}`, sel: 'a[href*="/artist/"]',
    norm: h => (h.match(/^(https:\/\/zvuk\.com\/artist\/\d+)/) || [])[1] },
  { key: 'Apple', url: q => `https://music.apple.com/ru/search?term=${q}`, sel: 'a[href*="/artist/"]',
    norm: h => (h.match(/^(https:\/\/music\.apple\.com\/ru\/artist\/[^/?#]+\/\d+)/) || [])[1] },
  { key: 'Spotify', url: q => `https://open.spotify.com/search/${q}/artists`, sel: 'a[href*="/artist/"]',
    norm: h => (h.match(/^(https:\/\/open\.spotify\.com\/artist\/[A-Za-z0-9]+)/) || [])[1] },
  { key: 'YT', url: q => `https://music.youtube.com/search?q=${q}`, sel: 'a[href*="channel/"], a[href*="/@"]',
    norm: h => (h.match(/^(https:\/\/music\.youtube\.com\/(?:channel\/[\w-]+|@[\w.-]+))/) || [])[1] },
];

// --- сопоставление имён -------------------------------------------------
const TR = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'i',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
const norm = s => (s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
const translit = s => [...norm(s)].map(c => TR[c] ?? c).join('');
// общие слова вроде «оркестр» или «камерный» не считаются совпадением имени
const STOP = new Set(['orchestra','orkestr','chamber','kamernyi','ensemble','ansambl','symphony','simfonicheskii','quartet','kvartet','trio','choir','hor','soloists','solisty','state','gosudarstvennyi','russian','rossiiskii','moscow','moskovskii','music','muzyka','band']);
const tokens = s => translit(s).split(' ').filter(t => t.length >= 4 && !STOP.has(t));
function matches(text, names) {
  const tt = new Set(tokens(text));
  const flatT = translit(text).replace(/ /g, '');
  return names.some(n => {
    const flatN = translit(n).replace(/ /g, '');
    if (flatN.length >= 5 && (flatT.includes(flatN) || (flatT.length >= 5 && flatN.includes(flatT)))) return true;
    const nt = tokens(n); // имя + фамилия: нужны оба токена, иначе подойдёт любой «Илья»
    return nt.length > 0 && nt.filter(t => tt.has(t)).length >= Math.min(2, nt.length);
  });
}
// «Ilya Ioff; Lidia Kovalenko; …» — сборный профиль, который площадка завела из кривых метаданных
const isCombined = text => /[;,&]|\s(feat|ft)\.?\s/i.test(text.replace(/\s·\s.*$/, ''));

// --- поиск ---------------------------------------------------------------
async function collect(page, platform, query) {
  await page.goto(platform.url(encodeURIComponent(query)), { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(WAIT_MS);
  const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 2000);
  const blocked = /not available in your region|недоступн[а-я]* в вашем регионе/i.test(body) ? 'region-blocked'
    : /пройдите проверку|не с ботом|captcha/i.test(body) ? 'captcha'
    : /не поддерживается в вашем браузере|browser is not supported/i.test(body) ? 'browser-unsupported'
    : null;
  const raw = await page.$$eval(platform.sel, as => as.map(a => ({ href: a.href, text: (a.textContent || a.getAttribute('aria-label') || '').trim().slice(0, 160) })));
  const byUrl = new Map();
  for (const { href, text } of raw) {
    const u = platform.norm(href);
    if (!u) continue;
    const prev = byUrl.get(u);
    if (!prev || (text && text.length > (prev.text || '').length)) byUrl.set(u, { url: u, text });
  }
  // VK без входа показывает «Войти» или «Загружается…» и ни одной ссылки на артиста
  const vkLogin = platform.key === 'VK' && !byUrl.size && !/Профиль/.test(body) ? 'login-required' : null;
  return { blocked: blocked || vkLogin, links: [...byUrl.values()] };
}

// --- проверка профиля: релизы, лейблы ℗, слушатели ------------------------
// Apple и Spotify показывают строку ℗ на странице релиза без входа.
async function verify(page, platform, url, label) {
  const sp = platform === 'Spotify';
  const r = { name: '', listeners: null, releases: 0, checked: 0, labels: {}, ours: false };
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(sp ? 5000 : 3500);
  r.name = (await page.title()).replace(/[‎‏]/g, '').split(/ — Apple Music| Songs \| Spotify/)[0].replace(/^Listen to /, '').trim();
  if (sp) {
    const og = await page.$eval('meta[property="og:description"]', m => m.content).catch(() => '');
    const m = og.match(/([\d.,]+)\s*([KM])?\s*monthly listeners/i);
    if (m) r.listeners = Math.round(parseFloat(m[1].replace(',', '')) * ({ K: 1e3, M: 1e6 }[m[2]] || 1));
  }
  let albums = [...new Set(await page.$$eval('a[href*="/album/"]', as => as.map(a => a.href.split('?')[0])))];
  if (sp && albums.length < 3) { // без входа Spotify показывает топ-треки, альбомы достаём через них
    const tracks = [...new Set(await page.$$eval('a[href*="/track/"]', as => as.map(a => a.href.split('?')[0])))].slice(0, 6);
    for (const t of tracks) {
      await page.goto(t, { waitUntil: 'domcontentloaded', timeout: 45000 }); await page.waitForTimeout(2500);
      albums.push(...await page.$$eval('a[href*="/album/"]', as => as.map(a => a.href.split('?')[0])));
    }
    albums = [...new Set(albums)];
  }
  r.releases = albums.length;
  const re = new RegExp(label.replace(/\s+/g, '\\s*'), 'i');
  for (const a of albums.slice(0, sp ? 8 : 20)) {
    await page.goto(a, { waitUntil: 'domcontentloaded', timeout: 45000 }); await page.waitForTimeout(sp ? 3500 : 2200);
    const t = await page.locator('body').innerText().catch(() => '');
    for (const l of new Set((t.match(/℗[^\n]{0,70}/g) || []).map(s => s.replace(/℗\s*(\(P\)\s*)?\d{4}\s*/, '').trim())))
      r.labels[l] = (r.labels[l] || 0) + 1;
    r.checked++;
    if (re.test(t.match(/℗[^\n]{0,70}/g)?.join(' ') || '')) r.ours = true;
  }
  return r;
}

async function login() {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: false, locale: 'ru-RU', userAgent: UA });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('https://vk.ru/login');
  console.log('Войдите во VK (и при желании в другие сервисы) в открывшемся окне, затем закройте окно браузера.');
  await new Promise(r => ctx.on('close', r));
}

function parseArtists(arg) {
  const lines = fs.existsSync(arg) ? fs.readFileSync(arg, 'utf8').split('\n') : [arg];
  return lines.map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => l.split('|').map(s => s.trim()).filter(Boolean));
}

function toMarkdown(out) {
  const order = c => [c.verify?.ours ? 0 : 1, c.combined ? 1 : 0, -(c.verify?.listeners ?? c.verify?.releases ?? 0)];
  const cmp = (a, b) => { const x = order(a), y = order(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
  return out.map(a => {
    const n = PLATFORMS.filter(p => a.platforms[p.key].candidates.length).length;
    const parts = [`**${a.names[0]} [${n}]**`], notes = [];
    for (const p of PLATFORMS) {
      const { candidates, notes: pn } = a.platforms[p.key];
      parts.push(`\n**${p.key}:**`);
      if (!candidates.length) { parts.push(`- не найден${pn.length ? ' (' + pn.join(', ') + ')' : ''}`); continue; }
      for (const c of [...candidates].sort(cmp)) {
        parts.push(`- ${c.url}`);
        const v = c.verify;
        if (v) notes.push(`${p.key} ${c.url.split('/').pop()} «${v.name || c.text}»: ${v.ours ? '✓ лейбл найден' : 'лейбл не найден'}`
          + `${v.listeners != null ? `, ${v.listeners} слуш./мес.` : ''}, релизов ${v.releases}${c.combined ? ', сборный профиль' : ''}`
          + ` — ${Object.keys(v.labels).slice(0, 3).join('; ') || 'нет данных'}`);
      }
    }
    if (notes.length) parts.push('\nПроверка (черновик, удалить из ответа):\n' + notes.map(s => '- ' + s).join('\n'));
    return parts.join('\n');
  }).join('\n\n---\n\n');
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--login') return login();
  const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const input = args.find((a, i) => !a.startsWith('--') && !['--label', '--only'].includes(args[i - 1]));
  const only = opt('--only')?.split(',').map(s => s.trim().toLowerCase());
  const platforms = only ? PLATFORMS.filter(p => only.includes(p.key.toLowerCase())) : PLATFORMS;
  if (!input) { console.error('Укажите файл со списком или имя артиста.'); process.exit(1); }
  const label = opt('--label') || 'Fancy\\s*music';
  const artists = parseArtists(input);
  const base = fs.existsSync(input) ? path.basename(input, path.extname(input)) : 'single';
  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: !args.includes('--headed'), locale: 'ru-RU', userAgent: UA });
  const page = ctx.pages()[0] || await ctx.newPage();
  const out = [];
  for (const names of artists) {
    const entry = { names, platforms: {} };
    for (const p of PLATFORMS) {
      if (!platforms.includes(p)) { entry.platforms[p.key] = { candidates: [], unmatched: [], notes: ['skipped'] }; continue; }
      const found = new Map(); const notes = new Set(); const other = new Map();
      for (const q of names) {
        try {
          const { blocked, links } = await collect(page, p, q);
          if (blocked) notes.add(blocked);
          for (const l of links) (matches(l.text, names) ? found : other).set(l.url, l);
        } catch (e) { notes.add('error: ' + e.message.split('\n')[0]); }
      }
      const candidates = [...found.values()].map(c => ({ ...c, combined: isCombined(c.text) }));
      if (!args.includes('--no-verify') && (p.key === 'Apple' || p.key === 'Spotify'))
        for (const c of candidates.filter(c => !c.combined)) { // сборные профили не проверяем: свой профиль у артиста отдельный
          try { c.verify = await verify(page, p.key, c.url, label); } catch (e) { c.verify = { error: e.message.split('\n')[0], labels: {} }; }
        }
      entry.platforms[p.key] = { candidates, unmatched: [...other.values()].filter(l => !found.has(l.url)).slice(0, 15), notes: [...notes] };
      const ours = candidates.filter(c => c.verify?.ours).length;
      process.stdout.write(`${names[0]} — ${p.key}: ${found.size}${ours ? `, с лейблом ${ours}` : ''}${notes.size ? ' (' + [...notes].join(', ') + ')' : ''}\n`);
    }
    out.push(entry);
    // сохраняем после каждого артиста: если прогон оборвётся, готовое не потеряется
    fs.writeFileSync(path.join(RESULTS_DIR, base + '.json'), JSON.stringify(out, null, 2));
    fs.writeFileSync(path.join(RESULTS_DIR, base + '.draft.md'), toMarkdown(out) + '\n');
  }
  await ctx.close();
  console.log(`\nГотово: streaming/results/${base}.json и ${base}.draft.md — ЧЕРНОВИК, кандидатов нужно проверить.`);
}

main().catch(e => { console.error(e); process.exit(1); });
