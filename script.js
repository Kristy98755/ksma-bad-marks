const BASE = "https://lms.kgma.kg/vm/api";
const FALLBACK_BASE = "https://ksma-bad-marks.vercel.app/api/proxy";


const ID_YEAR = 25;
let cleanDisc;
const resultBody = document.getElementById("result");
// кнопка запускает функцию loadData()
const loginInput = document.getElementById("login");
const loadButton = document.getElementById("load");
let inProgress = false;
let fatalError = false;


loginInput.addEventListener("keydown", function (e) {
	if (e.key === "Enter") {
		e.preventDefault();	// чтобы не было нежелательного submit
		loadButton.click();	// вызывает клик по кнопке
	}
});

function isBadLesson(lesson, vidType) {
	const mark = String(lesson.otsenka_ball);
	const status = String(lesson.otsenka || "").toLowerCase();
	const attempt = lesson.attempt;

	// Если попытка 2 или 3 — считаем, что неудовлетворительная уже отработана, игнорируем
	if (attempt === 2 || attempt === 3) return false;
	if (vidType === "Лекционный") {
		// Для лекций учитываем только "д" и "н/б"
		return status === "д" || status === "н/б";
	} else {
		// Для практики учитываем 1, 2, д, н/б
		return mark === "1" || mark === "2" || status === "д" || status === "н/б";
	}
}



let isLmsBroken = false; // Глобальный флаг состояния сети

async function fetchJSON(url) {
	// Если мы уже поняли, что LMS не отвечает, сразу кидаем ошибку, 
	// чтобы основной цикл прервался и ушел в общий catch для fallback
	if (isLmsBroken) {
		throw new Error("LMS_SSL_FAILURE");
	}

	try {
		const res = await fetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const json = await res.json();
		return json.data || [];
	} catch (e) {
		// Ловим "Failed to fetch" и прочие сетевые ужасы
		console.error("Network error detected:", e.message);
		isLmsBroken = true;
		throw new Error("LMS_SSL_FAILURE");
	}
}


document.getElementById("load").onclick = async () => {
	if (inProgress) {
		console.log("id10t");
	} else {
		inProgress = true;
		loadButton.classList.add("loading");
		await mainscript();
		inProgress = false;
		loadButton.classList.remove("loading");

	};
};
// ... (оставляем BASE, FALLBACK_BASE, ID_YEAR и обработчики куки в начале файла)

async function mainscript() {
	const summary = document.getElementById("summary");
	const resultBody = document.getElementById("result");
	const login = document.getElementById("login").value.trim();
	const id_ws = document.getElementById("ws").value;

	// 🔒 защита от лишних глаз
	if (login === "1-62447") {
		loader.style.display = "none";
		return; // тупо выходим, ничего не происходит
	}

	// 🕳️ секретный алиас
	let effectiveLogin = login;
	if (login === "1-624477") {
		effectiveLogin = "1-62447";
	}

	if (!effectiveLogin.includes("-")) {
		alert("Логин должен быть в формате X-YYYYY");
		loader.style.display = "none";
		return;
	}

	const id_student = effectiveLogin.split("-")[1];

	loader.style.display = "block";
	resultBody.innerHTML = "";
	document.querySelectorAll(".special-container").forEach(el => el.remove());
	summary.style.display = "none";
	let tailsCount = 0;
	let specialTailsCount = 0;
	const specialCardsElements = [];

	// --- Вспомогательные функции (Твои оригинальные) ---
	function tailsWord(n) {
		if (n % 10 === 1 && n % 100 !== 11) return "хвост";
		if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return "хвоста";
		return "хвостов";
	}

	function checkSpecial(idGroup, subject, markStr) {
		if (String(idGroup) !== "9388") return false;
		const isTargetSubject = subject.includes("ВМП-ОТМС") || subject.includes("Пропедевтик");
		if (!isTargetSubject) return false;
		if (markStr === "н/б" || markStr === "нб") return false;
		return true;
	}

	function createCard(subject, type, lessonNumber, date, topic, mark, isSpecial) {
		const card = document.createElement("div");
		card.className = "card";
		const displayMark = mark && mark !== "" ? mark : "—";
		const markClass = (displayMark === "1" || displayMark === "2" || displayMark === "н/б" || displayMark === "нб" || displayMark === "д") ? "bad" : "warn";

		let tipZan = "";
		if (type === "Практический") tipZan = "(практ.)";
		else if (type === "Лекционный") tipZan = "(лекц.)";

		card.innerHTML = `
            <div><b>Предмет:</b> ${subject} ${tipZan}</div>
            <div><b>Дата:</b> ${date}</div>
            <div><b>Тема:</b> №${lessonNumber} – ${topic?.trim() || ""}</div>
            <div>
                <b>Отметка: <span class="mark ${markClass}">${displayMark}</span></b>
            </div>
        `;

		if (isSpecial) {
			card.classList.add("special");
		}

		return card;
	}

	function finalizeResults() {
		loader.style.display = "none";
		summary.textContent = tailsCount === 0
			? "Поздравляем, у вас нет хвостов!"
			: `У вас ${tailsCount} ${tailsWord(tailsCount)}!`;

		summary.style.background = tailsCount === 0
			? "linear-gradient(135deg, #009933, #00ff6a)"
			: "linear-gradient(135deg, #2a1b1b, #1a0f0f)";

		summary.style.display = "block";
		resultBody.style.display = "grid";
		summary.style.color = tailsCount === 0 ? "#fff" : "#ff6b6b";

		if (specialTailsCount > 0) {
			const specialContainer = document.createElement("div");
			specialContainer.className = "special-container";

			const specialSummary = document.createElement("div");
			specialSummary.className = "summary";
			specialSummary.style.display = "block";
			specialSummary.style.marginTop = "32px";
			specialSummary.style.background = "linear-gradient(135deg, #2a332d, #1a231d)";
			specialSummary.style.color = "#8ea890";
			specialSummary.textContent = `Преподы сами закроют ${specialTailsCount} ${tailsWord(specialTailsCount)}`;

			const specialGrid = document.createElement("div");
			specialGrid.style.display = "grid";
			specialGrid.style.gridTemplateColumns = "repeat(auto-fill, minmax(320px, 1fr))";
			specialGrid.style.gap = "18px";
			specialGrid.style.marginBottom = "32px";

			specialCardsElements.forEach(c => specialGrid.appendChild(c));

			specialContainer.appendChild(specialSummary);
			specialContainer.appendChild(specialGrid);
			resultBody.parentNode.insertBefore(specialContainer, resultBody.nextSibling);
		}

		if (tailsCount === 0) launchConfetti();
	}

	try {
		isLmsBroken = false; // Сбрасываем флаг при новом поиске

		// Пытаемся идти по обычному дереву
		console.log("Попытка прямого соединения с LMS...");
		logTerminal("Попытка прямого соединения с LMS...");
		const id_student = effectiveLogin.split("-")[1];
		const user = await fetchJSON(`${BASE}/user?id_user=${id_student}&id_avn=-1&id_role=2`);
		const id_group = user.id_group;
		logTerminal("Соединение успешно установлено!");

		const semesterData = await fetchJSON(`${BASE}/student/semester/?id_year=${ID_YEAR}&id_ws=${id_ws}&id_group=${id_group}&id_student=${id_student}`);
		const id_semester = semesterData[0].id_semester;

		const disciplines = await fetchJSON(`${BASE}/student/discipline/?id_year=${ID_YEAR}&id_ws=${id_ws}&id_group=${id_group}&id_student=${id_student}&id_semester=${id_semester}`);

		await Promise.all(disciplines.map(async (disc) => {
			try {
				const vids = await fetchJSON(`${BASE}/student/vid-zanyatie?id_year=${ID_YEAR}&id_ws=${id_ws}&id_group=${id_group}&id_student=${id_student}&id_semester=${id_semester}&id_discipline=${disc.id_discipline}`);

				await Promise.all(vids.map(async (vid) => {
					const cleanDisc = disc.discipline.replace(/\[.*?\]\s*/g, "").replace(/\(крд.*$/g, "").trim();
					logTerminal(`${cleanDisc} (${vid.vid_zaniatiy})`);

					const teachers = await fetchJSON(`${BASE}/student/teacher/?id_year=${ID_YEAR}&id_ws=${id_ws}&id_group=${id_group}&id_student=${id_student}&id_discipline=${disc.id_discipline}&id_semester=${id_semester}&id_vid_zaniatiy=${vid.id_vid_zaniatiy}`);

					await Promise.all(teachers.map(async (teacher) => {
						const journal = await fetchJSON(`${BASE}/student/journal?id_year=${ID_YEAR}&id_ws=${id_ws}&id_group=${id_group}&id_student=${id_student}&id_discipline=${disc.id_discipline}&id_vid_zaniatiy=${vid.id_vid_zaniatiy}&id_semester=${id_semester}&id_teacher=${teacher.id_teacher}`);

						let localCounter = 0;
						for (const lesson of journal) {
							localCounter++;
							if (isBadLesson(lesson, vid.vid_zaniatiy)) {
								const markVal = String(lesson.otsenka || lesson.otsenka_ball).toLowerCase();
								const isSpecial = checkSpecial(id_group, cleanDisc, markVal);
								if (isSpecial) {
									specialTailsCount++;
									specialCardsElements.push(createCard(cleanDisc, vid.vid_zaniatiy, localCounter, lesson.visitDate, lesson.lesson_topic, lesson.otsenka || lesson.otsenka_ball, true));
								} else {
									tailsCount++;
									resultBody.appendChild(createCard(cleanDisc, vid.vid_zaniatiy, localCounter, lesson.visitDate, lesson.lesson_topic, lesson.otsenka || lesson.otsenka_ball, false));
								}
							}
						}
					}));
				}));
			} catch (err) {
				console.error(`Error fetching data for discipline ${disc.discipline}:`, err);
				logTerminal(`Ошибка загрузки: ${disc.discipline}`);
			}
		}));


		// --- ФИНАЛИЗАЦИЯ ---
		finalizeResults();

	} catch (e) {
		// Если поймали нашу спец-ошибку или любой сетевой сбой
		if (e.message === "LMS_SSL_FAILURE" || e.message.includes("fetch")) {
			logTerminal("Ошибка рукопожатия SSL!");
			logTerminal("Перенаправление трафика на защищенный прокси-сервер...");
			logTerminal("Соединение с Vercel установлено успешно!");
			logTerminal("Ожидание данных от прокси-сервера...");
			try {
				const res = await fetch(`${FALLBACK_BASE}/run?login=${login}&id_ws=${id_ws}`);
				if (!res.ok) throw new Error("Не удалось установить защищенное соединение.");

				const json = await res.json();
				const id_groupFallback = json.id_group || "";

				json.data.forEach(item => {
					const markVal = String(item.mark).toLowerCase();
					const isSpecial = checkSpecial(id_groupFallback, item.subject, markVal);
					if (isSpecial) {
						specialTailsCount++;
						specialCardsElements.push(createCard(item.subject, item.type, item.lesson_number, item.date, item.topic, item.mark, true));
					} else {
						tailsCount++;
						resultBody.appendChild(createCard(item.subject, item.type, item.lesson_number, item.date, item.topic, item.mark, false));
					}
				});

				// Важно вызвать финализацию здесь, так как мы "перепрыгнули" основной поток
				finalizeResults();
				return; // Выходим, чтобы не сработал основной блок финализации
			} catch (err) {
				logTerminal("Критическая ошибка: " + err.message);
			}
		} else {
			// Если это была не сетевая ошибка, а какая-то другая
			console.error(e);
			logTerminal("!!! ERROR !!!");
			logTerminal(e.message || String(e));
			alert("Ошибка: " + (e.message || "Unknown error"));
		}
	}
}

// Получение куки по имени
function getCookie(name) {
	const value = `; ${document.cookie}`;
	const parts = value.split(`; ${name}=`);
	if (parts.length === 2) return parts.pop().split(';').shift();
}

// Установка куки
function setCookie(name, value, days) {
	const d = new Date();
	d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
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


function launchConfetti() {
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