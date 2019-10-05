const moment = require('moment');
const stripeGroupsReminders = require('../../libs/subscriptionsReminders/stripeGroups');
const util = require('util');

// Defined later
let db;
let queue;
let baseUrl;
let habitrpgUsers;
let habitrpgGroups;

function scheduleNextJob () {
  console.log('Scheduling new job');

  return new Promise((resolve, reject) => {
    queue
      .create('stripeGroupsReminders')
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
  habitrpgGroups = db.get('groups', { castIds: false });

  console.log('Start fetching group subscriptions due in the next week with Stripe.');

  stripeGroupsReminders.findAffectedGroups(habitrpgGroups, habitrpgUsers, null, moment.utc(), queue, baseUrl)
    .then(scheduleNextJob) // All users have been processed, schedule the next job
    .then(done)
    .catch(err => { // The processing errored, crash the job and log the error
      console.log('Error while sending reminders for Stripe group subscriptions', util.inspect(err, false, null));
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
