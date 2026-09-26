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
