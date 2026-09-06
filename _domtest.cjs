// Эмуляция минимального DOM для проверки инициализации script.js
const handlers = {};
function makeEl(id) {
  return {
    id,
    value: "1-62447",
    style: {},
    classList: { add(){}, remove(){} },
    addEventListener(ev, fn){ (handlers[id] = handlers[id] || {})[ev] = fn; },
    set onclick(fn){ handlers[id] = handlers[id] || {}; handlers[id].click = fn; },
    get onclick(){ return handlers[id] ? handlers[id].click : null; },
    appendChild(){}, querySelectorAll(){ return []; },
    parentNode: { insertBefore(){} }
  };
}
const els = {};
global.document = {
  getElementById(id){ return els[id] || (els[id] = makeEl(id)); },
  querySelectorAll(){ return []; },
  addEventListener(){},
  cookie: ""
};
global.window = { addEventListener(){} };
global.localStorage = { getItem(){return null;}, setItem(){} };
global.fetch = async () => { throw new Error("network"); };
global.confetti = () => {};

// Подгружаем script.js как текст и исполняем
const fs = require("fs");
const code = fs.readFileSync("script.js", "utf-8");
try {
  // выполняем в текущем (глобальном) контексте
  eval(code);
  console.log("INIT OK — скрипт исполнился без ошибок инициализации");
  console.log("load.onclick attached:", typeof handlers["load"]?.click);
  console.log("load.click listener:", typeof (handlers["load"]?.click));
} catch (e) {
  console.log("INIT ERROR:", e.message);
  console.log(e.stack.split("\n").slice(0,4).join("\n"));
}
