var crypto = require('crypto');
var nconf = require('nconf');

module.exports = {};

var algorithm = 'aes-256-ctr';
module.exports.encrypt = function(text){
  var cipher = crypto.createCipher(algorithm, nconf.get('SESSION_SECRET'));
  var crypted = cipher.update(text,'utf8','hex');
  crypted += cipher.final('hex');
  return crypted;
}
