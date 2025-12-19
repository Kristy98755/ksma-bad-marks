const BASE = "https://lms.kgma.kg/vm/api";
// const BAD_MARKS = ["1", "2", "д", "нб"];
const ID_YEAR = 25;
let cleanDisc;
const resultBody = document.getElementById("result");
// Предположим, твоя кнопка запускает функцию loadData()
const loginInput = document.getElementById("login");
const loadButton = document.getElementById("load");
let inProgress = false;

loginInput.addEventListener("keydown", function(e) {
  if (e.key === "Enter") {
    e.preventDefault();  // чтобы не было нежелательного submit
    loadButton.click();  // вызывает клик по кнопке
  }
});

function isBadLesson(lesson, vidType) {
  const mark = String(lesson.otsenka_ball);
  const status = String(lesson.otsenka || "").toLowerCase();
  const attempt = lesson.attempt;

  // Если попытка 2 или 3 — считаем, что неудовлетворительная уже отработана, игнорируем
  if (attempt === 2 || attempt === 3) return false;
  if (vidType === "Лекционный") {
    // Для лекций учитываем только "д" и "нб"
    return status === "д" || status === "нб";
  } else {
    // Для практики учитываем 1, 2, д, нб
    return mark === "1" || mark === "2" || status === "д" || status === "нб";
  }
}



async function fetchJSON(url) {
  const res = await fetch(url);
  const json = await res.json();
  return json.data || [];
}

document.getElementById("load").onclick = async() => {
	if (inProgress) {
		console.log("id10t");
	}else{
		inProgress = true;
		loadButton.classList.add("loading");
		await mainscript();
		inProgress = false;
		loadButton.classList.remove("loading");

	};
};
async function mainscript() {
    const loader = document.getElementById("loader");
    loader.style.display = "block";       // показываем анимацию
	
    resultBody.innerHTML = "";
    let tailsCount = 0;

	const summary = document.getElementById("summary");
	summary.style.display = "none";
	summary.textContent = "";

  const login = document.getElementById("login").value.trim();
  const id_ws = document.getElementById("ws").value;

  if (!login.includes("-")) {
    alert("Логин должен быть в формате X-YYYYY");
	loader.style.display = "none";
    return;
  }

  const id_student = login.split("-")[1];

  try {
    // 1. Получаем группу
    const user = await fetchJSON(
      `${BASE}/user?id_user=${id_student}&id_avn=-1&id_role=2`
    );
    const id_group = user.id_group;

    // 2. Получаем семестр
    const semesterData = await fetchJSON(
      `${BASE}/student/semester/?id_year=${ID_YEAR}&id_ws=${id_ws}&id_group=${id_group}&id_student=${id_student}`
    );
    const id_semester = semesterData[0].id_semester;

    // 3. Получаем дисциплины
    const disciplines = await fetchJSON(
      `${BASE}/student/discipline/?id_year=${ID_YEAR}&id_ws=${id_ws}&id_group=${id_group}&id_student=${id_student}&id_semester=${id_semester}`
    );


    for (const disc of disciplines) {
      // 4. Типы занятий
      const vids = await fetchJSON(
        `${BASE}/student/vid-zanyatie?id_year=${ID_YEAR}&id_ws=${id_ws}&id_group=${id_group}&id_student=${id_student}&id_semester=${id_semester}&id_discipline=${disc.id_discipline}`);

      for (const vid of vids) {
        // 5. Преподаватели
		cleanDisc = disc.discipline
                .replace(/\[.*?\]\s*/g, "")  // убираем [что угодно]
                .replace(/\(крд.*$/g, "") // убираем (крд.*
                .trim();                     // удаляем лишние пробелы по краям
		logTerminal(`${cleanDisc} (${vid.vid_zaniatiy})`);

        const teachers = await fetchJSON(
          `${BASE}/student/teacher/?id_year=${ID_YEAR}&id_ws=${id_ws}&id_group=${id_group}&id_student=${id_student}&id_discipline=${disc.id_discipline}&id_semester=${id_semester}&id_vid_zaniatiy=${vid.id_vid_zaniatiy}`);


        for (const teacher of teachers) {
          // 6. Журнал
          const journal = await fetchJSON(
            `${BASE}/student/journal?id_year=${ID_YEAR}&id_ws=${id_ws}&id_group=${id_group}&id_student=${id_student}&id_discipline=${disc.id_discipline}&id_vid_zaniatiy=${vid.id_vid_zaniatiy}&id_semester=${id_semester}&id_teacher=${teacher.id_teacher}`
          );
		  const lessonCounter = {}; // { "273370-1": 0, "273370-2": 0 }

          for (const lesson of journal) {
		    const key = `${disc.id_discipline}-${vid.id_vid_zaniatiy}`;
			if (!lessonCounter[key]) lessonCounter[key] = 1;
			else lessonCounter[key]++;

			const lessonNumber = lessonCounter[key]; // <- вот правильный номер

            if (isBadLesson(lesson, vid.vid_zaniatiy)) {
				tailsCount++;
			  	const card = document.createElement("div");
				card.className = "card";
				const displayMark =
				  lesson.otsenka && lesson.otsenka !== ""
					? lesson.otsenka
					: lesson.otsenka_ball;

				const markClass =
				  displayMark === "1" || displayMark === "2"
					? "bad"
					: "warn";

				let tipZan = ""; // объявляем снаружи
				if (vid.vid_zaniatiy === "Практический") {
					tipZan = "(практ.)";
				} else if (vid.vid_zaniatiy === "Лекционный") {
					tipZan = "(лекц.)";
				}

				card.innerHTML = `
				  <div><b>Предмет:</b> ${disc.discipline} ${tipZan}</div>
				  <div><b>Дата:</b> ${lesson.visitDate}</div>
				  <div><b>Тема:</b> №${lessonNumber} – ${lesson.lesson_topic?.trim() || ""}</div>
				  <div>
					<b>Отметка: <span class="mark ${markClass}">${displayMark}</span></b>
				  </div>
				`;




				resultBody.appendChild(card);

            }
          }
        }
      }
    }
	function tailsWord(n) {
	  if (n % 10 === 1 && n % 100 !== 11) return "хвост";
	  if ([2,3,4].includes(n % 10) && ![12,13,14].includes(n % 100)) return "хвоста";
	  return "хвостов";
	}
	window.tailsWord = tailsWord;
	summary.textContent = tailsCount === 0
    ? "Поздравляем, у вас нет хвостов!"
    : `У вас ${tailsCount} ${tailsWord(tailsCount)}!`;

// Задаём цвет/градиент
	summary.style.background = tailsCount === 0
		? "linear-gradient(135deg, #009933, #00ff6a)"
		// зелёный градиент
		: "linear-gradient(135deg, #2a1b1b, #1a0f0f)";
		// прежний градиент
		summary.style.display = "block";
		resultBody.style.display = "block";
	summary.style.color = tailsCount === 0 ? "#fff" : "#ff6b6b";
	if (tailsCount === 0){
		launchConfetti();
	};
  } catch (e) {
    console.error(e);
    alert("Ошибка при загрузке данных. См. консоль.");
  } finally {
    loader.style.display = "none";      // прячем анимацию после окончания
  }
};




// Получение куки по имени
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
}

// Установка куки
function setCookie(name, value, days) {
    const d = new Date();
    d.setTime(d.getTime() + (days*24*60*60*1000));
    document.cookie = `${name}=${value};expires=${d.toUTCString()};path=/`;
}

// При загрузке страницы автозаполняем логин
window.addEventListener('DOMContentLoaded', () => {
    const savedLogin = getCookie('avn_login');
    if (savedLogin) {
        loginInput.value = savedLogin;
    }
});

// При клике на кнопку сохраняем логин
loadButton.addEventListener('click', () => {
    const login = loginInput.value.trim();
    if (login) {
        setCookie('avn_login', login, 30); // сохраняем на 30 дней
    }
});

const loader = document.getElementById("loader");
const terminal = document.getElementById("terminal");

function showLoader() {
  terminal.innerHTML = "";
  loader.classList.remove("hidden");
}

function hideLoader() {
  loader.classList.add("hidden");
}

function logTerminal(text) {
  const line = document.createElement("div");
  line.className = "line";
  line.textContent = text;
  terminal.appendChild(line);

  // автоскролл вниз
  terminal.scrollTop = terminal.scrollHeight;
}


function launchConfetti(){
	const end = Date.now() + 2 * 1000;

// go Buckeyes!
let colors;

(function frame() {
  confetti({
    particleCount: 2,
    angle: 60,
    spread: 55,
    origin: { x: 0 },
    colors: colors,
  });

  confetti({
    particleCount: 2,
    angle: 120,
    spread: 55,
    origin: { x: 1 },
    colors: colors,
  });

  if (Date.now() < end) {
    requestAnimationFrame(frame);
  }
})();
};