var specialPushNotificationManager = require('../libs/specialPushNotificationManager');
var pushNotifications = require('../libs/pushNotifications');

var db, queue, notificationBuckets;

var worker = function(job, done) {
  specialPushNotificationManager.run(db,
    queue,
    done,
    pushNotifications,
    job.data.notificationBuckets,
    job.data.timezoneQuery,
    job.data.lastNotificationDate,
    job.data.lastLoginDate);
};

module.exports = function(parentQueue, parentDb) {
  db = parentDb;
  queue = parentQueue;

  return worker;
};
