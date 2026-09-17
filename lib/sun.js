// Local sunrise/sunset from latitude/longitude. No network, no async, no cache.
//
// The `sun` WIDGET fetches these from Open-Meteo, and this deliberately does
// not reuse that: a refresh-cadence decision must not depend on an upstream
// being reachable, on a widget being on screen, or on a promise. A wrong answer
// here means the panel sleeps when it should not, so it is computed from first
// principles and tested against published times.
//
// NOAA sunrise equation (the form on Wikipedia's "Sunrise equation"). Accurate
// to a few minutes, which is far inside the ±60 min offsets the caller applies.
// Verified against timeanddate.com for London, New York, Gainesville and Tokyo
// — see test/endpoints.test.mjs. Longitude is EAST-POSITIVE; the sign of the
// `lon / 360` term is the thing most implementations get backwards, and getting
// it wrong is silently correct near Greenwich and wildly wrong elsewhere.
const RAD = Math.PI / 180;
const J2000 = 2451545.0;
const MS_PER_DAY = 86400000;
// Standard sunrise/sunset: the sun's upper limb at the horizon, allowing for
// refraction. Not civil twilight (-6°) — the panel is unreadable well before
// the sky is fully dark, and "can I read it" is the question being asked.
const HORIZON_DEG = -0.833;

// Rise/set for the day containing `atMs`, as epoch ms.
// -> { rise, set } | null when the sun never rises or never sets (polar).
function sunTimes(atMs, lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const jDate = atMs / MS_PER_DAY + 2440587.5;
  const n = Math.round(jDate - J2000 + 0.0008);
  const jStar = n - lon / 360;                       // east-positive longitude

  const M = (357.5291 + 0.98560028 * jStar) % 360;   // solar mean anomaly
  const C = 1.9148 * Math.sin(M * RAD)               // equation of the centre
          + 0.0200 * Math.sin(2 * M * RAD)
          + 0.0003 * Math.sin(3 * M * RAD);
  const lambda = (M + C + 180 + 102.9372) % 360;     // ecliptic longitude
  const jTransit = J2000 + jStar
                 + 0.0053 * Math.sin(M * RAD)
                 - 0.0069 * Math.sin(2 * lambda * RAD);

  const sinDec = Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosOmega = (Math.sin(HORIZON_DEG * RAD) - Math.sin(lat * RAD) * sinDec)
                 / (Math.cos(lat * RAD) * cosDec);
  // |cos| > 1 has no solution: midnight sun or polar night.
  if (!(cosOmega >= -1 && cosOmega <= 1)) return null;

  const omega = Math.acos(cosOmega) / RAD;
  const toMs = (j) => (j - 2440587.5) * MS_PER_DAY;
  return { rise: toMs(jTransit - omega / 360), set: toMs(jTransit + omega / 360) };
}

// The night that `atMs` falls inside, as epoch ms, or null if it is daytime.
//
// Built from sunset(day) -> sunrise(day+1) across a three-day span rather than
// from "today" alone, because a night straddles midnight and because the UTC
// day boundary is not the local one — at Tokyo's longitude "today" in UTC is
// the wrong day for half the clock. Checking -1/0/+1 makes longitude irrelevant.
function currentNight(atMs, lat, lon) {
  for (let d = -1; d <= 1; d++) {
    const a = sunTimes(atMs + d * MS_PER_DAY, lat, lon);
    const b = sunTimes(atMs + (d + 1) * MS_PER_DAY, lat, lon);
    if (!a || !b) continue;                       // polar: no night to bound
    if (atMs >= a.set && atMs < b.rise) {
      return { start: a.set, end: b.rise };
    }
  }
  return null;
}

module.exports = { sunTimes, currentNight, HORIZON_DEG };
