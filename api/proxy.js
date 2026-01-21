const TARGET_BASE = "https://lms.kgma.kg/vm/api";

export default async function handler(req, res) {
  try {
    // получаем путь из URL
    const path = req.url.replace(/^\/api\/proxy/, "");

    const targetUrl = TARGET_BASE + path;

    const response = await fetch(targetUrl, {
      method: "GET",
      headers: {
        "User-Agent": "Vercel-Proxy"
      }
    });

    const text = await response.text();

    // обязательно CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");

    res.status(response.status).send(text);

  } catch (e) {
    res.status(500).json({ error: e.message || "Proxy failed" });
  }
}
