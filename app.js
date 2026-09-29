import {
    ask,
    NARRATOR,
    newCase,
    QUESTION_LIMIT,
    tidy,
    victimLine,
} from "./case.js";
import {
    balance,
    completeSignIn,
    getSession,
    signIn,
    signOut,
} from "./pollen.js";
import {
    isRecording,
    say,
    startListening,
    stopListening,
    stopSpeaking,
} from "./voice.js";

const $app = document.getElementById("app");

const esc = (s) =>
    String(s ?? "").replace(
        /[&<>"']/g,
        (c) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[c],
    );

const load = (key, fallback) => {
    try {
        return JSON.parse(localStorage.getItem(`alibi.${key}`)) ?? fallback;
    } catch {
        return fallback;
    }
};
const save = (key, value) => {
    try {
        localStorage.setItem(`alibi.${key}`, JSON.stringify(value));
    } catch {}
};

const state = {
    screen: "landing",
    busy: "",
    error: "",
    pollen: null,
    theme: load("theme", ""),
    voiceOn: load("voiceOn", true),
    case: null,
    log: [],
    notes: {},
    current: 0,
    asked: 0,
    question: "",
    thinking: false,
    listening: false,
    accused: null,
    verdict: null,
    notebookOpen: false,
};

// --- helpers -------------------------------------------------------------------

function fail(e) {
    state.busy = "";
    state.thinking = false;
    state.listening = false;
    state.error = e?.message || "Something went wrong.";
    if (e?.status === 401) state.screen = "landing";
    render();
}

async function run(label, work) {
    state.busy = label;
    state.error = "";
    render();
    try {
        await work();
        state.busy = "";
    } catch (e) {
        return fail(e);
    }
    render();
}

async function refreshPollen() {
    state.pollen = await balance();
    const chip = document.getElementById("pollen");
    if (chip && state.pollen != null) {
        chip.textContent = `${state.pollen.toFixed(2)} Pollen`;
        chip.hidden = false;
    }
}

const suspect = () => state.case.suspects[state.current];
const speakAloud = (line, voice) => {
    if (state.voiceOn) say(line, voice).catch(fail);
};
const flaggedCount = () =>
    Object.values(state.notes)
        .flat()
        .filter((n) => n.flag).length;

// --- screens -------------------------------------------------------------------

function header() {
    const signedIn = !!getSession();
    return `<header>
        <h1>Alibi</h1>
        <div class="right">
            ${signedIn ? `<span class="chip" id="pollen" title="Your remaining Pollen budget" ${state.pollen == null ? "hidden" : ""}>${state.pollen == null ? "" : `${state.pollen.toFixed(2)} Pollen`}</span>` : ""}
            ${signedIn ? `<button class="link" data-act="signout">Sign out</button>` : ""}
        </div>
    </header>`;
}

const screens = {
    landing: () => `<section class="hero">
        <p class="kicker">A voice murder mystery</p>
        <h2>Four suspects. One lie. Ask them out loud.</h2>
        <p>Every case is new. Each suspect has their own voice and their own story, and only one of them is lying about where they were. Question them by voice (or type), keep a notebook of what each one claims, and catch the contradiction before you run out of questions.</p>
        <p class="fine">The suspects run on Pollinations and are paid with <b>your own Pollen</b>. A case costs about a hundredth of a Pollen. You choose the budget when you sign in.</p>
        <button class="btn primary big" data-act="signin">Sign in with Pollen</button>
    </section>`,

    start: () => `<section>
        <h2>Open a new case</h2>
        <label>Setting <span class="fine">(optional; blank means surprise me)</span>
            <input id="theme" value="${esc(state.theme)}" placeholder="a Victorian seaside hotel, a space station, a jazz club…" maxlength="60">
        </label>
        <label class="check"><input type="checkbox" id="voiceOn" ${state.voiceOn ? "checked" : ""}> Suspects speak their answers aloud</label>
        <p class="fine">You get ${QUESTION_LIMIT} questions. Use them wisely.</p>
        <button class="btn primary big" data-act="newcase">Open the case file</button>
    </section>`,

    briefing() {
        const c = state.case;
        return `<section>
            <p class="kicker">Case file</p>
            <h2>${esc(c.title)}</h2>
            <div class="paper"><p>${esc(c.setting)}</p>
                <p><b>Victim:</b> ${esc(victimLine(c))}.</p>
                <p><b>What happened:</b> ${esc(c.crime.what)} <b>When:</b> ${esc(c.crime.when)}. <b>Where:</b> ${esc(c.crime.where)}.</p>
                <button class="link" data-act="skip">Skip narration</button></div>
            <h3>Suspects</h3>
            <ul class="suspects">${c.suspects.map((s) => `<li><b>${esc(s.name)}</b><span>${esc(tidy(s.occupation))}. ${esc(tidy(s.relationship))}.</span></li>`).join("")}</ul>
            <button class="btn primary big" data-act="begin">Start the interrogation</button>
        </section>`;
    },

    interrogate() {
        const c = state.case;
        const s = suspect();
        const left = QUESTION_LIMIT - state.asked;
        const tabs = c.suspects
            .map(
                (x, i) =>
                    `<button class="tab ${i === state.current ? "on" : ""}" data-act="tab" data-i="${i}"><b>${esc(x.name.split(" ")[0])}</b><span>${esc(x.occupation)}</span></button>`,
            )
            .join("");
        const bubbles = state.log
            .map((e, i) => ({ e, i }))
            .filter(({ e }) => e.suspect === s.name)
            .map(
                ({ e, i }) =>
                    `<div class="msg q">${esc(e.question)}</div>${
                        e.pending
                            ? ""
                            : `<div class="msg a"><span class="who">${esc(e.suspect)}</span>${esc(e.say)}<button class="link" data-act="replay" data-i="${i}" aria-label="Replay answer">🔊</button></div>`
                    }`,
            )
            .join("");
        const empty =
            bubbles || state.thinking
                ? ""
                : `<p class="fine center">Ask ${esc(s.name.split(" ")[0])} anything: where they were, who they saw, what they thought of ${esc(c.victim.name)}.</p>`;
        const notes = c.suspects
            .map((x) => {
                const list = state.notes[x.name] ?? [];
                return `<div class="note"><h4>${esc(x.name)}</h4>${
                    list.length
                        ? `<ul>${list.map((n, i) => `<li class="${n.flag ? "flag" : ""}"><button class="flagbtn" data-act="flag" data-s="${esc(x.name)}" data-i="${i}" aria-pressed="${n.flag}" title="Mark as suspicious">⚑</button>${esc(n.text)}</li>`).join("")}</ul>`
                        : `<p class="fine">Nothing yet.</p>`
                }</div>`;
            })
            .join("");
        return `<section class="interrogate">
            <div class="bar"><span>Questions left <b>${left}</b></span><button class="btn ghost small" data-act="accuse">Make an accusation</button></div>
            <div class="tabs">${tabs}</div>
            <p class="fine who-line">${esc(s.name)}, ${esc(tidy(s.occupation))}. ${esc(tidy(s.relationship))}.</p>
            <div class="chat" id="chat">${empty}${bubbles}${state.thinking ? `<div class="msg a thinking"><span class="who">${esc(s.name)}</span>…</div>` : ""}</div>
            <form id="ask" autocomplete="off">
                <button type="button" class="mic ${state.listening ? "on" : ""}" data-act="mic" aria-label="${state.listening ? "Stop recording" : "Ask by voice"}" ${left <= 0 || state.thinking ? "disabled" : ""}>${state.listening ? "■" : "🎤"}</button>
                <input id="q" value="${esc(state.question)}" placeholder="${left <= 0 ? "No questions left. Time to accuse." : state.listening ? "Listening… tap ■ when done" : "Ask a question…"}" maxlength="300" ${left <= 0 || state.thinking ? "disabled" : ""}>
                <button class="btn primary" ${left <= 0 || state.thinking ? "disabled" : ""}>Ask</button>
            </form>
            <details class="notebook" ${state.notebookOpen ? "open" : ""}><summary>Notebook <span class="chip">${flaggedCount()} flagged</span></summary>
                <p class="fine">Claims are recorded as suspects make them. Tap ⚑ on anything that does not add up.</p>${notes}</details>
        </section>`;
    },

    accuse: () => `<section>
        <h2>Who did it?</h2>
        <p class="fine">You asked ${state.asked} of ${QUESTION_LIMIT} questions and flagged ${flaggedCount()} claims. You only get one accusation.</p>
        <div class="grid">${state.case.suspects.map((s) => `<button class="btn choice ${state.accused === s.name ? "on" : ""}" data-act="pick" data-name="${esc(s.name)}"><b>${esc(s.name)}</b><br><span class="fine">${esc(s.occupation)}</span></button>`).join("")}</div>
        <button class="btn primary big" data-act="confirm" ${state.accused ? "" : "disabled"}>${state.accused ? `Accuse ${esc(state.accused)}` : "Pick a suspect"}</button>
        <button class="link" data-act="back">Back to the interrogation</button>
    </section>`,

    reveal() {
        const c = state.case;
        const culprit = c.suspects.find((s) => s.name === c.culprit);
        const witness = c.suspects.find((s) => s.name === c.witness);
        const flagged = (state.notes[c.culprit] ?? []).filter(
            (n) => n.flag,
        ).length;
        return `<section>
            <p class="kicker">${state.verdict ? "Case closed" : "Wrong person"}</p>
            <h2>${state.verdict ? `You caught ${esc(c.culprit)}.` : `It was ${esc(c.culprit)}, not ${esc(state.accused)}.`}</h2>
            <div class="paper"><p>${esc(c.solution)}</p><button class="link" data-act="skip">Skip narration</button></div>
            <div class="crack"><h3>The alibi that cracked</h3>
                <p><b>${esc(culprit.name)} claimed:</b> ${esc(c.false_alibi)}</p>
                <p><b>${esc(witness.name)} had noticed:</b> ${esc(witness.witnessed)}</p></div>
            <p class="fine">Questions used: ${state.asked} of ${QUESTION_LIMIT}. Claims of ${esc(culprit.name.split(" ")[0])} you flagged: ${flagged}.</p>
            <button class="btn primary big" data-act="again">Open a new case</button>
        </section>`;
    },
};

function render() {
    const focusedInput = document.activeElement?.id === "q";
    const body = state.busy
        ? `<section class="center"><div class="spinner"></div><h2>${esc(state.busy)}</h2></section>`
        : (screens[state.screen] ?? screens.landing)();
    $app.innerHTML = `${header()}${state.error ? `<div class="error" role="alert">${esc(state.error)}</div>` : ""}${body}`;
    const chat = document.getElementById("chat");
    if (chat) chat.scrollTop = chat.scrollHeight;
    if (focusedInput && !state.listening) document.getElementById("q")?.focus();
}

// --- flow ----------------------------------------------------------------------

function openCase() {
    stopSpeaking();
    run("Opening a new case file…", async () => {
        const c = await newCase({ theme: state.theme });
        state.case = c;
        state.log = [];
        state.notes = Object.fromEntries(c.suspects.map((s) => [s.name, []]));
        state.current = 0;
        state.asked = 0;
        state.question = "";
        state.accused = null;
        state.verdict = null;
        state.screen = "briefing";
        speakAloud(
            `${c.title}. ${c.setting} ${victimLine(c)}. ${c.crime.what}`,
            NARRATOR,
        );
        refreshPollen();
    });
}

async function send(text) {
    const question = text.trim();
    if (!question || state.thinking || state.asked >= QUESTION_LIMIT) return;
    const s = suspect();
    stopSpeaking();
    state.thinking = true;
    state.error = "";
    state.log.push({
        suspect: s.name,
        question,
        say: "",
        claims: [],
        pending: true,
    });
    state.question = "";
    render();
    const pending = state.log.at(-1);
    try {
        const reply = await ask(
            state.case,
            s,
            state.log.filter((e) => !e.pending),
            question,
        );
        Object.assign(pending, reply, { pending: false });
        state.asked += 1;
        for (const claim of reply.claims)
            state.notes[s.name].push({ text: claim, flag: false });
        state.thinking = false;
        render();
        speakAloud(reply.say, s.voice);
        refreshPollen();
    } catch (e) {
        state.log.pop();
        state.question = question;
        fail(e);
    }
}

function toggleMic() {
    if (isRecording()) return stopListening();
    stopSpeaking();
    state.listening = true;
    state.error = "";
    render();
    startListening(
        (text) => {
            state.listening = false;
            if (!text.trim()) {
                state.error =
                    "I could not hear that. Try again or type your question.";
                return render();
            }
            state.question = text;
            render();
            send(text);
        },
        (e) => fail(e),
    );
}

// --- events --------------------------------------------------------------------

const actions = {
    signin: () => signIn().catch(fail),
    signout() {
        signOut();
        stopSpeaking();
        state.screen = "landing";
        state.pollen = null;
        render();
    },
    newcase: openCase,
    skip: () => stopSpeaking(),
    begin() {
        stopSpeaking();
        state.screen = "interrogate";
        render();
    },
    tab({ i }) {
        state.current = Number(i);
        render();
    },
    mic: toggleMic,
    replay({ i }) {
        const entry = state.log[Number(i)];
        const s = state.case.suspects.find((x) => x.name === entry.suspect);
        say(entry.say, s.voice).catch(fail);
    },
    flag({ s, i }) {
        const note = state.notes[s][Number(i)];
        note.flag = !note.flag;
        state.notebookOpen = true;
        render();
    },
    accuse() {
        stopSpeaking();
        state.screen = "accuse";
        render();
    },
    back() {
        state.screen = "interrogate";
        render();
    },
    pick({ name }) {
        state.accused = name;
        render();
    },
    confirm() {
        state.verdict = state.accused === state.case.culprit;
        state.screen = "reveal";
        render();
        speakAloud(
            `${state.verdict ? "Case closed." : `Wrong. It was ${state.case.culprit}.`} ${state.case.solution}`,
            NARRATOR,
        );
    },
    again() {
        stopSpeaking();
        state.screen = "start";
        render();
    },
};

$app.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (el && !el.disabled) actions[el.dataset.act]?.(el.dataset);
});

$app.addEventListener("submit", (e) => {
    e.preventDefault();
    send(document.getElementById("q").value);
});

$app.addEventListener("input", (e) => {
    if (e.target.id === "q") state.question = e.target.value;
    if (e.target.id === "theme") {
        state.theme = e.target.value;
        save("theme", state.theme);
    }
});

$app.addEventListener("change", (e) => {
    if (e.target.id === "voiceOn") {
        state.voiceOn = e.target.checked;
        save("voiceOn", state.voiceOn);
        if (!state.voiceOn) stopSpeaking();
    }
});

$app.addEventListener(
    "toggle",
    (e) => {
        if (e.target.classList?.contains("notebook"))
            state.notebookOpen = e.target.open;
    },
    true,
);

(async () => {
    try {
        await completeSignIn();
    } catch (e) {
        state.error = e.message;
    }
    if (getSession()) {
        state.screen = "start";
        refreshPollen();
    }
    render();
})();
