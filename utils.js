import { createCipheriv } from 'crypto';
import nconf from 'nconf';

nconf.argv()
  .env()
  .file({ file: './config.json' });

const algorithm = 'aes-256-ctr';
const SESSION_SECRET_KEY = nconf.get('SESSION_SECRET_KEY');
const SESSION_SECRET_IV = nconf.get('SESSION_SECRET_IV');

const key = Buffer.from(SESSION_SECRET_KEY, 'hex');
const iv = Buffer.from(SESSION_SECRET_IV, 'hex');

export function encrypt (text) {
  const cipher = createCipheriv(algorithm, key, iv);
  let crypted = cipher.update(text, 'utf8', 'hex');
  crypted += cipher.final('hex');
  return crypted;
}
