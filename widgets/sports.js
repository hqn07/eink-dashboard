// Sports widget via TheSportsDB free API (key '3'). cfg.sports.teamId is
// a numeric ID from thesportsdb.com (e.g. 134860 = LA Lakers). Returns
// the last finished game + the next scheduled game. 1-hour cache.
const { fetchWithTimeout } = require('./_fetch');
const status = require('./_status');

const CACHE_MS = 60 * 60 * 1000;
const cache = new Map(); // teamId → { at, data }

function pickGame(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  const g = arr[0] || {};
  return {
    id: g.idEvent || '',
    league: g.strLeague || '',
    home: g.strHomeTeam || '',
    away: g.strAwayTeam || '',
    homeScore: g.intHomeScore != null ? g.intHomeScore : null,
    awayScore: g.intAwayScore != null ? g.intAwayScore : null,
    dateLocal: g.dateEventLocal || g.dateEvent || '',
    timeLocal: g.strTimeLocal || g.strTime || '',
    status: g.strStatus || g.strPostponed || ''
  };
}

async function fetchSports(teamId) {
  if (!teamId) return null;
  const key = String(teamId);
  const hit = cache.get(key);
  if (hit && (Date.now() - hit.at) < CACHE_MS) { status.cacheHit('sports'); return hit.data; }
  const t0 = Date.now();
  try {
    const lastUrl = `https://www.thesportsdb.com/api/v1/json/3/eventslast.php?id=${encodeURIComponent(teamId)}`;
    const nextUrl = `https://www.thesportsdb.com/api/v1/json/3/eventsnext.php?id=${encodeURIComponent(teamId)}`;
    const teamUrl = `https://www.thesportsdb.com/api/v1/json/3/lookupteam.php?id=${encodeURIComponent(teamId)}`;
    const [lastR, nextR, teamR] = await Promise.all([
      fetchWithTimeout(lastUrl),
      fetchWithTimeout(nextUrl),
      fetchWithTimeout(teamUrl)
    ]);
    const lastJ = lastR.ok ? await lastR.json() : null;
    const nextJ = nextR.ok ? await nextR.json() : null;
    const teamJ = teamR.ok ? await teamR.json() : null;
    const last = pickGame(lastJ && (lastJ.results || lastJ.events));
    const next = pickGame(nextJ && (nextJ.events));
    const teamObj = (teamJ && teamJ.teams && teamJ.teams[0]) || null;
    const data = {
      teamId: key,
      teamName: teamObj ? (teamObj.strTeam || '') : '',
      league:   teamObj ? (teamObj.strLeague || '') : (last && last.league) || (next && next.league) || '',
      last,
      next
    };
    cache.set(key, { at: Date.now(), data });
    status.record('sports', { ok: !!(last || next), ms: Date.now() - t0 });
    return data;
  } catch (e) {
    status.record('sports', { ok: false, ms: Date.now() - t0, err: e.message || String(e) });
    return hit ? hit.data : null;
  }
}

module.exports = { fetchSports };
