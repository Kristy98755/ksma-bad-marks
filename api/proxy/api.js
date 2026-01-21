// api/proxy/run.js
import fetch from "node-fetch";
import https from "https";

const BASE = "https://lms.kgma.kg/vm";
const ID_YEAR = 25;
const agent = new https.Agent({ rejectUnauthorized: false });

function isBadLesson(lesson, vidType) {
  const mark = String(lesson.otsenka_ball);
  const status = String(lesson.otsenka || "").toLowerCase();
  const attempt = lesson.attempt;

  if (attempt === 2 || attempt === 3) return false;
  if (vidType === "Лекционный") return status === "д" || status === "нб";
  return mark === "1" || mark === "2" || status === "д" || status === "нб";
}

async function fetchJSON(url) {
  const resp = await fetch(url, { agent });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  return json.data || [];
}

export default async function handler(req, res) {
  try {
    const { login, id_ws } = req.query;
    if (!login || !login.includes("-")) {
      res.status(400).json({ error: "Login должен быть в формате X-YYYYY" });
      return;
    }

    const id_student = login.split("-")[1];

    // 1. Получаем группу
    const user = await fetchJSON(`${BASE}/user?id_user=${id_student}&id_avn=-1&id_role=2`);
    const id_group = user.id_group;

    // 2. Получаем семестр
    const semesterData = await fetchJSON(`${BASE}/student/semester/?id_year=${ID_YEAR}&id_ws=${id_ws}&id_group=${id_group}&id_student=${id_student}`);
    const id_semester = semesterData[0].id_semester;

    // 3. Дисциплины
    const disciplines = await fetchJSON(`${BASE}/student/discipline/?id_year=${ID_YEAR}&id_ws=${id_ws}&id_group=${id_group}&id_student=${id_student}&id_semester=${id_semester}`);

    const result = [];

    for (const disc of disciplines) {
      // 4. Типы занятий
      const vids = await fetchJSON(`${BASE}/student/vid-zanyatie?id_year=${ID_YEAR}&id_ws=${id_ws}&id_group=${id_group}&id_student=${id_student}&id_semester=${id_semester}&id_discipline=${disc.id_discipline}`);

      for (const vid of vids) {
        // 5. Преподаватели
        const teachers = await fetchJSON(`${BASE}/student/teacher/?id_year=${ID_YEAR}&id_ws=${id_ws}&id_group=${id_group}&id_student=${id_student}&id_discipline=${disc.id_discipline}&id_semester=${id_semester}&id_vid_zaniatiy=${vid.id_vid_zaniatiy}`);

        for (const teacher of teachers) {
          // 6. Журнал
          const journal = await fetchJSON(`${BASE}/student/journal?id_year=${ID_YEAR}&id_ws=${id_ws}&id_group=${id_group}&id_student=${id_student}&id_discipline=${disc.id_discipline}&id_vid_zaniatiy=${vid.id_vid_zaniatiy}&id_semester=${id_semester}&id_teacher=${teacher.id_teacher}`);

          let lessonCounter = {};
          for (const lesson of journal) {
            const key = `${disc.id_discipline}-${vid.id_vid_zaniatiy}`;
            lessonCounter[key] = (lessonCounter[key] || 0) + 1;

            if (isBadLesson(lesson, vid.vid_zaniatiy)) {
              result.push({
                subject: disc.discipline.replace(/\[.*?\]\s*/g, "").replace(/\(крд.*$/g, "").trim(),
                type: vid.vid_zaniatiy,
                teacher: teacher.full_name || "",
                lesson_number: lessonCounter[key],
                date: lesson.visitDate,
                topic: lesson.lesson_topic?.trim() || "",
                mark: lesson.otsenka || lesson.otsenka_ball
              });
            }
          }
        }
      }
    }

    res.setHeader("Content-Type", "application/json");
    res.status(200).json({ data: result });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || String(e) });
  }
}
