function validateEnv() {
  const required = ['DISCORD_TOKEN', 'CLIENT_ID', 'DISCORD_CLIENT_SECRET'];
  if (process.env.DB_TYPE !== 'sqlite') {
    required.push('DATABASE_URL');
  }
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Faltan variables de entorno requeridas: ${missing.join(', ')}`);
  }
}

module.exports = { validateEnv };
