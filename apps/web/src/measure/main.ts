// Safari camera rangefinder for room dimensions. No app install: camera + tilt sensor + math.
import { ceilingHeight, distanceToFloorPoint, ftIn, pitchFromBeta, toInches } from "./rangefinder";

const IN = 0.0254;
const BODY_OFFSET_IN = 10; // the phone sits roughly this far in front of the wall at your back

type Step = 0 | 1 | 2; // 0 length, 1 width, 2 height
const STEPS = [
  { title: "Length", hint: ["Stand with your back against a shorter wall.", "Aim the crosshair where the wall across from you meets the floor, and tap Mark."] },
  { title: "Width", hint: ["Stand with your back against a longer wall.", "Aim the crosshair where the wall across from you meets the floor, and tap Mark."] },
  { title: "Height", hint: ["Stay where you are.", "Aim where that same wall meets the ceiling, then tap Mark."] },
];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const setup = $("setup"), cam = $("cam"), manualScreen = $("manual-screen");
const video = $<HTMLVideoElement>("video");
const live = $("live"), mark = $<HTMLButtonElement>("mark"), sendWrap = $("send-wrap"), status = $("status");

// Phone height choices: 3'6" … 5'9" in 3" steps, default 4'6".
const ph = $<HTMLSelectElement>("ph");
for (let inches = 42; inches <= 69; inches += 3) {
  const o = document.createElement("option");
  o.value = String(inches); o.textContent = ftIn(inches);
  if (inches === 54) o.selected = true;
  ph.appendChild(o);
}
const phoneHeightM = () => Number(ph.value) * IN;

let step: Step = 0;
let pitch: number | null = null; // camera pitch, degrees, + up
const result: { l?: number; w?: number; h?: number; widthDistM?: number } = {};

function render() {
  const done = step > 2;
  const hint = $("step-hint");
  if (!done) { $("step-title").textContent = STEPS[step].title; hint.replaceChildren(...STEPS[step].hint.map((t) => Object.assign(document.createElement("li"), { textContent: t }))); }
  else { $("step-title").textContent = "Room measured"; hint.replaceChildren(Object.assign(document.createElement("li"), { textContent: "Send it to the desktop, or undo to re-measure." })); }
  $("d-l").textContent = result.l ? ftIn(result.l) : "—";
  $("d-w").textContent = result.w ? ftIn(result.w) : "—";
  $("d-h").textContent = result.h ? ftIn(result.h) : "—";
  mark.hidden = done;
  sendWrap.hidden = !done;
  live.hidden = done;
}

function reading(): { inches: number; text: string } | null {
  if (pitch == null) return null;
  if (step < 2) {
    const d = distanceToFloorPoint(phoneHeightM(), pitch);
    if (d == null) return null;
    const inches = toInches(d, BODY_OFFSET_IN);
    return { inches, text: `${ftIn(inches)} away` };
  }
  const h = ceilingHeight(phoneHeightM(), (result.widthDistM ?? 3) , pitch);
  if (h == null) return null;
  const inches = toInches(h);
  return { inches, text: `${ftIn(inches)} ceiling` };
}

function tick() {
  if (step > 2) return;
  const r = reading();
  if (!r) {
    live.textContent = pitch == null ? "Waiting for the tilt sensor…" : step < 2 ? "Tilt down toward the floor line…" : "Tilt up toward the ceiling line…";
    live.classList.add("bad");
    mark.disabled = true;
  } else {
    live.innerHTML = `<b>${r.text}</b> · tilt ${Math.round(pitch!)}°`;
    live.classList.remove("bad");
    mark.disabled = false;
  }
}

mark.addEventListener("click", () => {
  const r = reading();
  if (!r) return;
  if (step === 0) result.l = r.inches;
  else if (step === 1) { result.w = r.inches; result.widthDistM = (r.inches - BODY_OFFSET_IN) * IN; }
  else result.h = r.inches;
  step = (step + 1) as Step;
  render(); tick();
});
$("undo").addEventListener("click", () => {
  if (step === 0) return;
  step = (step - 1) as Step;
  if (step === 0) result.l = undefined; else if (step === 1) result.w = undefined; else result.h = undefined;
  status.textContent = "";
  render(); tick();
});
$("restart").addEventListener("click", () => { step = 0; result.l = result.w = result.h = undefined; status.textContent = ""; render(); tick(); });

async function send(l: number, w: number, h: number, out: HTMLElement) {
  out.textContent = "Sending…";
  try {
    const r = await fetch("/api/measurement", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ w: l, d: w, h }) });
    out.textContent = r.ok ? "Sent. The room on your Mac is building itself." : `Server replied ${r.status}.`;
  } catch {
    out.textContent = "Couldn't reach the Mac. Is the dev server running?";
  }
}
$("send").addEventListener("click", () => send(result.l!, result.w!, result.h!, status));

// ---- sensors ---------------------------------------------------------------
async function startSensors(): Promise<boolean> {
  const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<"granted" | "denied"> };
  try {
    if (typeof DOE.requestPermission === "function") {
      if ((await DOE.requestPermission()) !== "granted") return false;
    }
  } catch { return false; }
  window.addEventListener("deviceorientation", (e) => {
    if (e.beta == null) return;
    pitch = pitchFromBeta(e.beta);
    tick();
  });
  return true;
}

async function startCamera(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    video.srcObject = stream;
    return true;
  } catch { return false; }
}

$("start").addEventListener("click", async () => {
  if (!window.isSecureContext) { alert("Safari needs https for the camera and tilt sensor. Open the https link from the desktop's Measure with my phone button."); return; }
  const sensors = await startSensors();
  if (!sensors) { showManual("Motion sensor access was denied, so here's the manual form."); return; }
  const camera = await startCamera(); // the crosshair still works without a picture; keep going either way
  setup.hidden = true; cam.hidden = false;
  if (!camera) live.textContent = "Camera unavailable; aiming still works.";
  render(); tick();
});

// ---- manual fallback --------------------------------------------------------
function showManual(msg = "") { setup.hidden = true; cam.hidden = true; manualScreen.hidden = false; $("m-status").textContent = msg; }
$("manual").addEventListener("click", () => showManual());
$("m-back").addEventListener("click", () => { manualScreen.hidden = true; setup.hidden = false; });
$("m-send").addEventListener("click", () => {
  const n = (id: string) => Number(($(id) as HTMLInputElement).value || 0);
  const l = n("m-l-ft") * 12 + n("m-l-in"), w = n("m-w-ft") * 12 + n("m-w-in"), h = n("m-h-ft") * 12 + n("m-h-in");
  if (l <= 0 || w <= 0 || h <= 0) { $("m-status").textContent = "Enter all three."; return; }
  send(l, w, h, $("m-status"));
});
