// Bring Your Own Pollen: OAuth code + PKCE sign-in and a small Pollinations
// client. Everything runs in the browser. The user's key stays in
// sessionStorage for this tab only, and every request is billed to them.
import { APP_KEY, BUDGET, EXPIRY_DAYS } from "./config.js";

const ENTER = "https://enter.pollinations.ai";
const GEN = "https://gen.pollinations.ai";
const SESSION = "pollen.session";
const PENDING = "pollen.pending";

export const TEXT_MODEL = "openai/gpt-5.4-nano";

export class PollenError extends Error {
    constructor(message, status = 0) {
        super(message);
        this.status = status;
    }
}

const b64url = (bytes) =>
    btoa(String.fromCharCode(...new Uint8Array(bytes)))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/, "");
const random = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const redirectUri = () => location.origin + location.pathname;

// --- sign-in ---------------------------------------------------------------

export function getSession() {
    try {
        const s = JSON.parse(sessionStorage.getItem(SESSION) || "null");
        if (s && s.expiresAt > Date.now()) return s;
    } catch {}
    sessionStorage.removeItem(SESSION);
    return null;
}

export const signOut = () => sessionStorage.removeItem(SESSION);

export async function signIn() {
    const verifier = random(48);
    const state = random(16);
    sessionStorage.setItem(PENDING, JSON.stringify({ state, verifier }));
    const challenge = b64url(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    );
    location.assign(
        `${ENTER}/authorize?${new URLSearchParams({
            response_type: "code",
            client_id: APP_KEY,
            redirect_uri: redirectUri(),
            scope: "usage",
            budget: String(BUDGET),
            expiry: String(EXPIRY_DAYS),
            state,
            code_challenge: challenge,
            code_challenge_method: "S256",
        })}`,
    );
}

// Call once on page load. Trades the ?code= from the redirect for a key.
export async function completeSignIn() {
    const q = new URLSearchParams(location.search);
    if (!q.has("code") && !q.has("error")) return;
    const pending = JSON.parse(sessionStorage.getItem(PENDING) || "null");
    sessionStorage.removeItem(PENDING);
    history.replaceState(null, "", redirectUri());
    if (q.has("error")) {
        throw new PollenError(q.get("error_description") || "Sign-in was cancelled.");
    }
    if (!pending || pending.state !== q.get("state")) {
        throw new PollenError("Sign-in could not be verified. Please try again.");
    }
    const res = await fetch(`${ENTER}/api/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "authorization_code",
            code: q.get("code"),
            client_id: APP_KEY,
            redirect_uri: redirectUri(),
            code_verifier: pending.verifier,
        }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
        throw new PollenError(data.error_description || "Sign-in failed.", res.status);
    }
    sessionStorage.setItem(
        SESSION,
        JSON.stringify({
            key: data.access_token,
            expiresAt: Date.now() + (data.expires_in ?? 86400) * 1000,
        }),
    );
}

// --- requests --------------------------------------------------------------

async function failure(res) {
    const body = await res.json().catch(() => ({}));
    const detail = body.error?.message || body.message || `Request failed (${res.status})`;
    if (res.status === 401) {
        signOut();
        return new PollenError("Your sign-in expired. Sign in again to continue.", 401);
    }
    if (res.status === 402) {
        return new PollenError(
            "You are out of Pollen. Top up at enter.pollinations.ai, or sign in again with a bigger budget.",
            402,
        );
    }
    if (res.status === 429) {
        return new PollenError("Too many requests. Wait a moment and try again.", 429);
    }
    return new PollenError(detail, res.status);
}

async function gen(path, init = {}) {
    const session = getSession();
    if (!session) throw new PollenError("Sign in with your Pollen to play.", 401);
    const res = await fetch(GEN + path, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${session.key}` },
    });
    if (!res.ok) throw await failure(res);
    return res;
}

export const postJson = (path, body, signal) =>
    gen(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
    });

export const postForm = (path, form, signal) => gen(path, { method: "POST", body: form, signal });

export async function chat(messages, { model = TEXT_MODEL, json = false, temperature, signal } = {}) {
    const res = await postJson(
        "/v1/chat/completions",
        {
            model,
            messages,
            ...(json && { response_format: { type: "json_object" } }),
            ...(temperature !== undefined && { temperature }),
        },
        signal,
    );
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
}

// Models sometimes wrap JSON in fences or prose; take the outermost object.
export function parseJson(text) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end < start) throw new PollenError("The model did not return JSON.");
    return JSON.parse(text.slice(start, end + 1));
}

export async function chatJson(messages, options) {
    return parseJson(await chat(messages, { ...options, json: true }));
}

export async function speak(text, { voice = "bm_george", model = "hexgrad/kokoro-82m", signal } = {}) {
    const res = await postJson(
        "/v1/audio/speech",
        { model, voice, input: text, response_format: "mp3" },
        signal,
    );
    return URL.createObjectURL(await res.blob());
}

export async function transcribe(blob, { model = "openai/gpt-transcribe", language } = {}) {
    const ext = /mp4|m4a/.test(blob.type) ? "m4a" : /ogg/.test(blob.type) ? "ogg" : /mpeg|mp3/.test(blob.type) ? "mp3" : /wav/.test(blob.type) ? "wav" : "webm";
    const form = new FormData();
    form.append("file", new File([blob], `speech.${ext}`, { type: blob.type }));
    form.append("model", model);
    if (language) form.append("language", language);
    const res = await gen("/v1/audio/transcriptions", { method: "POST", body: form });
    return (await res.json()).text ?? "";
}

export async function image(prompt, { model = "black-forest-labs/flux.1-schnell", width = 1024, height = 1024, seed, signal } = {}) {
    const params = new URLSearchParams({ model, width, height });
    if (seed !== undefined) params.set("seed", seed);
    const res = await gen(`/image/${encodeURIComponent(prompt)}?${params}`, { signal });
    return res.blob();
}

// Typed decisions: one request, many questions; every answer is a choice, a
// score or a yes/no probability.
export async function decisions(state, questions, { model, signal } = {}) {
    const res = await postJson("/alpha/decisions", { state, questions, ...(model && { model }) }, signal);
    return res.json();
}

export async function balance() {
    try {
        return (await (await gen("/account/balance")).json()).balance;
    } catch {
        return null;
    }
}
