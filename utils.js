const crypto = require('crypto');
const nconf = require('nconf');

module.exports = {};

const ALGORITHM = 'aes-256-ctr';

module.exports.encrypt = function encrypt (text) {
  let cipher = crypto.createCipher(ALGORITHM, nconf.get('SESSION_SECRET'));
  let crypted = cipher.update(text, 'utf8', 'hex');
  crypted += cipher.final('hex');
  return crypted;
};
