const moment = require('moment');
const giftSubReminders = require('../../libs/subscriptionsReminders/expiration');
const util = require('util');

// Defined later
let db;
let queue;
let baseUrl;
let habitrpgUsers;

function scheduleNextJob () {
  console.log('Scheduling new job');

  return new Promise((resolve, reject) => {
    queue
      .create('expirationReminders')
      .priority('critical')
      .delay(moment().add({hours: 6}).toDate() - new Date()) // schedule another job, 1 hour from now
      .attempts(5)
      .save(err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
  });
}

function worker (job, done) {
  habitrpgUsers = db.get('users', { castIds: false });

  console.log('Start fetching Gift and non-Gift subscriptions due to expire in the next week.');

  giftSubReminders.findAffectedUsers(habitrpgUsers, null, moment.utc(), queue, baseUrl)
    .then(scheduleNextJob) // All users have been processed, schedule the next job
    .then(done)
    .catch(err => { // The processing errored, crash the job and log the error
      console.log('Error while sending reminders for gift and non-gift subscriptions about to expire', util.inspect(err, false, null));
      done(err);
    });
}

module.exports = function work (parentQueue, parentDb, parentBaseUrl) {
  // Pass db and queue from parent module
  db = parentDb;
  queue = parentQueue;
  baseUrl = parentBaseUrl;

  return worker;
};
