import { run } from '../libs/specialPushNotificationManager.js';
import { sendNotification } from '../libs/pushNotifications.js';

var db, queue, notificationBuckets;

var worker = function(job, done) {
  run(db,
    queue,
    done,
    sendNotification,
    job.data.notificationBuckets,
    job.data.timezoneQuery,
    job.data.lastNotificationDate,
    job.data.lastLoginDate,
    job.data.testUserIDs,
    job.data.dryRun);
};

export default function(parentQueue, parentDb) {
  db = parentDb;
  queue = parentQueue;

  return worker;
};
