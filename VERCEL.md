# ksma-bad-marks → Vercel: инструкция по развёртыванию

Проект статичен (HTML/CSS/JS) + одна serverless-функция-прокси.
Живой API LMS: `https://avn.kgma.kg/vm/api` (JSON + CORS `*`).

## Структура

```
index.html, script.js, styles.css, favicon.ico, tsparticles...  — статика (главная «хвосты»)
starosta/                                                       — подпроект «староста» (статика)
api/proxy/run.js         — Vercel-функция: агрегация хвостов (?login=X-YYYYY&id_ws=2)
api/proxy/[...path].js   — универсальный пасsthrough /api/proxy/<путь> (запасной)
vercel.json              — CORS-заголовки + rewrite /api/proxy/run → run.js
worker.js, wrangler.jsonc— зеркало прокси на Cloudflare Workers (опциональный второй фолбэк)
```

## Вариант деплоя 1 — связать с GitHub (рекомендуется)

1. [vercel.com/new](https://vercel.com/new) → Import Git Repository → `Kristy98755/ksma-bad-marks`.
2. Framework Preset: **Other** (сборка не нужна), Build Command: пусто, Output: пусто.
3. Deploy. Дальше каждый `git push` в `main` сам деплоит прод-версию — руками ничего делать не надо.

## Вариант деплоя 2 — Vercel CLI

```bash
npm i -g vercel
cd ksma-bad-marks
vercel login          # один раз
vercel --prod         # деплой в production
```

## Что может понадобиться исправить руками в веб-интерфейсе Vercel

1. **Привязать GitHub-репозиторий** (если проект создавался не через Import): Settings → Git → Connect и выбрать `Kristy98755/ksma-bad-marks`, ветка `main`.
2. **Проверить, что функция деплоится**: разделе Functions должно быть видно `api/proxy/run.js`. Если его нет — на вкладке Root Directory стоит не `.` (исправить на `.`) или проект сконфигурирован как чистая статика без `api/`.
3. **Node.js-версия**: Settings → Environment → Node.js Version ≥ 18 (в коде используется современный `fetch`… функция использует `node-fetch@2` из package.json, но ≥18 лучше).
4. **Проверить rewrite**: vercel.json уже содержит rewrite `/api/proxy/run` → `/api/proxy/run.js`; если менял настройки в UI (Routing Rules), убедиться, что rewrite не перекрыт.
5. **Если раньше задеплоена старая версия прокси** (с `lms.kgma.kg`) и автодеплоя не было — нажать **Redeploy** на последнем деплое или сделать `vercel --prod`.
6. **Custom domain** (если был): Settings → Domains — перевести/перепроверить после переезда.
7. **Логи функции**: при ошибках смотреть tab «Logs» у `api/proxy/run` — там будет понятная причина (таймаут上游 LMS, HTTP 500 и т.п.).

## Проверка после деплоя

```
https://<домен>/api/proxy/run?login=1-60000&id_ws=2
```
Должен вернуться JSON вида `{"data":[{subject,type,teacher,lesson_number,date,topic,mark},…],"id_group":…}`.

## Запасные варианты (уже зашиты в script.js)

1. Прямой запрос браузера → `avn.kgma.kg` (обычно работает, CORS открыт).
2. Fallback: Vercel-прокси `ksma-bad-marks.vercel.app/api/proxy/run`.
3. Fallback 2: Cloudflare Worker `ksma-bad-marks-proxy.itismynickname9.workers.dev/api/proxy/run` (деплой: `npx wrangler deploy`).
