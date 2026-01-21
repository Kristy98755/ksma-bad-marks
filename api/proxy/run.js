import fetch from "node-fetch";
import https from "https";

// Настройки SSL
const agent = new https.Agent({ rejectUnauthorized: false });

// Настройки
const BASE = "https://lms.kgma.kg/vm/api/";
const ID_YEAR = 25;

// Проверка плохой оценки
function isBadLesson(lesson, vidType) {
  const mark = String(lesson.otsenka_ball);
  const status = String(lesson.otsenka || "").toLowerCase();
  const attempt = lesson.attempt;

  if (attempt === 2 || attempt === 3) return false;

  if (vidType === "Лекционный") return status === "д" || status === "нб";
  return mark === "1" || mark === "2" || status === "д" || status === "нб";
}

async function fetchJSON(url) {
  const res = await fetch(url, { agent });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.data || [];
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { login, id_ws } = req.body;
    if (!login || !id_ws) {
      return res.status(400).json({ error: "Missing login or id_ws" });
    }

    const id_student = login.split("-")[1];
    if (!id_student) {
      return res.status(400).json({ error: "Invalid login format" });
    }

    // 1. Группа
    const user = await fetchJSON(`${BASE}/user?id_user=${id_student}&id_avn=-1&id_role=2`);
    const id_group = user.id_group;

    // 2. Семестр
    const semesterData = await fetchJSON(`${BASE}/student/semester/?id_year=${ID_YEAR}&id_ws=${id_ws}&id_group=${id_group}&id_student=${id_student}`);
    const id_semester = semesterData[0].id_semester;

    // 3. Дисциплины
    const disciplines = await fetchJSON(`${BASE}/student/discipline/?id_year=${ID_YEAR}&id_ws=${id_ws}&id_group=${id_group}&id_student=${id_student}&id_semester=${id_semester}`);

    const result = [];

    for (const disc of disciplines) {
      // 4. Типы занятий
      const vids = await fetchJSON(`${BASE}/student/vid-zanyatie?id_year=${ID_YEAR}&id_ws=${id_ws}&id_group=${id_group}&id_student=${id_student}&id_semester=${id_semester}&id_discipline=${disc.id_discipline}`);

      for (const vid of vids) {
        const cleanDisc = disc.discipline
          .replace(/\[.*?\]\s*/g, "")
          .replace(/\(крд.*$/g, "")
          .trim();

        // 5. Преподаватели
        const teachers = await fetchJSON(`${BASE}/student/teacher/?id_year=${ID_YEAR}&id_ws=${id_ws}&id_group=${id_group}&id_student=${id_student}&id_discipline=${disc.id_discipline}&id_semester=${id_semester}&id_vid_zaniatiy=${vid.id_vid_zaniatiy}`);

        for (const teacher of teachers) {
          // 6. Журнал
          const journal = await fetchJSON(`${BASE}/student/journal?id_year=${ID_YEAR}&id_ws=${id_ws}&id_group=${id_group}&id_student=${id_student}&id_discipline=${disc.id_discipline}&id_vid_zaniatiy=${vid.id_vid_zaniatiy}&id_semester=${id_semester}&id_teacher=${teacher.id_teacher}`);

          const lessonCounter = {};

          for (const lesson of journal) {
            const key = `${disc.id_discipline}-${vid.id_vid_zaniatiy}`;
            if (!lessonCounter[key]) lessonCounter[key] = 1;
            else lessonCounter[key]++;

            const lessonNumber = lessonCounter[key];

            if (isBadLesson(lesson, vid.vid_zaniatiy)) {
              result.push({
                discipline: cleanDisc,
                vidType: vid.vid_zaniatiy,
                date: lesson.visitDate,
                lessonNumber,
                topic: lesson.lesson_topic?.trim() || "",
                mark: lesson.otsenka || lesson.otsenka_ball
              });
            }
          }
        }
      }
    }

    return res.status(200).json({ data: result });
  } catch (e) {
    console.error("Fetch failed:", e);
    return res.status(500).json({ error: String(e) });
  }
}
