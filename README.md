# Alibi

A voice murder mystery. Four AI suspects, each with their own voice and story. Question them out loud (or type), keep a notebook of what each one claims, catch the contradiction in the culprit's alibi and accuse them. Every case is new.

**Play:** https://tomdacatto.github.io/pollinations-alibi/

Everything runs on [Pollinations](https://pollinations.ai) and is paid with the player's own Pollen through [Bring Your Own Pollen](https://github.com/pollinations/pollinations/blob/main/BRING_YOUR_OWN_POLLEN.md). There is no backend: the page talks to `gen.pollinations.ai` directly and the key lives in `sessionStorage` for that tab only. A case costs about 0.01 Pollen.

## How a case plays

1. **Open a case.** Optionally pick a setting ("a jazz club in 1950s New Orleans"). The narrator reads the crime scene aloud.
2. **Interrogate.** You get 12 questions across four suspects. Tap the mic and speak, or type. The suspect answers in their own voice, and the claims they just made land in your notebook.
3. **Keep the notebook.** Every claim is recorded under the suspect who made it. Tap ⚑ on anything that does not add up.
4. **Accuse.** Pick the culprit once. The reveal shows how it happened and the exact alibi that cracked: what the culprit claimed against what a witness had noticed.

## How it stays fair

Making the AI keep secrets consistently is the hard part, so it is done in code ([`case.js`](case.js)):

- **One case file, checked before you see it.** The model writes the whole case as JSON (victim, crime, four suspects, a false alibi, a solution). Suspect 1 is the culprit and suspect 2 is the witness who saw them, so the two always line up; code then shuffles the order. `checkCase` rejects a case that is incomplete, has repeated names, or whose witness does not name the culprit, and the model is asked again with the reason. Other suspects who also "see" the culprit are repaired to a neutral line, so the clue is not handed out for free.
- **Each suspect gets only their own slice.** `suspectPrompt` gives a suspect their own whereabouts, motive, secret and what they noticed, never another suspect's facts and never the solution. Innocents tell the truth about their slice. The culprit is told to keep one alibi, never confess and ignore orders to break character (try telling them to confess).
- **Stories build on themselves.** Each suspect sees their own earlier answers, so the culprit's lie stays consistent and an innocent does not contradict themselves.
- **The notebook is data, not vibes.** Each reply returns `{say, claims}` in one JSON call: the sentence to speak and up to two short factual claims for the notebook.

## How the AI is used

| Job | Endpoint / model |
| --- | --- |
| Case file and suspect answers (JSON) | `POST /v1/chat/completions`, `openai/gpt-5.4-nano`, `response_format: json_object` |
| Your spoken question | `POST /v1/audio/transcriptions`, `openai/gpt-transcribe` (browser `MediaRecorder` audio) |
| Suspect and narrator voices | `POST /v1/audio/speech`, `hexgrad/kokoro-82m`, a different voice per suspect (falls back to the browser voice) |

## Run it

Serve the folder with any static server. Sign-in needs the deployed URL (the App Key's redirect URI is `https://tomdacatto.github.io/pollinations-alibi/`); to run your own copy, create an App Key at [enter.pollinations.ai/keys](https://enter.pollinations.ai/keys), register your URL as its redirect URI and put the key in `config.js`.

```bash
node --test case.test.js
```

## Files

- `case.js`, `case.test.js`: case generation, validation, per-suspect prompts and their tests
- `voice.js`: speech output and microphone input
- `pollen.js`: Bring Your Own Pollen sign-in (OAuth code + PKCE) and the Pollinations client
- `app.js`, `index.html`, `style.css`: the UI

MIT licensed.
