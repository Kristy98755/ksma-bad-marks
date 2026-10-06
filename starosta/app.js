// ===========================================================================
//  STAROSTA // GROUP JOURNAL
//  Журнал только своей группы. Источник: студенческий API LMS КГМА
//  (каждый логин опрашивается напрямую, без авторизации — как в SCOLPENDRA).
// ===========================================================================

const BASE = "https://lms.kgma.kg/vm/api";

// ID_YEAR = 26 по хотелке заказчика, НО в LMS учебного года 26 ещё нет данных.
// Для РАБОЧЕГО ТЕСТА используем 25 (в 26 семестр пустой -> краш).
// Поменяй на 26, когда в LMS появятся данные за год 26.
const ID_YEAR = 26;

// Хардкод группы (логины студентов)
const STUDENTS = [
    "1-61766", "1-61691", "1-62447", "1-69639", "1-61690",
    "1-66675", "1-62408", "1-61552", "1-70060", "1-61709",
    "1-73348", "1-66571", "1-66601"
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
    tailsPdf: document.getElementById("tails-pdf"),
    tailsClose: document.getElementById("tails-close"),
    tailsList: document.getElementById("tails-list"),
    copyFioBtn: document.getElementById("copy-fio-btn")
};

let state = {
    ws: "2",
    id_group: null,
    id_semester: null,
    id_discipline: null,
    id_vid: null,
    id_teacher: null,
    disciplineGroups: {},
    currentDiscipline: null,
    rows: null
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

// Лоадер на время сбора таблицы: прячет матрицу, показывает спиннер
function setLoader(show, text) {
    const box = document.getElementById("table-loader");
    if (!box) return;
    if (text) document.getElementById("loader-text").textContent = text;
    box.classList.toggle("hidden", !show);
    els.table.classList.toggle("hidden", show);
}

// Артефакт LMS: "Ганиев- Миркамил Миркодирович" -> "Ганиев Миркамил Миркодирович".
// Дефисы без пробела ("Дунканаева-Абдыбекова") не трогаем.
function cleanFio(fio) {
    return String(fio || "")
        .replace(/-\s+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function parseBaseName(disc) {
    const m = disc.discipline.match(/^\[(.*?)\]\s*(.*)/);
    let tag = m ? `[${m[1]}]` : "";
    let raw = m ? m[2] : disc.discipline;
    return raw.replace(/\(крд.*$/g, "").replace(/каф\..*$/g, "").trim();
}

function parseCredit(disc) {
    // как в SCOLPENDRA: "(крд.-2.5)" -> 2.5, "(крд.--0.4)" -> 0.4, "(крд-1.5)" -> 1.5
    // дефисы после "крд" — разделители, знак к числу не относится; иначе приходят
    // отрицательные/null кредиты и PUT уходит с битым credit.
    const m = (disc || "").match(/\(крд[^\d]*([\d.]+)\)/i);
    return m ? parseFloat(m[1]) : 0;
}

function normalizeMark(j) {
    if (j.otsenka !== null && j.otsenka !== undefined && j.otsenka !== "") return String(j.otsenka);
    if (j.otsenka_ball !== null && j.otsenka_ball !== undefined) return String(j.otsenka_ball);
    return "—";
}

// Цифровая оценка для среднего: "4", "5", "4.5" -> число.
// "н/б", "н/б 3", "д", "—", null и "0" (в LMS 0 = оценки нет, sentinel у н/б) — мимо.
function avgValue(mark) {
    if (mark === null || mark === undefined) return null;
    const s = String(mark).trim();
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    const v = parseFloat(s);
    return v > 0 ? v : null;
}

// Средний балл строки: по всем датам, пустые/нечисловые ячейки не участвуют.
// null — если цифровых оценок у студента нет вообще.
function calcAverage(row, columns) {
    let sum = 0, n = 0;
    for (const [date] of columns) {
        const v = avgValue(row.map.get(date));
        if (v !== null) { sum += v; n++; }
    }
    return n ? sum / n : null;
}

// Пересчёт ячейки «СР.БАЛЛ» после изменения оценки (PUT или подтверждение монитором)
function refreshAvgFor(login, date, newMark) {
    const row = (state.rows || []).find(x => x.login === login);
    if (!row) return;
    if (date != null && newMark !== undefined) row.map.set(date, newMark);
    if (row.avgCell && state.columns) {
        const avg = calcAverage(row, state.columns);
        row.avgCell.textContent = avg === null ? "—" : avg.toFixed(2);
        row.avgCell.classList.toggle("empty", avg === null);
    }
}

// Приводит отметку к «нехорошему» виду: "1", "2", "нб", "нб3", "д".
// Парсим всё как разное: "н/б", "нб" -> "нб"; "н/б 3", "нб 3", "нб3" -> "нб3";
// "д"/"допущен" -> "д"; цифры с пробелами. Всё прочее (3/4/5/—/пусто) -> null.
// Для фильтра (isBad) "нб3" равноценен "нб" — оба считаются нехорошими.
function normalizeBadKind(raw) {
    const s = String(raw == null ? "" : raw).toLowerCase().replace(/\s+/g, " ").trim();
    if (s === "1") return "1";
    if (s === "2") return "2";
    if (/^н\/?б\s*3/.test(s)) return "нб3";
    if (/^н\/?б/.test(s)) return "нб";
    if (s === "д" || /^допущен/.test(s)) return "д";
    return null;
}

function isBad(mark) {
    return normalizeBadKind(mark) !== null;
}

function parseDate(d) {
    if (!d) return 0;
    const p = d.split(".");
    if (p.length === 3) return new Date(+("20" + p[2]), +p[1] - 1, +p[0]).getTime();
    const q = d.split("-");
    if (q.length === 3) return new Date(+q[0], +q[1] - 1, +q[2]).getTime();
    return 0;
}

// --- копирование (только логин) --------------------------------------------
// ПК: удержание 0.5 с. Мобайл (coarse pointer): удержание 2 с.
// Тап и короткое удержание ничего не копируют (ФИО убрано везде).
const IS_TOUCH_UI = !!(window.matchMedia &&
    window.matchMedia("(hover: none) and (pointer: coarse)").matches);
const HOLD_MS = IS_TOUCH_UI ? 2000 : 500;

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

function attachCopy(cell, login) {
    let timer = null;
    let startX = 0, startY = 0;

    const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
    const start = (x, y) => {
        startX = x; startY = y;
        clear();
        timer = setTimeout(() => { timer = null; copyText(login); }, HOLD_MS);
    };
    // скролл/перетаскивание отменяют удержание
    const move = (x, y) => {
        if (timer && Math.hypot(x - startX, y - startY) > 10) clear();
    };

    cell.addEventListener("mousedown", e => start(e.clientX, e.clientY));
    cell.addEventListener("mousemove", e => move(e.clientX, e.clientY));
    cell.addEventListener("mouseup", clear);
    cell.addEventListener("mouseleave", clear);

    cell.addEventListener("touchstart", e => { const t = e.touches[0]; start(t.clientX, t.clientY); }, { passive: true });
    cell.addEventListener("touchmove", e => { const t = e.touches[0]; move(t.clientX, t.clientY); }, { passive: true });
    cell.addEventListener("touchend", clear);
    cell.addEventListener("touchcancel", clear);
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
    setLoader(true, `СБОР ЖУРНАЛА: 0/${STUDENTS.length}`);

    try {
        const rows = [];          // { login, fio, map: Map<date, mark> }
        const colMap = new Map(); // date -> topic

        for (let i = 0; i < STUDENTS.length; i++) {
            const login = STUDENTS[i];
            setLoader(true, `СБОР ЖУРНАЛА: ${i + 1}/${STUDENTS.length}`);
            const id = login.split("-")[1];
            const user = await fetchJSON(`${BASE}/user?id_user=${id}&id_avn=-1&id_role=2`);
            const fio = cleanFio(`${user.surname} ${user.name} ${user.patronymic}`);

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
    } finally {
        setLoader(false);
    }
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
    state.rows = rows;

    // Колонка среднего балла ставится ТОЛЬКО если в таблице есть хотя бы одна
    // цифровая оценка: «предмет есть, оценок нет» (например, Неонатология ->
    // Лекционный — пустой журнал) => колонки нет. Пустые ячейки отдельных
    // студентов в расчёт не входят (это не повод скрывать колонку).
    const showAvg = rows.some(r => columns.some(([date]) => avgValue(r.map.get(date)) !== null));

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

    if (showAvg) {
        const thAvg = document.createElement("th");
        thAvg.className = "avg-head";
        thAvg.textContent = "СР.БАЛЛ";
        trTop.appendChild(thAvg);
    }
    thead.appendChild(trTop);
    table.appendChild(thead);

    // тело: строки студентов
    const tbody = document.createElement("tbody");
    rows.forEach(r => {
        const tr = document.createElement("tr");

        const tdFio = document.createElement("td");
        tdFio.className = "fio-cell";
        tdFio.innerHTML = `${r.fio}<span class="fio-sub">${r.login}</span>`;
        attachCopy(tdFio, r.login);
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

        if (showAvg) {
            const avg = calcAverage(r, columns);
            const tdAvg = document.createElement("td");
            tdAvg.className = "avg-cell" + (avg === null ? " empty" : "");
            tdAvg.textContent = avg === null ? "—" : avg.toFixed(2);
            tr.appendChild(tdAvg);
            r.avgCell = tdAvg;
        } else {
            r.avgCell = undefined;
        }
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
                refreshAvgFor(login, date, serverMark);
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
    const credit = entry.credit != null ? entry.credit : (state.currentDiscipline && state.currentDiscipline.credit != null ? state.currentDiscipline.credit : 0);
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
        else if (topicStatus.includes("NOT FOUND") || topicStatus.includes("MISMATCH") || topicStatus.includes("ERROR")) statusEl.style.color = "#f44";
    };

    renderPayload();
    els.modalMark.onchange = renderPayload;

    // Фоновый синк тем: матчинг по тексту темы урока (тем в списке меньше, чем
    // уроков — темы повторяются, часть тем вообще отсутствует в списке препода).
    const topicSyncPromise = (async () => {
        try {
            const topicsResponse = await fetchJSON(`${BASE}/lesson-topic/get-lessonTopic?discipline=${discId}&id_teacher=${teacherId}&id_vid_zaniatiy=${vidId}&id_modul=1`, { method: 'POST' });
            const normTopic = s => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
            const columnTopic = state.columns && state.columns[colIdx] ? state.columns[colIdx][1] : "";
            const hit = topicsResponse.find(t => normTopic(t.lesson_topic) === normTopic(columnTopic));
            if (hit) {
                finalTopicId = hit.id_lesson_topic;
                topicStatus = `[TOPIC MATCH: "${columnTopic}" -> id ${hit.id_lesson_topic}]`;
            } else {
                finalTopicId = null;
                topicStatus = `[TOPIC NOT FOUND: "${columnTopic || "?"}"] - ID OMITTED`;
            }
        } catch (e) {
            finalTopicId = null;
            topicStatus = `[TOPIC ERROR: ${e.message}]`;
        }
        renderPayload();
    })();

    // Реальный SEND PUT назначается сразу; перед отправкой дожидаемся синка тем,
    // чтобы ранний клик не ушёл без id_lesson_topic.
    document.getElementById("save-mark").onclick = async () => {
        await topicSyncPromise.catch(() => {});
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
                refreshAvgFor(login, date, newMark);
                startMarkMonitor(login, date, parseInt(markId), cell);
            } else {
                alert(`FIELD INJECTION FAILED.\nStatus: ${response.status}\nMessage: ${result.message || ''}`);
            }
        } catch (err) {
            alert(`CONNECTION LOST: ${err.message}`);
        }
    };
}

// --- хвосты (порт движка ksma-bad-marks) ----------------------------------
function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function classifyLesson(lesson, vidType) {
    // берём ту же отметку, что показывает матрица (otsenka приоритетнее балла)
    const raw = lesson.otsenka || lesson.otsenka_ball;
    const attempt = Number(lesson.attempt);
    if (attempt === 2 || attempt === 3) return null; // уже отработано

    const kind = normalizeBadKind(raw);
    if (!kind) return null;

    // лекции: только "нб"/"нб3"/"д" (как в движке ksma-bad-marks)
    if (vidType === "Лекционный") {
        return (kind === "нб" || kind === "нб3" || kind === "д") ? kind : null;
    }
    // практика и всё остальное: 1, 2, нб, д
    return kind;
}

// Полное дерево параллельных запросов для одного студента (как в ksma-bad-marks)
async function fetchStudentDebts(idStudent) {
    const id_group = state.id_group;
    const id_semester = state.id_semester;
    const disciplines = await fetchJSON(`${BASE}/student/discipline/?id_year=${ID_YEAR}&id_ws=${state.ws}&id_group=${id_group}&id_student=${idStudent}&id_semester=${id_semester}`);
    const result = {
        total: { "2": 0, "1": 0, "нб": 0, "нб3": 0, "д": 0 },
        practice: { "2": 0, "1": 0, "нб": 0, "нб3": 0, "д": 0 },
        lecture: { "2": 0, "1": 0, "нб": 0, "нб3": 0, "д": 0 },
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
    // карточки приходят в порядке завершения параллельных запросов — сортируем
    // по дате (потом по предмету), чтобы и матрица, и PDF читались по порядку
    result.cards.sort((a, b) =>
        (parseDate(a.date) - parseDate(b.date)) ||
        String(a.subject).localeCompare(String(b.subject), "ru"));
    return result;
}

// столбик строк счётчика: «2» – N / «1» – N / «нб» – N / «нб3» – N / «д» – N
// "нб" и "нб3" — разные виды, в одну строку НЕ складываются;
// нулевые, null и отсутствующие значения не выводятся
const TAIL_ROWS = [
    ["«2»", ["2"]],
    ["«1»", ["1"]],
    ["«нб»", ["нб"]],
    ["«нб3»", ["нб3"]],
    ["«д»", ["д"]]
];

function countLines(obj) {
    return TAIL_ROWS
        .map(([label, keys]) => [label, keys.reduce((sum, k) => sum + (Number(obj ? obj[k] : null) || 0), 0)])
        .filter(([, n]) => n > 0)
        .map(([label, n]) => `${label} – ${n}`);
}

function renderCounts(obj) {
    const lines = countLines(obj);
    return lines.length ? lines.join("<br>") : "—";
}

function buildTailsRow(label, obj) {
    const lines = countLines(obj);
    if (!lines.length) return "";
    return `<div class="tails-row"><span class="tails-row-label">${label}:</span><div class="tails-counts">${lines.join("<br>")}</div></div>`;
}

function cardHtml(c) {
    const displayMark = c.mark && c.mark !== "" ? c.mark : "—";
    const markClass = isBad(c.kind) ? "bad" : "warn";
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
let tailsRoster = [];   // [{ login, fio }] — порядок списка: по фамилии
let tailsResults = {};  // login -> { fio, debts } | { fio, error }

// ФИО — "Фамилия Имя Отчество", поэтому сортировка строк = сортировка по фамилии
// (логины вроде "1-61709" тут ни при чём — раньше список шёл в порядке STUDENTS)
function compareFio(a, b) {
    return String(a || "").localeCompare(String(b || ""), "ru");
}

function totalTails(debts) {
    if (!debts || !debts.total) return 0;
    return Object.keys(debts.total).reduce((s, k) => s + (Number(debts.total[k]) || 0), 0);
}

function renderTailsSkeleton(roster) {
    els.tailsList.innerHTML = "";
    tailsItems = {};
    tailsResults = {};
    roster.forEach(({ login }) => {
        const item = document.createElement("div");
        item.className = "tails-item loading";
        item.innerHTML = `<div class="tails-item-head"><span class="tails-fio">${escapeHtml(login)}</span><span class="tails-summary">загрузка…</span></div><div class="tails-detail hidden"></div>`;
        els.tailsList.appendChild(item);
        tailsItems[login] = item;
    });
}

function renderTailsItem(login, fio, debts) {
    tailsResults[login] = { fio, debts };
    const item = tailsItems[login];
    if (!item) return;
    item.classList.remove("loading");
    item.querySelector(".tails-fio").textContent = fio;
    item.querySelector(".tails-summary").innerHTML = renderCounts(debts.total);
    item.querySelector(".tails-detail").innerHTML = buildTailsDetail(debts);
}

function renderTailsItemError(login, fio, msg) {
    tailsResults[login] = { fio, error: msg };
    const item = tailsItems[login];
    if (!item) return;
    item.classList.remove("loading");
    item.querySelector(".tails-fio").textContent = fio || login;
    item.querySelector(".tails-summary").textContent = "ошибка";
    item.querySelector(".tails-detail").innerHTML = `<div class="tails-none" style="color:#f44">${escapeHtml(msg)}</div>`;
}

async function loadTails() {
    if (!state.id_group || !state.id_semester) {
        setStatus("Сначала дождись загрузки группы (выбор предмета).", "err");
        return;
    }

    // на время перезагрузки список пуст (экспорт в это время скажет «подожди»)
    els.tailsList.innerHTML = "";
    tailsRoster = [];
    tailsResults = {};

    // 1) ФИО всех студентов — чтобы выстроить список по фамилии, а не по логину
    let read = 0;
    setStatus(`ЧТЕНИЕ ФИО ГРУППЫ: 0/${STUDENTS.length}`, "info");
    const roster = await Promise.all(STUDENTS.map(async (login) => {
        const id = login.split("-")[1];
        try {
            const user = await fetchJSON(`${BASE}/user?id_user=${id}&id_avn=-1&id_role=2`);
            return { login, fio: cleanFio(`${user.surname} ${user.name} ${user.patronymic}`) };
        } catch (e) {
            return { login, fio: login, error: e.message };
        } finally {
            read++;
            setStatus(`ЧТЕНИЕ ФИО ГРУППЫ: ${read}/${STUDENTS.length}`, "info");
        }
    }));
    roster.sort((a, b) => compareFio(a.fio, b.fio));
    tailsRoster = roster;
    renderTailsSkeleton(roster);
    roster.forEach(r => { if (r.error) renderTailsItemError(r.login, r.fio, r.error); });

    // 2) хвосты каждого — по мере готовности, порядок в DOM уже по фамилии
    await Promise.all(roster.filter(r => !r.error).map(async ({ login, fio }) => {
        try {
            const debts = await fetchStudentDebts(login.split("-")[1]);
            renderTailsItem(login, fio, debts);
        } catch (e) {
            renderTailsItemError(login, fio, e.message);
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

// --- экспорт списка хвостов в PDF -------------------------------------------
// PDF собирается прямо в браузере, штатное средство печати не используется:
//  1) список рисуется на canvas — кириллица выводится веб-шрифтом как есть
//     (стандартные шрифты jsPDF кириллицу не умеют);
//  2) страницы canvas складываются в PDF через jsPDF.
// jsPDF грузится с CDN один раз и сохраняется в localStorage (не в Cache API):
// localStorage живёт дольше и не зависит от Service Worker/кэша страницы.
const PDF_LIB_KEY = "starosta.jspdf.2.5.2";
const PDF_LIB_URLS = [
    "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js",
    "https://unpkg.com/jspdf@2.5.2/dist/jspdf.umd.min.js"
];
const PDF_PX_W = 1240;  // A4 при 150 dpi
const PDF_PX_H = 1754;
const PDF_MARGIN = 70;

function injectPdfLib(src) {
    try {
        const script = document.createElement("script");
        script.textContent = src;
        document.head.appendChild(script);
    } catch (e) {
        // CSP запрещает — считаем загрузку неудачной
    }
    return !!(window.jspdf && window.jspdf.jsPDF);
}

async function fetchPdfLib() {
    for (const url of PDF_LIB_URLS) {
        try {
            const res = await fetch(url);
            if (!res.ok) continue;
            const text = await res.text();
            if (text && text.indexOf("jsPDF") !== -1) return text;
        } catch (e) {
            // пробуем следующий CDN
        }
    }
    return null;
}

async function ensureJsPDF() {
    if (window.jspdf && window.jspdf.jsPDF) return window.jspdf.jsPDF;

    // 1) копия из localStorage (работает и офлайн)
    let stored = null;
    try { stored = localStorage.getItem(PDF_LIB_KEY); } catch (e) { /* приватный режим */ }
    if (stored && injectPdfLib(stored)) return window.jspdf.jsPDF;
    if (stored) {
        // битая/устаревшая копия — выкидываем и тянем заново
        try { localStorage.removeItem(PDF_LIB_KEY); } catch (e) { /* ignore */ }
    }

    // 2) первая загрузка: CDN -> localStorage
    setStatus("ЗАГРУЗКА БИБЛИОТЕКИ PDF...", "info");
    const src = await fetchPdfLib();
    if (!src) throw new Error("библиотека PDF недоступна (нет сети или CDN)");
    if (!injectPdfLib(src)) throw new Error("библиотека PDF не инициализировалась");
    try { localStorage.setItem(PDF_LIB_KEY, src); } catch (e) { /* квота — работаем из памяти */ }
    return window.jspdf.jsPDF;
}

function buildTailsPdfPages(entries) {
    const pages = [];
    let ctx = null;
    let y = 0;

    const font = (size, bold) =>
        `${bold ? "700" : "400"} ${size}px "Courier Prime", "Courier New", monospace`;

    function newPage() {
        const canvas = document.createElement("canvas");
        canvas.width = PDF_PX_W;
        canvas.height = PDF_PX_H;
        const c = canvas.getContext("2d");
        c.fillStyle = "#ffffff";
        c.fillRect(0, 0, PDF_PX_W, PDF_PX_H);
        c.textBaseline = "top";
        pages.push({ canvas, ctx: c });
        ctx = c;
        y = PDF_MARGIN;
    }

    function ensure(h) {
        if (y + h > PDF_PX_H - PDF_MARGIN) newPage();
    }

    // разбивка текста на строки по ширине; слова длиннее строки — посимвольно
    function wrapText(text, size, bold, maxW) {
        ctx.font = font(size, bold);
        const out = [];
        let line = "";
        const push = () => { if (line !== "") { out.push(line); line = ""; } };
        for (const word of String(text).split(/\s+/).filter(w => w !== "")) {
            let w = word;
            const test = line ? line + " " + w : w;
            if (ctx.measureText(test).width <= maxW) { line = test; continue; }
            push();
            while (w !== "" && ctx.measureText(w).width > maxW) {
                let cut = w.length;
                while (cut > 1 && ctx.measureText(w.slice(0, cut)).width > maxW) cut--;
                out.push(w.slice(0, cut));
                w = w.slice(cut);
            }
            line = w;
        }
        push();
        return out.length ? out : [""];
    }

    function drawText(text, opts) {
        const size = opts.size || 16;
        const bold = !!opts.bold;
        const indent = opts.indent || 0;
        const maxW = PDF_PX_W - PDF_MARGIN * 2 - indent;
        const lh = Math.round(size * 1.4);
        for (const line of wrapText(text, size, bold, maxW)) {
            ensure(lh);
            // ctx мог смениться при переходе на новую страницу — шрифт заново
            ctx.font = font(size, bold);
            ctx.fillStyle = opts.color || "#111111";
            ctx.fillText(line, PDF_MARGIN + indent, y);
            y += lh;
        }
    }

    function spacer(h) { y += h; }

    function rule() {
        ensure(14);
        ctx.strokeStyle = "#bbbbbb";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PDF_MARGIN, y + 4);
        ctx.lineTo(PDF_PX_W - PDF_MARGIN, y + 4);
        ctx.stroke();
        y += 14;
    }

    newPage();

    // заголовок отчёта
    drawText("STAROSTA // СПИСОК ХВОСТОВ", { size: 30, bold: true });
    const wsLabel = state.ws === "1" ? "Весеннее" : "Осеннее";
    const readyNote = entries.length < tailsRoster.length
        ? ` · готово ${entries.length} из ${tailsRoster.length}` : "";
    drawText(`Группа ${state.id_group || "?"} · ${wsLabel} полугодие · ${new Date().toLocaleDateString("ru-RU")}${readyNote}`,
        { size: 15, color: "#555555" });
    spacer(4);
    rule();
    spacer(6);

    entries.forEach((entry, i) => {
        // шапку студента не оставляем внизу страницы в одиночку
        ensure(Math.round(19 * 1.4) + Math.round(15 * 1.4));
        drawText(`${i + 1}. ${entry.fio} (${entry.login})`, { size: 19, bold: true });
        if (entry.error) {
            drawText(`ошибка загрузки: ${entry.error}`, { size: 14, indent: 24, color: "#c0392b" });
        } else {
            const counts = countLines(entry.debts.total);
            if (!counts.length) {
                drawText("— хвостов нет", { size: 14, indent: 24, color: "#666666" });
            } else {
                drawText(`ВСЕГО: ${totalTails(entry.debts)}    ${counts.join("    ")}`,
                    { size: 15, bold: true, indent: 24 });
                entry.debts.cards.forEach(c => {
                    const tip = c.type === "Практический" ? "практ."
                        : (c.type === "Лекционный" ? "лекц." : (c.type || ""));
                    drawText(`• ${c.date || "—"} · ${c.subject}${tip ? " (" + tip + ")" : ""} · ${c.mark || "—"}`,
                        { size: 14, indent: 44 });
                    if (c.teacher) drawText(`препод: ${c.teacher}`, { size: 13, indent: 64, color: "#666666" });
                });
            }
        }
        spacer(16);
    });

    // колонтитул после сборки — знаем общее число страниц
    pages.forEach((p, idx) => {
        p.ctx.font = font(13, false);
        p.ctx.fillStyle = "#999999";
        p.ctx.fillText("ksma-bad-marks · starosta", PDF_MARGIN, PDF_PX_H - PDF_MARGIN + 16);
        const right = `Стр. ${idx + 1} / ${pages.length}`;
        p.ctx.fillText(right, PDF_PX_W - PDF_MARGIN - p.ctx.measureText(right).width, PDF_PX_H - PDF_MARGIN + 16);
    });

    return pages;
}

// Собрать и отдать PDF со списком хвостов (кнопка «PDF» в панели хвостов)
async function exportTailsPdf() {
    if (!tailsRoster.length) {
        setStatus("Список хвостов не загружен — сначала нажми «⟳».", "err");
        return;
    }
    const entries = tailsRoster
        .map(r => {
            const res = tailsResults[r.login];
            if (!res) return null;
            return { login: r.login, fio: res.fio || r.fio, debts: res.debts, error: res.error };
        })
        .filter(Boolean);
    if (!entries.length) {
        setStatus("Данных ещё нет — список загружается, подожди.", "err");
        return;
    }

    const btn = els.tailsPdf;
    if (btn) { btn.disabled = true; btn.classList.add("busy"); }
    try {
        const JsPDF = await ensureJsPDF();
        if (document.fonts && document.fonts.ready) {
            try { await document.fonts.ready; } catch (e) { /* шрифт догрузится с системным */ }
        }
        const pages = buildTailsPdfPages(entries);
        const doc = new JsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
        pages.forEach((p, i) => {
            if (i) doc.addPage();
            doc.addImage(p.canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 210, 297);
        });
        const d = new Date();
        const pad = n => String(n).padStart(2, "0");
        const name = `hvosty_${state.id_group || "group"}_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.pdf`;
        doc.save(name);
        setStatus(`PDF сохранён: ${pages.length} стр., ${entries.length} студ.`, "ok");
    } catch (e) {
        setStatus("PDF не удался: " + e.message, "err");
    } finally {
        if (btn) { btn.disabled = false; btn.classList.remove("busy"); }
    }
}

// --- копирование ФИО всех студентов столбиком -------------------------------
async function copyAllFio() {
    const rows = state.rows || [];
    if (!rows.length) {
        setStatus("Таблица не загружена — сначала собери журнал.", "err");
        return;
    }
    const text = rows.map(r => r.fio).join("\n");
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
        } else {
            // fallback без HTTPS/clipboard API
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand("copy");
            document.body.removeChild(ta);
            if (!ok) throw new Error("браузер запретил копирование");
        }
        setStatus(`Скопировано ФИО: ${rows.length} студентов.`, "ok");
        els.copyFioBtn.classList.add("copied");
        setTimeout(() => els.copyFioBtn.classList.remove("copied"), 900);
    } catch (e) {
        setStatus("Копирование не удалось: " + e.message, "err");
    }
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
els.copyFioBtn.addEventListener("click", copyAllFio);
els.tailsClose.addEventListener("click", closeTailsPanel);
els.tailsOverlay.addEventListener("click", closeTailsPanel);
els.tailsRefresh.addEventListener("click", () => loadTails());
els.tailsPdf.addEventListener("click", () => exportTailsPdf());
els.tailsList.addEventListener("click", e => {
    const head = e.target.closest(".tails-item-head");
    if (!head) return;
    const detail = head.parentElement.querySelector(".tails-detail");
    if (detail) detail.classList.toggle("hidden");
});

// старт
loadReference().catch(e => { setStatus("Ошибка: " + e.message, "err"); setLed("waiting"); });

// Отступ контента сверху: не фиксированный, а 20px + фактическая высота шапки
// (шапка fixed на десктопе и меняет высоту от ширины экрана/переносов строк).
// На мобиле шапка static и идёт в потоке — ей отступ не нужен, только 20px.
function syncMainOffset() {
    const header = document.querySelector("header");
    const main = document.querySelector("main");
    if (!header || !main) return;
    const headerH = getComputedStyle(header).position === "fixed" ? header.offsetHeight : 0;
    main.style.marginTop = (headerH + 20) + "px";
}
syncMainOffset();
window.addEventListener("resize", syncMainOffset);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncMainOffset);
if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(syncMainOffset).observe(document.querySelector("header"));
}
