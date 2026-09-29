// Speaking and listening. Speech uses Pollinations TTS (a different voice per
// suspect) and falls back to the browser voice; listening records the mic and
// sends it to Pollinations speech-to-text.
import { speak, transcribe } from "./pollen.js";

let audio = null;
let turn = 0;

export function stopSpeaking() {
    turn += 1;
    audio?.pause();
    audio = null;
    globalThis.speechSynthesis?.cancel();
}

const play = (url) =>
    new Promise((resolve) => {
        audio = new Audio(url);
        audio.onended = audio.onerror = () => resolve();
        audio.play().catch(resolve);
    });

const browserVoice = (line) =>
    new Promise((resolve) => {
        if (!globalThis.speechSynthesis) return resolve();
        const u = new SpeechSynthesisUtterance(line);
        u.onend = u.onerror = () => resolve();
        globalThis.speechSynthesis.speak(u);
    });

// Resolves when the line ends or is interrupted. Sign-in and budget errors
// surface; anything else falls back to the browser voice.
export async function say(line, voice) {
    if (!line) return;
    stopSpeaking();
    const mine = turn;
    try {
        const url = await speak(line, { voice });
        if (mine === turn) await play(url);
    } catch (e) {
        if (e.status === 401 || e.status === 402) throw e;
        if (mine === turn) await browserVoice(line);
    }
}

// --- microphone ----------------------------------------------------------------

const MIME_TYPES = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg",
];
const MAX_SECONDS = 20;

let recorder = null;

export const isRecording = () => recorder !== null;

// Starts recording. `onDone` gets the transcript ("" if nothing was heard).
export async function startListening(onDone, onError) {
    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
        return onError(
            new Error("The microphone is blocked. Type your question instead."),
        );
    }
    const type = MIME_TYPES.find((t) =>
        globalThis.MediaRecorder?.isTypeSupported(t),
    );
    const chunks = [];
    recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const timeout = setTimeout(stopListening, MAX_SECONDS * 1000);
    recorder.onstop = async () => {
        clearTimeout(timeout);
        for (const track of stream.getTracks()) track.stop();
        const mime = recorder.mimeType || type || "audio/webm";
        recorder = null;
        try {
            const blob = new Blob(chunks, { type: mime });
            onDone(
                blob.size < 1500
                    ? ""
                    : await transcribe(blob, { language: "en" }),
            );
        } catch (e) {
            onError(e);
        }
    };
    recorder.start();
}

export function stopListening() {
    if (recorder?.state === "recording") recorder.stop();
}
