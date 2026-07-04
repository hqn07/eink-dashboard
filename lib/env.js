// Shared environment-derived flags. Read once at require time (server.js runs
// dotenv.config() before requiring anything, so .env values are already live).
const DEVICE_TOKEN = process.env.DEVICE_TOKEN || '';
const IS_PROD = process.env.NODE_ENV === 'production'
  || !!process.env.RAILWAY_ENVIRONMENT
  || !!process.env.RENDER
  || !!process.env.FLY_APP_NAME;

module.exports = { DEVICE_TOKEN, IS_PROD };
