function validateEnv() {
  const required = ['DISCORD_TOKEN', 'CLIENT_ID', 'DISCORD_CLIENT_SECRET'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    const msg = `Faltan variables de entorno requeridas: ${missing.join(', ')}`;
    if (process.env.NODE_ENV === 'production') {
      throw new Error(msg);
    } else {
      console.warn('[Env] ' + msg + ' - continuing in development mode.');
    }
  }
}

module.exports = { validateEnv };
