import fetch from 'node-fetch';
import https from 'https';

export default async function handler(req, res) {
  try {
    // Получаем путь после /api/proxy/
    const urlParts = req.url.split("/").slice(3); // ["user"] при /api/proxy/user
    const path = urlParts.join("/");

    // Формируем полный URL на LMS
    const baseUrl = new URL("https://lms.kgma.kg/vm/api/");
    const targetUrl = new URL(path, baseUrl);

    // Если есть query параметры — добавляем их
    if (req.url.includes("?")) {
      const query = req.url.split("?")[1];
      targetUrl.search = query;
    }

    // Игнорируем ошибки SSL
    const agent = new https.Agent({ rejectUnauthorized: false });

    // Делаем запрос к LMS
    const resp = await fetch(targetUrl.toString(), { agent });
    const data = await resp.text();

    // Заголовки CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Content-Type", "application/json; charset=utf-8");

    // OPTIONS preflight
    if (req.method === "OPTIONS") {
      return res.status(200).end();
    }

    // Отправляем ответ обратно
    res.status(resp.status).send(data);

  } catch (e) {
    console.error("Fetch failed:", e);
    res.status(500).json({ error: String(e) });
  }
}
