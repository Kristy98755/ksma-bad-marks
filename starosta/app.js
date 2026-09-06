// ===========================================================================
//  STAROSTA // GROUP JOURNAL
//  Журнал только своей группы. Источник: студенческий API LMS КГМА
//  (каждый логин опрашивается напрямую, без авторизации — как в SCOLPENDRA).
// ===========================================================================

const BASE = "https://lms.kgma.kg/vm/api";

// ID_YEAR = 26 по хотелке заказчика, НО в LMS учебного года 26 ещё нет данных.
// Для РАБОЧЕГО ТЕСТА используем 25 (в 26 семестр пустой -> краш).
// Поменяй на 26, когда в LMS появятся данные за год 26.
const ID_YEAR = 25;

// Хардкод группы (логины студентов)
const STUDENTS = [
    "1-61766", "1-61691", "1-62447", "1-69639", "1-61690",
    "1-66675", "1-62408", "1-61552", "1-70060", "1-61709"
];

const els = {
    ws: document.getElementById("ws"),
    subject: document.getElementById("subject"),
    module: document.getElementById("module"),
    type: document.getElementById("type"),
    teacher: document.getElementById("teacher"),
    status: document.getElementById("status"),
    led: document.getElementById("led"),
    title: document.getElementById("title"),
    table: document.getElementById("matrix"),
    wrap: document.getElementById("table-wrap"),
    modal: document.getElementById("modal-overlay"),
    modalMark: document.getElementById("modal-mark"),
    modalDetails: document.getElementById("modal-details"),
    tailsBtn: document.getElementById("tails-btn"),
    tailsPanel: document.getElementById("tails-panel"),
    tailsOverlay: document.getElementById("tails-overlay"),
    tailsRefresh: document.getElementById("tails-refresh"),
    tailsClose: document.getElementById("tails-close"),
    tailsList: document.getElementById("tails-list")
};

let state = {
    ws: "2",
    id_group: null,
    id_semester: null,
    id_discipline: null,
    id_vid: null,
    id_teacher: null,
    disciplineGroups: {},
    currentDiscipline: null
};

// --- утилиты ---------------------------------------------------------------
async function fetchJSON(url, opts) {
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status} для ${url}`);
    const json = await res.json();
    return json.data || [];
}

function setStatus(msg, type = "info") {
    els.status.innerHTML = `<span class="${type}">${msg}</span>`;
}

function setLed(stateType) {
    els.led.className = "led led-" + stateType;
}

function parseBaseName(disc) {
    const m = disc.discipline.match(/^\[(.*?)\]\s*(.*)/);
    let tag = m ? `[${m[1]}]` : "";
    let raw = m ? m[2] : disc.discipline;
    return raw.replace(/\(крд.*$/g, "").replace(/каф\..*$/g, "").trim();
}

function parseCredit(disc) {
    const m = (disc || "").match(/крд\.?\s*(-?\d+(?:\.\d+)?)/i);
    return m ? parseFloat(m[1]) : null;
}

function normalizeMark(j) {
    if (j.otsenka !== null && j.otsenka !== undefined && j.otsenka !== "") return String(j.otsenka);
    if (j.otsenka_ball !== null && j.otsenka_ball !== undefined) return String(j.otsenka_ball);
    return "—";
}

function isBad(mark) {
    return ["1", "2", "н/б", "нб", "д"].includes(String(mark).toLowerCase());
}

function parseDate(d) {
    if (!d) return 0;
    const p = d.split(".");
    if (p.length === 3) return new Date(+("20" + p[2]), +p[1] - 1, +p[0]).getTime();
    const q = d.split("-");
    if (q.length === 3) return new Date(+q[0], +q[1] - 1, +q[2]).getTime();
    return 0;
}

// --- копирование (тап = ФИО, удержание = логин) -----------------------------
function copyText(t) {
    const done = () => flash("Скопировано: " + t);
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(t).then(done).catch(() => fallbackCopy(t, done));
    } else {
        fallbackCopy(t, done);
    }
}
function fallbackCopy(t, done) {
    const ta = document.createElement("textarea");
    ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); done(); } catch (e) { flash("Не удалось скопировать"); }
    document.body.removeChild(ta);
}
let flashTimer = null;
function flash(msg) {
    setStatus(msg, "ok");
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => setStatus("Готово.", "info"), 1500);
}

function attachCopy(cell, fio, login) {
    let timer = null, longp = false;
    const start = () => { longp = false; timer = setTimeout(() => { longp = true; copyText(login); }, 500); };
    const end = () => { if (timer) { clearTimeout(timer); timer = null; if (!longp) copyText(fio); } };
    const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
    cell.addEventListener("mousedown", start);
    cell.addEventListener("mouseup", end);
    cell.addEventListener("mouseleave", cancel);
    cell.addEventListener("touchstart", start, { passive: true });
    cell.addEventListener("touchend", end);
    cell.addEventListener("touchcancel", cancel);
}

// --- дерево выбора ---------------------------------------------------------
async function loadReference() {
    state.ws = els.ws.value;
    setLed("busy");
    setStatus("Сканирование группы...");
    const refId = STUDENTS[0].split("-")[1];
    const user = await fetchJSON(`${BASE}/user?id_user=${refId}&id_avn=-1&id_role=2`);
    state.id_group = user.id_group;

    const sem = await fetchJSON(`${BASE}/student/semester/?id_year=${ID_YEAR}&id_ws=${state.ws}&id_group=${state.id_group}&id_student=${refId}`);
    if (!sem.length) throw new Error("Нет семестра для выбранного года/полугодия (попробуй другой год)");
    state.id_semester = sem[0].id_semester;

    const discs = await fetchJSON(`${BASE}/student/discipline/?id_year=${ID_YEAR}&id_ws=${state.ws}&id_group=${state.id_group}&id_student=${refId}&id_semester=${state.id_semester}`);

    // Группировка по baseName (как в SCOLPENDRA): варианты = "модули" предмета
    state.disciplineGroups = {};
    discs.forEach(d => {
        const baseName = parseBaseName(d);
        const tagMatch = d.discipline.match(/^\[(.*?)\]\s*/);
        const tag = tagMatch ? `[${tagMatch[1]}]` : "";
        if (!state.disciplineGroups[baseName]) state.disciplineGroups[baseName] = [];
        state.disciplineGroups[baseName].push({ ...d, baseName, tag, credit: parseCredit(d.discipline) });
    });

    const sortedBases = Object.keys(state.disciplineGroups).sort((a, b) => a.localeCompare(b, "ru"));
    els.subject.innerHTML = '<option value="" disabled selected>Предмет...</option>';
    sortedBases.forEach(baseName => {
        const opt = document.createElement("option");
        opt.value = baseName;
        opt.textContent = baseName;
        els.subject.appendChild(opt);
    });
    els.module.classList.add("hidden");
    els.module.innerHTML = '<option value="" disabled selected>Модуль...</option>';
    els.type.disabled = true;
    els.type.innerHTML = '<option value="" disabled selected>Тип...</option>';
    els.teacher.disabled = true;
    els.teacher.innerHTML = '<option value="" disabled selected>Препод...</option>';
    state.currentDiscipline = null;
    setStatus(`Группа ${state.id_group}, семестр ${state.id_semester}. Выбери предмет.`, "ok");
    setLed("ready");
}

async function loadVids() {
    if (!state.currentDiscipline) return;
    state.id_discipline = state.currentDiscipline.id_discipline;
    const refId = STUDENTS[0].split("-")[1];
    const vids = await fetchJSON(`${BASE}/student/vid-zanyatie?id_year=${ID_YEAR}&id_ws=${state.ws}&id_group=${state.id_group}&id_student=${refId}&id_semester=${state.id_semester}&id_discipline=${state.id_discipline}`);
    els.type.innerHTML = '<option value="" disabled selected>Тип...</option>';
    vids.forEach(v => {
        const opt = document.createElement("option");
        opt.value = v.id_vid_zaniatiy;
        opt.textContent = v.vid_zaniatiy;
        els.type.appendChild(opt);
    });
    els.type.disabled = false;
    els.teacher.disabled = true;
    els.teacher.innerHTML = '<option value="" disabled selected>Препод...</option>';

    // автоподстановка: если вид занятия единственный — выбираем сразу
    const realTypes = [...els.type.options].filter(o => o.value !== "");
    if (realTypes.length === 1) {
        els.type.value = realTypes[0].value;
        loadTeachers().catch(e => setStatus("Ошибка: " + e.message, "err"));
    }
}

async function loadTeachers() {
    state.id_vid = els.type.value;
    const refId = STUDENTS[0].split("-")[1];
    const teas = await fetchJSON(`${BASE}/student/teacher/?id_year=${ID_YEAR}&id_ws=${state.ws}&id_group=${state.id_group}&id_student=${refId}&id_discipline=${state.id_discipline}&id_semester=${state.id_semester}&id_vid_zaniatiy=${state.id_vid}`);
    els.teacher.innerHTML = '<option value="" disabled selected>Препод...</option>';
    teas.forEach(t => {
        const opt = document.createElement("option");
        opt.value = t.id_teacher;
        opt.textContent = t.t_fio;
        els.teacher.appendChild(opt);
    });
    els.teacher.disabled = false;

    // автоподстановка: если препод единственный — выбираем сразу и строим матрицу
    const realTeas = [...els.teacher.options].filter(o => o.value !== "");
    if (realTeas.length === 1) {
        els.teacher.value = realTeas[0].value;
        buildMatrix().catch(e => { setStatus("Ошибка: " + e.message, "err"); setLed("waiting"); });
    }
}

// --- построение матрицы ----------------------------------------------------
async function buildMatrix() {
    state.id_teacher = els.teacher.value;
    if (!state.id_teacher) { setStatus("Сначала выбери предмет, тип и препода.", "err"); return; }

    setLed("busy");
    setStatus("Сбор журнала по группе...");

    const rows = [];          // { login, fio, map: Map<date, mark> }
    const colMap = new Map(); // date -> topic

    for (const login of STUDENTS) {
        const id = login.split("-")[1];
        const user = await fetchJSON(`${BASE}/user?id_user=${id}&id_avn=-1&id_role=2`);
        const fio = `${user.surname} ${user.name} ${user.patronymic}`.trim();

        const journal = await fetchJSON(
            `${BASE}/student/journal/?id_year=${ID_YEAR}&id_ws=${state.ws}&id_group=${state.id_group}` +
            `&id_student=${id}&id_discipline=${state.id_discipline}&id_vid_zaniatiy=${state.id_vid}` +
            `&id_semester=${state.id_semester}&id_teacher=${state.id_teacher}`
        );

        const map = new Map();
        const rawMap = new Map();
        for (const j of journal) {
            const date = j.visitDate;
            const mark = normalizeMark(j);
            map.set(date, mark);
            rawMap.set(date, j);
            if (!colMap.has(date)) colMap.set(date, (j.lesson_topic || "").trim());
        }
        rows.push({ login, fio, map, rawMap });
    }

    // колонки по дате (хронологически)
    const columns = [...colMap.entries()].sort((a, b) => parseDate(a[0]) - parseDate(b[0]));
    state.columns = columns;
    // строки по алфавиту ФИО
    rows.sort((a, b) => a.fio.localeCompare(b.fio, "ru"));

    renderTable(columns, rows);
    setStatus(`Готово: ${rows.length} студентов, ${columns.length} занятий.`, "ok");
    setLed("ready");
}

function firstTwoWords(s) {
    const w = (s || "").trim().split(/\s+/).filter(Boolean);
    if (!w.length) return "—";
    return w.slice(0, 2).join(" ") + "…";
}

function renderTable(columns, rows) {
    activeMonitors.forEach(id => clearInterval(id));
    activeMonitors.clear();
    const table = els.table;
    table.innerHTML = "";

    // шапка: только даты (по клику/наведению — тема занятия)
    const thead = document.createElement("thead");
    const trTop = document.createElement("tr");

    const cornerTop = document.createElement("th");
    cornerTop.className = "corner";
    cornerTop.textContent = "Студент";
    trTop.appendChild(cornerTop);

    columns.forEach(([date, topic]) => {
        const thDate = document.createElement("th");
        thDate.className = "date-head";
        thDate.textContent = date;
        thDate.addEventListener("mouseenter", () => showTopicTip(thDate, topic));
        thDate.addEventListener("mouseleave", hideTopicTip);
        thDate.addEventListener("click", () => openTopicPopup(date, topic));
        trTop.appendChild(thDate);
    });
    thead.appendChild(trTop);
    table.appendChild(thead);

    // тело: строки студентов
    const tbody = document.createElement("tbody");
    rows.forEach(r => {
        const tr = document.createElement("tr");

        const tdFio = document.createElement("td");
        tdFio.className = "fio-cell";
        tdFio.innerHTML = `${r.fio}<span class="fio-sub">${r.login}</span>`;
        attachCopy(tdFio, r.fio, r.login);
        tr.appendChild(tdFio);

        columns.forEach(([date], colIdx) => {
            const mark = r.map.get(date) || "—";
            const td = document.createElement("td");
            td.className = "mark-cell" + (mark === "—" ? " empty" : (isBad(mark) ? " bad" : ""));
            td.textContent = mark;
            const entry = r.rawMap.get(date);
            if (entry) td.addEventListener("click", () => openEditModal(r.login, r.fio, date, entry, colIdx, td));
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
}

function showTopicTip(el, topic) {
    const tip = document.getElementById("topic-tip");
    tip.textContent = firstTwoWords(topic);
    tip.classList.remove("hidden");
    const r = el.getBoundingClientRect();
    const left = Math.min(r.left, window.innerWidth - tip.offsetWidth - 10);
    tip.style.left = Math.max(4, left) + "px";
    tip.style.top = (r.bottom + 6) + "px";
}

function hideTopicTip() {
    document.getElementById("topic-tip").classList.add("hidden");
}

function openTopicPopup(date, topic) {
    document.getElementById("topic-popup-date").textContent = date;
    document.getElementById("topic-popup-body").textContent = topic || "—";
    document.getElementById("topic-popup").classList.remove("hidden");
}

function closeTopicPopup() {
    document.getElementById("topic-popup").classList.add("hidden");
}

// --- редактирование оценки (порт SCOLPENDRA) --------------------------------
const MARK_MAP = [
    { id: 5, label: "5 (Excellent)" },
    { id: 4, label: "4 (Good)" },
    { id: 3, label: "3 (Satisfactory)" },
    { id: 2, label: "2 (Unsatisfactory)" },
    { id: 1, label: "1 (Fail)" },
    { id: 6, label: "н/б (Absent)" },
    { id: 7, label: "н/б 3 (Absent/Late)" },
    { id: 8, label: "CLEAR (Null)" }
];

// id метки -> то, что вернёт сервер (для сверки при поллинге)
const MARK_ID_TO_LABEL = { 5: "5", 4: "4", 3: "3", 2: "2", 1: "1", 6: "н/б", 7: "н/б 3", 8: "—" };

// толерантное сравнение оценок: LMS может вернуть "н/б" либо "нб", с пробелами и т.п.
function marksEqual(a, b) {
    const n = s => String(s == null ? "" : s).toLowerCase().replace(/\s+/g, "").replace(/\//g, "");
    return n(a) === n(b);
}

// независимые таймеры поллинга (по одному на изменённую ячейку)
const activeMonitors = new Set();

function startMarkMonitor(login, date, targetMarkId, cell) {
    if (cell._monitor) { clearInterval(cell._monitor); activeMonitors.delete(cell._monitor); }
    cell.classList.add("mark-pending");
    const expected = MARK_ID_TO_LABEL[targetMarkId];
    let tries = 0;
    const maxTries = 40;
    const id = setInterval(async () => {
        tries++;
        if (tries > maxTries) {
            clearInterval(id);
            activeMonitors.delete(id);
            cell._monitor = null;
            cell.classList.remove("mark-pending");
            cell.title = "Сервер не подтвердил изменение за отведённое время";
            return;
        }
        try {
            const idStudent = login.split("-")[1];
            const journal = await fetchJSON(
                `${BASE}/student/journal/?id_year=${ID_YEAR}&id_ws=${state.ws}&id_group=${state.id_group}` +
                `&id_student=${idStudent}&id_discipline=${state.id_discipline}&id_vid_zaniatiy=${state.id_vid}` +
                `&id_semester=${state.id_semester}&id_teacher=${state.id_teacher}`
            );
            const entry = journal.find(j => j.visitDate === date);
            const serverMark = entry ? normalizeMark(entry) : "—";
            if (marksEqual(serverMark, expected)) {
                clearInterval(id);
                activeMonitors.delete(id);
                cell._monitor = null;
                cell.className = "mark-cell" + (serverMark === "—" ? " empty" : (isBad(serverMark) ? " bad" : ""));
                cell.textContent = serverMark;
            }
        } catch (e) {
            // сетевая ошибка — продолжаем опрос
        }
    }, 15000);
    cell._monitor = id;
    activeMonitors.add(id);
}

function formatDate(d) {
    if (!d) return "";
    const p = d.split(".");
    if (p.length === 3) return `20${p[2]}-${p[1]}-${p[0]}`;
    return d;
}

async function openEditModal(login, fio, date, entry, colIdx, cell) {
    els.modal.classList.remove("hidden");
    els.modalMark.innerHTML = MARK_MAP.map(m => `<option value="${m.id}" ${m.id === 5 ? 'selected' : ''}>${m.label}</option>`).join("");

    let topicStatus = "SCANNING...";
    let finalTopicId = null;
    const discId = entry.id_discipline || state.id_discipline;
    const teacherId = entry.id_teacher || state.id_teacher;
    const vidId = entry.id_vid_zaniatiy || state.id_vid;
    const credit = entry.credit != null ? entry.credit : (state.currentDiscipline ? state.currentDiscipline.credit : null);
    const isoDate = formatDate(date);
    const studentId = parseInt(login.split("-")[1]);

    const renderPayload = () => {
        const selectedId = els.modalMark.value;
        const payload = {
            "id_teacher": parseInt(teacherId),
            "id_student": studentId,
            "id_discipline": parseInt(discId),
            "id_vid_zaniatiy": parseInt(vidId),
            "id_groupOrPorok": parseInt(state.id_group),
            "visitDate": `${isoDate}T00:00:00.000Z`,
            "id_otsenka": parseInt(selectedId),
            "id_modul": 1,
            "id_year": ID_YEAR,
            "isPotok": 0,
            "id_semesterOrWs": state.id_semester,
            "timesCount": 1,
            "isVisited": true,
            "credit": credit,
            "id_time": -1,
            "subgroup": null,
            "typeGroup": 0,
            "attempt": 0
        };
        if (finalTopicId !== null) payload["id_lesson_topic"] = finalTopicId;

        els.modalDetails.innerHTML = `
            <p><span style="color:var(--cyan-dim)">STUDENT:</span> ${fio} (${login})</p>
            <p><span style="color:var(--cyan-dim)">TARGET DATE:</span> ${date}</p>
            <p id="topic-sync-line" style="font-size:0.8rem; margin: 5px 0; font-weight:bold">${topicStatus}</p>
            <hr style="margin: 15px 0; border: 0; border-top: 1px dashed var(--border)">
            <p style="color:var(--cyan); font-size: 0.8rem; margin-bottom: 5px">GENERATED JSON PAYLOAD:</p>
            <pre style="background:#000; border: 1px solid #333; padding:10px; color:#0f0; font-size: 0.75rem; overflow:auto">${JSON.stringify(payload, null, 2)}</pre>
        `;
        const statusEl = document.getElementById("topic-sync-line");
        if (finalTopicId !== null) statusEl.style.color = "#0f0";
        else if (topicStatus.includes("MISMATCH") || topicStatus.includes("ERROR")) statusEl.style.color = "#f44";
    };

    renderPayload();
    els.modalMark.onchange = renderPayload;

    // Реальный SEND PUT назначается сразу — не зависит от успеха синка тем
    document.getElementById("save-mark").onclick = async () => {
        const markId = els.modalMark.value;
        const finalPayload = {
            "id_teacher": parseInt(teacherId),
            "id_student": studentId,
            "id_discipline": parseInt(discId),
            "id_vid_zaniatiy": parseInt(vidId),
            "id_groupOrPorok": parseInt(state.id_group),
            "visitDate": `${isoDate}T00:00:00.000Z`,
            "timesCount": 1,
            "id_otsenka": parseInt(markId),
            "isVisited": true,
            "credit": credit,
            "id_modul": 1,
            "isPotok": 0,
            "id_semesterOrWs": state.id_semester,
            "id_time": -1,
            "id_year": ID_YEAR,
            "subgroup": null,
            "typeGroup": 0,
            "attempt": 0
        };
        if (finalTopicId !== null) finalPayload["id_lesson_topic"] = finalTopicId;

        try {
            const response = await fetch(`${BASE}/teacher/otsenka`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
                body: JSON.stringify(finalPayload)
            });
            const result = await response.json().catch(() => ({}));
            if (response.ok) {
                alert(`SUCCESS!\nServer says: ${result.message || 'OK'}`);
                els.modal.classList.add("hidden");
                // оптимистичное обновление UI сразу при успешной отправке
                const newMark = MARK_ID_TO_LABEL[parseInt(markId)];
                cell.className = "mark-cell" + (newMark === "—" ? " empty" : (isBad(newMark) ? " bad" : ""));
                cell.textContent = newMark;
                startMarkMonitor(login, date, parseInt(markId), cell);
            } else {
                alert(`FIELD INJECTION FAILED.\nStatus: ${response.status}\nMessage: ${result.message || ''}`);
            }
        } catch (err) {
            alert(`CONNECTION LOST: ${err.message}`);
        }
    };

    // Фоновый синк тем (best-effort) — только решает, добавить ли id_lesson_topic
    (async () => {
        try {
            const topicsResponse = await fetchJSON(`${BASE}/lesson-topic/get-lessonTopic?discipline=${discId}&id_teacher=${teacherId}&id_vid_zaniatiy=${vidId}&id_modul=1`, { method: 'POST' });

            const journalCount = state.columns ? state.columns.length : 0;
            const topicCount = topicsResponse.length;
            if (journalCount === topicCount) {
                topicStatus = `[TOPIC MATCH: ${journalCount}/${topicCount}] - SYNCED BY INDEX`;
                finalTopicId = topicsResponse[colIdx] ? topicsResponse[colIdx].id_lesson_topic : null;
            } else {
                topicStatus = `[TOPIC MISMATCH: ${journalCount} Lsns / ${topicCount} Topics] - ID OMITTED`;
                finalTopicId = null;
            }
        } catch (e) {
            topicStatus = `[TOPIC ERROR: ${e.message}]`;
        }
        renderPayload();
    })();
}

// --- хвосты (порт движка ksma-bad-marks) ----------------------------------
function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function classifyLesson(lesson, vidType) {
    const mark = String(lesson.otsenka_ball);
    const status = String(lesson.otsenka || "").toLowerCase();
    const attempt = lesson.attempt;
    if (attempt === 2 || attempt === 3) return null; // уже отработано
    if (vidType === "Лекционный") {
        if (status === "д" || status === "н/б") return (status === "нб") ? "нб" : "д";
        return null;
    }
    if (mark === "1" || mark === "2" || status === "д" || status === "н/б") {
        if (mark === "1") return "1";
        if (mark === "2") return "2";
        return (status === "нб") ? "нб" : "д";
    }
    return null;
}

// Полное дерево параллельных запросов для одного студента (как в ksma-bad-marks)
async function fetchStudentDebts(idStudent) {
    const id_group = state.id_group;
    const id_semester = state.id_semester;
    const disciplines = await fetchJSON(`${BASE}/student/discipline/?id_year=${ID_YEAR}&id_ws=${state.ws}&id_group=${id_group}&id_student=${idStudent}&id_semester=${id_semester}`);
    const result = {
        total: { "2": 0, "1": 0, "нб": 0, "д": 0 },
        practice: { "2": 0, "1": 0, "нб": 0, "д": 0 },
        lecture: { "2": 0, "1": 0, "нб": 0, "д": 0 },
        cards: []
    };
    await Promise.all(disciplines.map(async (disc) => {
        try {
            const vids = await fetchJSON(`${BASE}/student/vid-zanyatie?id_year=${ID_YEAR}&id_ws=${state.ws}&id_group=${id_group}&id_student=${idStudent}&id_semester=${id_semester}&id_discipline=${disc.id_discipline}`);
            await Promise.all(vids.map(async (vid) => {
                const vidType = vid.vid_zaniatiy;
                const isLecture = vidType === "Лекционный";
                const cleanDisc = disc.discipline.replace(/\[.*?\]\s*/g, "").replace(/\(крд.*$/g, "").trim();
                const teachers = await fetchJSON(`${BASE}/student/teacher/?id_year=${ID_YEAR}&id_ws=${state.ws}&id_group=${id_group}&id_student=${idStudent}&id_discipline=${disc.id_discipline}&id_semester=${id_semester}&id_vid_zaniatiy=${vid.id_vid_zaniatiy}`);
                await Promise.all(teachers.map(async (teacher) => {
                    const journal = await fetchJSON(`${BASE}/student/journal/?id_year=${ID_YEAR}&id_ws=${state.ws}&id_group=${id_group}&id_student=${idStudent}&id_discipline=${disc.id_discipline}&id_vid_zaniatiy=${vid.id_vid_zaniatiy}&id_semester=${id_semester}&id_teacher=${teacher.id_teacher}`);
                    let localCounter = 0;
                    for (const lesson of journal) {
                        localCounter++;
                        const kind = classifyLesson(lesson, vidType);
                        if (!kind) continue;
                        const card = { subject: cleanDisc, teacher: teacher.t_fio, type: vidType, lessonNumber: localCounter, date: lesson.visitDate, topic: lesson.lesson_topic, mark: lesson.otsenka || lesson.otsenka_ball, kind };
                        result.total[kind]++;
                        if (isLecture) result.lecture[kind]++; else result.practice[kind]++;
                        result.cards.push(card);
                    }
                }));
            }));
        } catch (err) {
            console.error("debt error for", disc.discipline, err);
        }
    }));
    return result;
}

function renderCounts(obj) {
    const parts = [];
    if (obj["2"]) parts.push(`"2": ${obj["2"]}`);
    if (obj["1"]) parts.push(`"1": ${obj["1"]}`);
    if (obj["нб"]) parts.push(`н/б: ${obj["нб"]}`);
    if (obj["д"]) parts.push(`д: ${obj["д"]}`);
    return parts.length ? parts.join("   ") : "—";
}

function buildTailsRow(label, obj) {
    const parts = [];
    if (obj["2"]) parts.push(`"2": ${obj["2"]}`);
    if (obj["1"]) parts.push(`"1": ${obj["1"]}`);
    if (obj["нб"]) parts.push(`н/б: ${obj["нб"]}`);
    if (obj["д"]) parts.push(`д: ${obj["д"]}`);
    if (!parts.length) return "";
    return `<div class="tails-row"><span class="tails-row-label">${label}:</span> ${parts.join("   ")}</div>`;
}

function cardHtml(c) {
    const displayMark = c.mark && c.mark !== "" ? c.mark : "—";
    const markClass = (c.kind === "1" || c.kind === "2" || c.kind === "нб" || c.kind === "д") ? "bad" : "warn";
    const tip = c.type === "Практический" ? "(практ.)" : (c.type === "Лекционный" ? "(лекц.)" : "");
    return `<div class="tails-card">
        <div><b>Предмет:</b> ${escapeHtml(c.subject)} ${tip}</div>
        <div><b>Препод:</b> ${escapeHtml(c.teacher || "Не указан")}</div>
        <div><b>Дата:</b> ${escapeHtml(c.date || "")}</div>
        <div><b>Тема:</b> №${c.lessonNumber} – ${escapeHtml((c.topic || "").trim() || "")}</div>
        <div><b>Отметка: <span class="mark ${markClass}">${escapeHtml(displayMark)}</span></b></div>
    </div>`;
}

function buildTailsDetail(debts) {
    const practiceRow = buildTailsRow("Практика", debts.practice);
    const lectureRow = buildTailsRow("Лекции", debts.lecture);
    let html = practiceRow + lectureRow;
    if (!debts.cards.length) {
        html += `<div class="tails-none">Отработок нет!</div>`;
    } else {
        html += `<div class="tails-cards">` + debts.cards.map(cardHtml).join("") + `</div>`;
    }
    return html;
}

let tailsItems = {};

function renderTailsSkeleton() {
    els.tailsList.innerHTML = "";
    tailsItems = {};
    STUDENTS.forEach(login => {
        const item = document.createElement("div");
        item.className = "tails-item loading";
        item.innerHTML = `<div class="tails-item-head"><span class="tails-fio">${escapeHtml(login)}</span><span class="tails-summary">загрузка…</span></div><div class="tails-detail hidden"></div>`;
        els.tailsList.appendChild(item);
        tailsItems[login] = item;
    });
}

function renderTailsItem(login, fio, debts) {
    const item = tailsItems[login];
    if (!item) return;
    item.classList.remove("loading");
    item.querySelector(".tails-fio").textContent = fio;
    item.querySelector(".tails-summary").innerHTML = renderCounts(debts.total);
    item.querySelector(".tails-detail").innerHTML = buildTailsDetail(debts);
}

function renderTailsItemError(login, msg) {
    const item = tailsItems[login];
    if (!item) return;
    item.classList.remove("loading");
    item.querySelector(".tails-summary").textContent = "ошибка";
    item.querySelector(".tails-detail").innerHTML = `<div class="tails-none" style="color:#f44">${escapeHtml(msg)}</div>`;
}

async function loadTails() {
    if (!state.id_group || !state.id_semester) {
        setStatus("Сначала дождись загрузки группы (выбор предмета).", "err");
        return;
    }
    renderTailsSkeleton();
    await Promise.all(STUDENTS.map(async (login) => {
        const id = login.split("-")[1];
        try {
            const user = await fetchJSON(`${BASE}/user?id_user=${id}&id_avn=-1&id_role=2`);
            const fio = `${user.surname} ${user.name} ${user.patronymic}`.trim();
            const debts = await fetchStudentDebts(id);
            renderTailsItem(login, fio, debts);
        } catch (e) {
            renderTailsItemError(login, e.message);
        }
    }));
    setStatus("Хвосты обновлены.", "ok");
}

function openTailsPanel() {
    els.tailsOverlay.classList.remove("hidden");
    els.tailsPanel.classList.add("open");
    loadTails();
}

function closeTailsPanel() {
    els.tailsPanel.classList.remove("open");
    els.tailsOverlay.classList.add("hidden");
}

// --- события ---------------------------------------------------------------
els.ws.addEventListener("change", () => { loadReference().catch(e => { setStatus("Ошибка: " + e.message, "err"); setLed("waiting"); }); });
els.subject.addEventListener("change", () => {
    const baseName = els.subject.value;
    const variants = state.disciplineGroups[baseName] || [];
    els.type.disabled = true;
    els.type.innerHTML = '<option value="" disabled selected>Тип...</option>';
    els.teacher.disabled = true;
    els.teacher.innerHTML = '<option value="" disabled selected>Препод...</option>';
    state.currentDiscipline = null;

    if (variants.length > 1) {
        // показываем модуль-селект (варианты потока/секции)
        els.module.classList.remove("hidden");
        els.module.innerHTML = '<option value="" disabled selected>Модуль...</option>';
        variants.forEach(v => {
            const opt = document.createElement("option");
            opt.value = v.id_discipline;
            opt.textContent = v.tag || "[ОСНОВНОЙ]";
            els.module.appendChild(opt);
        });
    } else if (variants.length === 1) {
        els.module.classList.add("hidden");
        state.currentDiscipline = variants[0];
        loadVids().catch(e => setStatus("Ошибка: " + e.message, "err"));
    }
});

els.module.addEventListener("change", () => {
    const discId = els.module.value;
    const baseName = els.subject.value;
    state.currentDiscipline = (state.disciplineGroups[baseName] || []).find(d => d.id_discipline == discId) || null;
    loadVids().catch(e => setStatus("Ошибка: " + e.message, "err"));
});
els.type.addEventListener("change", () => { loadTeachers().catch(e => setStatus("Ошибка: " + e.message, "err")); });
els.teacher.addEventListener("change", () => { buildMatrix().catch(e => { setStatus("Ошибка: " + e.message, "err"); setLed("waiting"); }); });
document.getElementById("topic-popup-close").addEventListener("click", closeTopicPopup);
document.getElementById("topic-popup").addEventListener("click", e => { if (e.target.id === "topic-popup") closeTopicPopup(); });
document.getElementById("close-modal").addEventListener("click", () => els.modal.classList.add("hidden"));
els.modal.addEventListener("click", e => { if (e.target === els.modal) els.modal.classList.add("hidden"); });

// хвосты
els.tailsBtn.addEventListener("click", openTailsPanel);
els.tailsClose.addEventListener("click", closeTailsPanel);
els.tailsOverlay.addEventListener("click", closeTailsPanel);
els.tailsRefresh.addEventListener("click", () => loadTails());
els.tailsList.addEventListener("click", e => {
    const head = e.target.closest(".tails-item-head");
    if (!head) return;
    const detail = head.parentElement.querySelector(".tails-detail");
    if (detail) detail.classList.toggle("hidden");
});

// старт
loadReference().catch(e => { setStatus("Ошибка: " + e.message, "err"); setLed("waiting"); });
