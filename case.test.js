import assert from "node:assert/strict";
import test from "node:test";
import {
    arrange,
    checkCase,
    history,
    parseReply,
    suspectPrompt,
    tidy,
    VOICES,
    victimLine,
    withVoices,
} from "./case.js";

const suspect = (name, extra = {}) => ({
    name,
    occupation: `${name}'s job`,
    personality: "Speaks slowly.",
    relationship: `${name}'s tie to the victim`,
    gender: "f",
    age: "middle",
    motive: `${name}-motive`,
    true_whereabouts: `${name}-truth`,
    witnessed: `saw nothing odd, ref ${[...name].reduce((h, c) => h + c.charCodeAt(0), 0)}`,
    secret: `${name}-secret`,
    ...extra,
});

const goodCase = () => ({
    title: "Poison at the Pier",
    setting: "A foggy pier. A party ended badly.",
    victim: { name: "Harold Vane", bio: "A shipping magnate." },
    crime: {
        what: "Harold was poisoned.",
        when: "between 9 and 10 pm",
        where: "on the yacht",
        method: "He spiked the brandy.",
    },
    suspects: [
        suspect("Mara Quill"),
        suspect("Ivo Brandt", {
            witnessed: "I saw Mara Quill on the yacht deck at 9:20.",
        }),
        suspect("Dee Osei"),
        suspect("Tobias Rook", { gender: "m" }),
    ],
    culprit: "Mara Quill",
    false_alibi: "I was in the library from 9 to 10 pm.",
    witness: "Ivo Brandt",
    solution: "Mara spiked the brandy; Ivo saw her on the deck.",
});

test("a consistent case is playable", () => {
    assert.equal(checkCase(goodCase()), null);
});

test("inconsistent cases are rejected", () => {
    const cases = [
        [
            "3 suspects",
            (c) => {
                c.suspects.pop();
            },
            /exactly 4/,
        ],
        [
            "duplicate names",
            (c) => {
                c.suspects[3].name = "mara quill";
            },
            /different/,
        ],
        [
            "culprit not a suspect",
            (c) => {
                c.culprit = "Nobody";
            },
            /culprit/,
        ],
        [
            "witness is the culprit",
            (c) => {
                c.witness = "Mara Quill";
            },
            /another suspect/,
        ],
        [
            "witness does not name the culprit",
            (c) => {
                c.suspects[1].witnessed = "I saw a shadow.";
            },
            /does not mention/,
        ],
        [
            "missing solution",
            (c) => {
                c.solution = " ";
            },
            /missing text/,
        ],
        [
            "missing crime detail",
            (c) => {
                delete c.crime.method;
            },
            /crime/,
        ],
        [
            "incomplete suspect",
            (c) => {
                c.suspects[2].secret = "";
            },
            /incomplete/,
        ],
    ];
    for (const [name, mutate, expected] of cases) {
        const c = goodCase();
        mutate(c);
        assert.match(checkCase(c) ?? "", expected, name);
    }
});

test("a suspect is told only their own slice", () => {
    const c = goodCase();
    const innocent = c.suspects[2];
    const p = suspectPrompt(c, innocent);
    assert.match(p, /Dee Osei-truth/);
    assert.match(p, /You are innocent/);
    for (const other of c.suspects.filter((s) => s !== innocent)) {
        for (const field of [
            "true_whereabouts",
            "witnessed",
            "secret",
            "motive",
        ]) {
            assert.ok(
                !p.includes(other[field]),
                `${innocent.name} must not see ${other.name}'s ${field}`,
            );
        }
    }
    assert.ok(
        !p.includes(c.false_alibi),
        "innocents never see the false alibi",
    );
    assert.ok(
        !p.includes(c.solution) && !p.includes(c.crime.method),
        "nor the solution or method",
    );
    assert.ok(!p.includes("Mara Quill"), "nor who the culprit is");
});

test("the culprit is told to keep one alibi and never confess", () => {
    const c = goodCase();
    const p = suspectPrompt(c, c.suspects[0]);
    assert.match(p, /Never confess/);
    assert.ok(p.includes(c.false_alibi));
    assert.ok(p.includes(c.crime.method));
    assert.ok(
        !p.includes("I saw Mara Quill"),
        "the witness's line is not shared",
    );
});

test("voices are distinct and follow gender when possible", () => {
    const { suspects } = withVoices(goodCase());
    assert.equal(new Set(suspects.map((s) => s.voice)).size, 4);
    assert.ok(suspects.every((s) => VOICES.includes(s.voice)));
    assert.match(suspects[3].voice, /^(am|bm)_/);
    assert.match(suspects[0].voice, /^(af|bf)_/);
});

test("replies parse, with a plain-text fallback", () => {
    assert.deepEqual(
        parseReply(
            '{"say":"  I was at home. ","claims":["home at 9","alone","extra"]}',
        ),
        {
            say: "I was at home.",
            claims: ["home at 9", "alone"],
        },
    );
    assert.deepEqual(parseReply('Sure! {"say":"Hi","claims":[]} bye'), {
        say: "Hi",
        claims: [],
    });
    assert.equal(parseReply("just words").say, "just words");
    assert.deepEqual(parseReply("just words").claims, []);
    assert.equal(parseReply("").say, "I have nothing more to say.");
});

test("history keeps only this suspect's recent exchanges", () => {
    const log = [
        { suspect: "A", question: "q1", say: "a1", claims: [] },
        { suspect: "B", question: "q2", say: "a2", claims: ["x"] },
        { suspect: "A", question: "q3", say: "a3", claims: [] },
    ];
    const h = history(log, "A");
    assert.deepEqual(
        h.map((m) => m.role),
        ["user", "assistant", "user", "assistant"],
    );
    assert.equal(h[0].content, "q1");
    assert.equal(history(log, "A", 1)[0].content, "q3");
    assert.deepEqual(history(log, "C"), []);
});

test("arrange: first suspect is the culprit, second the witness, then the order is shuffled", () => {
    const { culprit, witness, ...rest } = goodCase();
    const raw = {
        ...rest,
        suspects: [
            rest.suspects[0],
            rest.suspects[1],
            rest.suspects[2],
            rest.suspects[3],
        ],
    };
    // A rigged rng that reverses the array; culprit and witness must not follow position.
    const arranged = arrange(raw, () => 0);
    assert.equal(arranged.culprit, "Mara Quill");
    assert.equal(arranged.witness, "Ivo Brandt");
    assert.notDeepEqual(
        arranged.suspects.map((s) => s.name),
        raw.suspects.map((s) => s.name),
    );
    assert.deepEqual(
        [...arranged.suspects.map((s) => s.name)].sort(),
        [...raw.suspects.map((s) => s.name)].sort(),
    );
    assert.equal(checkCase(arranged), null);
    assert.equal(arrange({}).culprit, undefined);
});

test("tidy and victimLine clean up model text", () => {
    assert.equal(tidy("  a clerk. . "), "a clerk");
    const c = goodCase();
    assert.equal(victimLine(c), "Harold Vane, A shipping magnate");
    c.victim.bio = "Harold Vane was a shipping magnate.";
    assert.equal(victimLine(c), "Harold Vane was a shipping magnate");
});

test("witnessed lines: only the witness may name the culprit", () => {
    const other = goodCase();
    other.suspects[2].witnessed = "saw Mara Quill leave the deck.";
    assert.match(checkCase(other) ?? "", /only the witness/);
});

test("names match whole words only", () => {
    const c = goodCase();
    c.suspects[1] = suspect("Ivo Brandt", {
        witnessed: "I planned to see Marathon Quilting, not anyone else.",
    });
    assert.match(checkCase(c) ?? "", /does not mention/);
});

test("arrange repairs extra sightings of the culprit instead of rejecting the case", () => {
    const { culprit, witness, ...rest } = goodCase();
    rest.suspects[2].witnessed = "saw Mara Quill leave the deck.";
    rest.suspects[3].witnessed = "heard Mara arguing near the bar.";
    const arranged = arrange(rest);
    assert.equal(checkCase(arranged), null);
    const bystanders = arranged.suspects.filter(
        (s) => ![arranged.culprit, arranged.witness].includes(s.name),
    );
    assert.ok(
        bystanders.every(
            (s) =>
                s.witnessed ===
                "saw nothing unusual about anyone during that time",
        ),
    );
    const wit = arranged.suspects.find((s) => s.name === arranged.witness);
    assert.match(wit.witnessed, /Mara Quill/);
});
