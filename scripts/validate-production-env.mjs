const required = [
  'POSTGRES_PASSWORD',
  'NEOCONTRACT_DEFAULT_TENANT',
  'FANASA_SSO_ISSUER',
  'FANASA_SSO_CLIENT_ID',
  'FANASA_SSO_CLIENT_SECRET',
  'FANASA_SSO_REDIRECT_URL',
  'FANASA_SSO_COOKIE_SECRET'
];

const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  console.error(`Missing production configuration: ${missing.join(', ')}`);
  process.exit(1);
}

const urlFields = ['FANASA_SSO_ISSUER', 'FANASA_SSO_REDIRECT_URL'];
for (const name of urlFields) {
  try {
    const url = new URL(process.env[name]);
    if (url.protocol !== 'https:') throw new Error('HTTPS is required');
  } catch (error) {
    console.error(`${name} must be a valid HTTPS URL (${error.message})`);
    process.exit(1);
  }
}

if (process.env.FANASA_SSO_ISSUER.includes('sso.invalid') || process.env.FANASA_SSO_REDIRECT_URL.includes('contracts.invalid')) {
  console.error('Placeholder SSO host detected; configure the real Fanasa issuer and redirect URL first.');
  process.exit(1);
}

if (process.env.FANASA_SSO_COOKIE_SECRET.length < 32) {
  console.error('FANASA_SSO_COOKIE_SECRET must be at least 32 characters.');
  process.exit(1);
}

console.log('Production configuration is complete; secrets were not printed.');
