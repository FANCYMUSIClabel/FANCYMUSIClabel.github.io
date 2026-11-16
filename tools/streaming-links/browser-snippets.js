// Сниппеты для консоли браузера или для javascript_tool в Claude in Chrome.
// Каждый вставляется на открытой странице нужной площадки.

// 1. Собрать ссылки на артистов со страницы поиска (Yandex, VK, Zvuk, Apple, Spotify).
//    Ждёт 3,5 с, пока догрузится страница.
await new Promise(r => setTimeout(r, 3500));
[...new Set([...document.querySelectorAll('a[href*="/artist/"]')]
  .map(a => a.href + ' | ' + a.textContent.trim().slice(0, 60)))].join('\n');

// 2. То же для YouTube Music.
await new Promise(r => setTimeout(r, 3500));
[...new Set([...document.querySelectorAll('a[href*="channel/"], a[href*="/@"]')]
  .map(a => a.href + ' | ' + a.textContent.trim().slice(0, 60)))].join('\n');

// 3. Apple: сравнить несколько профилей по числу релизов (запускать на любой странице music.apple.com).
const ids = ['1539904527', '1619052552', '1763235964']; // id профилей
const out = [];
for (const id of ids) {
  const d = new DOMParser().parseFromString(await fetch('/ru/artist/x/' + id).then(r => r.text()), 'text/html');
  const albums = [...new Set([...d.querySelectorAll('a[href*="/album/"]')].map(a => a.textContent.trim()).filter(Boolean))];
  out.push(`${id} (${d.title}): ${albums.length} → ${albums.slice(0, 6).join(' ; ')}`);
}
out.join('\n');

// 4. Spotify: слушатели за месяц и релизы (на странице профиля артиста).
await new Promise(r => setTimeout(r, 3500));
const l = document.body.innerText.match(/[\d\s,.]+(?:monthly listeners|слушател[^\n]*)/i);
const al = [...new Set([...document.querySelectorAll('a[href*="/album/"]')].map(x => x.textContent.trim()).filter(Boolean))];
(l ? l[0] : 'нет данных') + ' | релизов: ' + al.length + ' → ' + al.slice(0, 6).join(' ; ');

// 5. YouTube Music, Zvuk, VK: шапка профиля (подписчики, топ-треки) — на странице профиля.
await new Promise(r => setTimeout(r, 3500));
document.body.innerText.slice(0, 700).replace(/\n+/g, ' | ');
