// Features that work on the phone itself, with no AI and no internet:
//   Light: how bright it is, from the camera.
//   Qibla: which way to turn to face the Kaaba, from GPS + compass. The location never leaves the phone.

// ---------- light ----------

const probe = document.createElement('canvas');
probe.width = 48;
probe.height = 36;
const pctx = probe.getContext('2d', { willReadFrequently: true });

/** Calls onLevel(0…1) about five times a second until stop() is called. */
export function startLight(video, onLevel, demo = false) {
  let t = 0;
  const timer = setInterval(() => {
    let level;
    if (demo || !video.videoWidth) {
      level = 0.5 + 0.45 * Math.sin((t += 0.15)); // pretend light for testing on a laptop
    } else {
      pctx.drawImage(video, 0, 0, probe.width, probe.height);
      const px = pctx.getImageData(0, 0, probe.width, probe.height).data;
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      level = sum / (px.length / 4) / 255;
    }
    onLevel(Math.max(0, Math.min(1, level)));
  }, 200);
  return { stop: () => clearInterval(timer) };
}

export function lightWord(level) {
  if (level < 0.15) return 'dark';
  if (level < 0.4) return 'dim';
  if (level < 0.75) return 'bright';
  return 'veryBright';
}

// ---------- Qibla ----------

const KAABA = { lat: 21.422487, lon: 39.826206 };
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Compass bearing (0 = north, clockwise) from a place to the Kaaba. */
export function qiblaBearing(lat, lon) {
  const φ1 = rad(lat);
  const φ2 = rad(KAABA.lat);
  const Δλ = rad(KAABA.lon - lon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** -180…180: negative = turn left, positive = turn right. */
export const turnBy = (target, heading) => ((target - heading + 540) % 360) - 180;

function position() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('no-location'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(p.coords),
      () => reject(new Error('no-location')),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 }
    );
  });
}

/**
 * Starts Qibla guidance. Must be called straight from a tap (iPhone asks for compass permission).
 * onTurn(turnDegrees) is called on every compass update. Resolves to { stop() }.
 */
export async function startQibla(onTurn, demo = false) {
  // iPhone: compass permission must be requested inside the tap, before any waiting.
  const ask = window.DeviceOrientationEvent?.requestPermission?.();
  if (demo) {
    let h = 0;
    const timer = setInterval(() => onTurn(turnBy(qiblaBearing(24.7136, 46.6753), (h += 9) % 360)), 250);
    return { stop: () => clearInterval(timer) };
  }
  if (ask && (await ask.catch(() => 'denied')) !== 'granted') throw new Error('no-compass');
  const where = await position();
  const target = qiblaBearing(where.latitude, where.longitude);
  const absolute = 'ondeviceorientationabsolute' in window;
  const type = absolute ? 'deviceorientationabsolute' : 'deviceorientation';
  let got = false;
  const onEvent = (e) => {
    let heading = null;
    if (typeof e.webkitCompassHeading === 'number') heading = e.webkitCompassHeading; // iPhone
    else if ((absolute || e.absolute) && typeof e.alpha === 'number') heading = 360 - e.alpha; // Android
    if (heading == null) return;
    heading = (heading + (screen.orientation?.angle || 0)) % 360;
    got = true;
    onTurn(turnBy(target, heading));
  };
  addEventListener(type, onEvent);
  const stop = () => removeEventListener(type, onEvent);
  // No compass readings at all after 3 seconds: this phone cannot do it.
  await new Promise((r) => setTimeout(r, 3000));
  if (!got) {
    stop();
    throw new Error('no-compass');
  }
  return { stop };
}

// ---------- colour (no AI) ----------

/** Average colour of the middle of a picture (where the camera is pointing). */
export function centerColor(canvas) {
  const w = canvas.width;
  const h = canvas.height;
  const size = Math.round(Math.min(w, h) * 0.3);
  const c = pctx.canvas;
  c.width = 24;
  c.height = 24;
  pctx.drawImage(canvas, (w - size) / 2, (h - size) / 2, size, size, 0, 0, 24, 24);
  const px = pctx.getImageData(0, 0, 24, 24).data;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < px.length; i += 4) {
    r += px[i];
    g += px[i + 1];
    b += px[i + 2];
  }
  const n = px.length / 4;
  c.width = 48;
  c.height = 36;
  return [r / n, g / n, b / n].map(Math.round);
}

/** Everyday colour name: { key, shade } where shade is 'dark', 'light' or ''. */
export function nameColor([r, g, b]) {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) {
    if (max === R) h = 60 * (((G - B) / d) % 6);
    else if (max === G) h = 60 * ((B - R) / d + 2);
    else h = 60 * ((R - G) / d + 4);
  }
  h = (h + 360) % 360;
  if (s < 0.14 || d < 0.07) {
    if (l < 0.13) return { key: 'black', shade: '' };
    if (l < 0.35) return { key: 'darkGray', shade: '' };
    if (l < 0.65) return { key: 'gray', shade: '' };
    if (l < 0.87) return { key: 'lightGray', shade: '' };
    return { key: 'white', shade: '' };
  }
  let key;
  if (h < 15 || h >= 345) key = 'red';
  else if (h < 40) key = 'orange';
  else if (h < 66) key = 'yellow';
  else if (h < 165) key = 'green';
  else if (h < 195) key = 'turquoise';
  else if (h < 255) key = 'blue';
  else if (h < 290) key = 'purple';
  else key = 'pink';
  // Dark orange/red is what people call brown; pale orange/yellow is beige.
  if ((key === 'orange' || key === 'red' || key === 'yellow') && l < 0.38 && s < 0.75) return { key: 'brown', shade: l < 0.18 ? 'dark' : '' };
  if ((key === 'orange' || key === 'yellow') && l > 0.72 && s < 0.6) return { key: 'beige', shade: '' };
  const shade = l < 0.25 ? 'dark' : l > 0.75 ? 'light' : '';
  return { key, shade };
}
