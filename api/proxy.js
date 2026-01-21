export default async function handler(req, res) {
	try {
		const target = req.query.url;

		if (!target) {
			res.status(400).json({ error: "Missing url parameter" });
			return;
		}

		const response = await fetch(target, {
			method: "GET",
			headers: {
				"User-Agent": "Vercel-Proxy",
			},
		});

		const text = await response.text();

		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader("Content-Type", "application/json");

		res.status(response.status).send(text);

	} catch (e) {
		res.status(500).json({ error: e.message || "Proxy error" });
	}
}
