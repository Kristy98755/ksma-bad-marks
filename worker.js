// Cloudflare Worker: прокси-агрегатор LMS КГМА для ksma-bad-marks.
// Аналог api/proxy/run.js (Vercel), но на CF Workers: GET /api/proxy/run?login=X-YYYYY&id_ws=2
const BASE = "https://avn.kgma.kg/vm/api";
const ID_YEAR = 26;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS },
  });
}

function normalizeBadKind(raw) {
  const s = String(raw == null ? "" : raw).toLowerCase().replace(/\s+/g, " ").trim();
  if (s === "1") return "1";
  if (s === "2") return "2";
  if (/^н\/?б\s*3/.test(s)) return "нб3";
  if (/^н\/?б/.test(s)) return "нб";
  if (s === "д" || /^допущен/.test(s)) return "д";
  return null;
}

function isBadLesson(lesson, vidType) {
  const attempt = lesson.attempt;
  if (attempt === 2 || attempt === 3) return false;
  const kind = normalizeBadKind(lesson.otsenka || lesson.otsenka_ball);
  if (!kind) return false;
  if (vidType === "Лекционный") return kind === "д" || kind === "нб" || kind === "нб3";
  return true;
}

async function fetchJSON(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  const text = await resp.text();
  if (text.trimStart().startsWith("<")) throw new Error(`HTML instead of JSON from ${url}`);
  return JSON.parse(text).data || [];
}

async function handleRun(url) {
  const login = url.searchParams.get("login");
  const id_ws = url.searchParams.get("id_ws") || "2";
  if (!login || !login.includes("-")) return json({ error: "Формат: X-YYYYY" }, 400);

  const id_student = login.split("-")[1];
  const user = await fetchJSON(`${BASE}/user?id_user=${id_student}&id_avn=-1&id_role=2`);
  const id_group = user.id_group;

  const semesterData = await fetchJSON(`${BASE}/student/semester/?id_year=${ID_YEAR}&id_ws=${id_ws}&id_group=${id_group}&id_student=${id_student}`);
  const id_semester = semesterData[0]?.id_semester;
  if (!id_semester) return json({ error: "Пустой семестр для года " + ID_YEAR }, 404);

  const disciplines = await fetchJSON(`${BASE}/student/discipline/?id_year=${ID_YEAR}&id_ws=${id_ws}&id_group=${id_group}&id_student=${id_student}&id_semester=${id_semester}`);

  const resultsArray = await Promise.all(disciplines.map(async (disc) => {
    const disciplineResults = [];
    const vids = await fetchJSON(`${BASE}/student/vid-zanyatie?id_year=${ID_YEAR}&id_ws=${id_ws}&id_group=${id_group}&id_student=${id_student}&id_semester=${id_semester}&id_discipline=${disc.id_discipline}`);
    await Promise.all(vids.map(async (vid) => {
      const teachers = await fetchJSON(`${BASE}/student/teacher/?id_year=${ID_YEAR}&id_ws=${id_ws}&id_group=${id_group}&id_student=${id_student}&id_discipline=${disc.id_discipline}&id_semester=${id_semester}&id_vid_zaniatiy=${vid.id_vid_zaniatiy}`);
      await Promise.all(teachers.map(async (teacher) => {
        const journal = await fetchJSON(`${BASE}/student/journal?id_year=${ID_YEAR}&id_ws=${id_ws}&id_group=${id_group}&id_student=${id_student}&id_discipline=${disc.id_discipline}&id_vid_zaniatiy=${vid.id_vid_zaniatiy}&id_semester=${id_semester}&id_teacher=${teacher.id_teacher}`);
        let lessonCounter = 0;
        for (const lesson of journal) {
          lessonCounter++;
          if (isBadLesson(lesson, vid.vid_zaniatiy)) {
            disciplineResults.push({
              subject: disc.discipline.replace(/\[.*?\]\s*/g, "").replace(/\(крд.*$/g, "").trim(),
              type: vid.vid_zaniatiy,
              teacher: teacher.full_name || teacher.t_fio || "",
              lesson_number: lessonCounter,
              date: lesson.visitDate,
              topic: lesson.lesson_topic?.trim() || "",
              mark: lesson.otsenka || lesson.otsenka_ball,
            });
          }
        }
      }));
    }));
    return disciplineResults;
  }));

  return json({ data: resultsArray.flat(), id_group });
}

// Пасsthrough: /api/proxy/<путь>?query -> https://avn.kgma.kg/vm/api/<путь>?query
async function handlePassthrough(url) {
  const rest = url.pathname.replace(/^\/api\/proxy\//, "");
  if (!rest) return json({ error: "empty path" }, 400);
  const target = new URL(`${BASE}/${rest}`);
  target.search = url.search;
  const resp = await fetch(target.toString(), { headers: { Accept: "application/json" } });
  const body = await resp.text();
  return new Response(body, {
    status: resp.status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS });
      }
      if (url.pathname === "/api/proxy/run") return await handleRun(url);
      if (url.pathname.startsWith("/api/proxy/")) return await handlePassthrough(url);
      if (url.pathname === "/") return json({ ok: true, service: "ksma-bad-marks-proxy" });
      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  },
};
