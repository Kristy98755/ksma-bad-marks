import fetch from "node-fetch";
import https from "https";

const BASE = "https://lms.kgma.kg/vm/api/";
const ID_YEAR = 25;

// Простая функция проверки плохой оценки
function isBadLesson(lesson, vidType) {
  const mark = String(lesson.otsenka_ball);
  const status = String(lesson.otsenka || "").toLowerCase();
  const attempt = lesson.attempt;
  if (attempt === 2 || attempt === 3) return false;
  if (vidType === "Лекционный") return status === "д" || status === "нб";
  return mark === "1" || mark === "2" || status === "д" || status === "нб";
}

export default async function handler(req, res) {
  try {
    const { login, id_ws } = req.query;

    if (!login || !id_ws) {
      return res.status(400).json({ error: "login and id_ws required" });
    }

    const id_student = login.split("-")[1];

    const agent = new https.Agent({ rejectUnauthorized: false });

    // 1. Получаем группу
    const userResp = await fetch(`${BASE}/user?id_user=${id_student}&id_avn=-1&id_role=2`, { agent });
    const user = await userResp.json();
    const id_group = user.data.id_group;

    // 2. Семестр
    const semResp = await fetch(`${BASE}/student/semester/?id_year=${ID_YEAR}&id_ws=${id_ws}&id_group=${id_group}&id_student=${id_student}`, { agent });
    const semData = await semResp.json();
    const id_semester = semData.data[0].id_semester;

    // 3. Дисциплины
    const discResp = await fetch(`${BASE}/student/discipline/?id_year=${ID_YEAR}&id_ws=${id_ws}&id_group=${id_group}&id_student=${id_student}&id_semester=${id_semester}`, { agent });
    const disciplines = await discResp.json();
    
    const results = [];

    for (const disc of disciplines.data) {
      // 4. Типы занятий
      const vidsResp = await fetch(`${BASE}/student/vid-zanyatie?id_year=${ID_YEAR}&id_ws=${id_ws}&id_group=${id_group}&id_student=${id_student}&id_semester=${id_semester}&id_discipline=${disc.id_discipline}`, { agent });
      const vids = await vidsResp.json();

      for (const vid of vids.data) {
        // 5. Преподаватели
        const teachersResp = await fetch(`${BASE}/student/teacher/?id_year=${ID_YEAR}&id_ws=${id_ws}&id_group=${id_group}&id_student=${id_student}&id_discipline=${disc.id_discipline}&id_semester=${id_semester}&id_vid_zaniatiy=${vid.id_vid_zaniatiy}`, { agent });
        const teachers = await teachersResp.json();

        for (const teacher of teachers.data) {
          // 6. Журнал
          const journalResp = await fetch(`${BASE}/student/journal?id_year=${ID_YEAR}&id_ws=${id_ws}&id_group=${id_group}&id_student=${id_student}&id_discipline=${disc.id_discipline}&id_vid_zaniatiy=${vid.id_vid_zaniatiy}&id_semester=${id_semester}&id_teacher=${teacher.id_teacher}`, { agent });
          const journal = await journalResp.json();

          for (const lesson of journal.data) {
            if (isBadLesson(lesson, vid.vid_zaniatiy)) {
              results.push({
                discipline: disc.discipline.replace(/\[.*?\]\s*/g, "").replace(/\(крд.*$/g, "").trim(),
                vidType: vid.vid_zaniatiy,
                date: lesson.visitDate,
                lessonNumber: lesson.lesson_number || 0,
                topic: lesson.lesson_topic?.trim() || "",
                mark: lesson.otsenka || lesson.otsenka_ball
              });
            }
          }
        }
      }
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(200).json({ data: results });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
}
