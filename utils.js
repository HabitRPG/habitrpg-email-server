const crypto = require('crypto');
const nconf = require('nconf');

module.exports = {};

const algorithm = 'aes-256-ctr';
const SESSION_SECRET_KEY = nconf.get('SESSION_SECRET_KEY');
const SESSION_SECRET_IV = nconf.get('SESSION_SECRET_IV');

let key = Buffer.from(SESSION_SECRET_KEY, 'hex');
let iv  = Buffer.from(SESSION_SECRET_IV, 'hex');

module.exports.encrypt = function encrypt (text) {
  let cipher = crypto.createCipheriv(algorithm, key, iv);
  let crypted = cipher.update(text, 'utf8', 'hex');
  crypted += cipher.final('hex');
  return crypted;
};
