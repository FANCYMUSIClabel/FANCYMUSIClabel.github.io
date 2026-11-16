# streaming-links — профили артистов на стримингах

Ищет профили артиста на шести площадках и проверяет, наш ли это артист: открывает
его релизы в Apple Music и Spotify и ищет в строке ℗ лейбл Fancymusic.

Правила ответа, подводные камни и порядок работы — в навыке
`.claude/skills/streaming-links/SKILL.md`.

## Установка (один раз)
```bash
cd tools/streaming-links
npm install
npx playwright install chromium
node find-links.mjs --login     # откроется окно: войдите во VK сами, затем закройте окно
```
Вход сохраняется в `tools/streaming-links/.browser-profile/`. Папка в `.gitignore`:
в ней ваши сессии, в репозиторий она не попадает.

## Запуск
```bash
node find-links.mjs ../../streaming/artists/2026-11-16.txt           # список
node find-links.mjs "Владимир Мартынов | Vladimir Martynov"           # одно имя
node find-links.mjs ../../streaming/artists/list.txt --headed         # с окном
node find-links.mjs ../../streaming/artists/list.txt --no-verify      # без проверки лейбла, быстрее
node find-links.mjs ../../streaming/artists/list.txt --label "Melodiya"  # чужой лейбл
```

Список: одна строка на артиста, варианты имени через ` | `, строки с `#` пропускаются.

## Что получается
- `streaming/results/<имя>.json` — для каждой площадки `candidates` с полями
  `combined` (сборный профиль «A; B; C») и `verify` (`ours` — лейбл найден,
  `labels` — все строки ℗ с числом релизов, `listeners` — слушатели Spotify за месяц,
  `releases`), плюс `unmatched` и `notes`.
- `streaming/results/<имя>.draft.md` — черновик ответа: свои профили первыми,
  внизу блок проверки. Итоговый ответ после разбора — `streaming/results/<имя>.md`.

### Пометки в `notes`
| Пометка | Что значит |
|---|---|
| `region-blocked` | Площадка недоступна из этой страны: Яндекс из-за рубежа |
| `captcha` | Площадка приняла браузер за бота: Звук из облака |
| `login-required` | VK без входа: `node find-links.mjs --login` |
| `browser-unsupported` | YouTube Music не принял браузер: обновите user agent в `UA` |

## Где запускать
Яндекс, VK и Звук работают только с российского IP и в обычном браузере. Из облачной
сессии Claude доступны Apple, Spotify и YouTube Music. Полный прогон — на компьютере
в России или на домашнем сервере.

## Ограничения
- Лейбл проверяется только в Apple (до 40 релизов) и Spotify (до 8 релизов: без входа
  видна часть дискографии). Строки ℗ у Яндекса, VK и Звука без входа не видны.
- «Лейбл не найден» не значит «чужой»: у артиста бывают релизы на «Мелодии» и других
  лейблах. Такие профили сверяют по именам релизов и соавторам.
- Сопоставление имён: общий токен из 4+ букв, для имени с фамилией нужны оба.
  Общие слова («оркестр», «камерный», «ensemble») не учитываются.
