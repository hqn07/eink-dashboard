// Error ring buffer. Production errors otherwise only hit stdout, which is
// invisible unless you're tailing Railway logs. Requiring this module wraps
// console.error so every log site pushes into a small in-memory ring that
// /status can surface ("what recently broke"). Lost on restart — fine for an
// at-a-glance signal. Wrapping console.error (vs retrofitting every catch)
// captures all existing + future log sites for free.

const ERR_LOG_MAX = 50;
const errLog = [];
const _origConsoleError = console.error.bind(console);

console.error = (...args) => {
  try {
    const msg = args.map(a =>
      a instanceof Error ? (a.stack || a.message)
      : typeof a === 'string' ? a
      : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()
    ).join(' ');
    errLog.push({ at: Date.now(), msg: msg.slice(0, 400) });
    while (errLog.length > ERR_LOG_MAX) errLog.shift();
  } catch { /* never let logging throw */ }
  _origConsoleError(...args);
};

module.exports = { errLog, ERR_LOG_MAX };
