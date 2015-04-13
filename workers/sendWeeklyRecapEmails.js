var nconf = require('nconf'),
    moment = require('moment'),
    utils = require('../utils'),
    _ = require('lodash');

var queue, db, baseUrl, habitrpgUsers; // Defined later

var worker = function(job, done){
  habitrpgUsers = db.get('users');

  var uuid = job.data.uuid;

  habitrpgUsers.findOne({
    _id: uuid,
    'preferences.sleep': false
  }, {
    fields: ['_id', 'auth', 'profile', 'lastCron', 'history', 'habits', 'dailys', 'todos']
  }, function(err, user){

    if(err) return done(err);
    if(!user) return done(new Error('User not found with uuid ' + uuid + ' (or in the inn)'));

    console.log(JSON.stringify(user, null, 2));
    var hl = user.history.exp.length;

    console.log(user.history.exp[hl - 1], user.history.exp[hl - 1])
    done();
  });
}

module.exports = function(parentQueue, parentDb, parentBaseUrl){
  queue = parentQueue; // Pass queue from parent module
  db = parentDb; // Pass db from parent module
  baseUrl = parentBaseUrl; // Pass baseurl from parent module

  return worker;
}
