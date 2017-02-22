const moment = require('moment');
const applePayments = require('../libs/applePayments');
const iap = require('in-app-purchase');
// Defined later
let db;
let queue;
let habitrpgUsers;

function scheduleNextJob () {
  console.log('Scheduling new job');

  return new Promise((resolve, reject) => {
    queue
      .create('applePayments')
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

  console.log('Start fetching subscriptions due with Apple Payments.');

  iap.setup(error => {
    if (error) {
      done(error);
      return;
    }
    applePayments.findAffectedUsers(habitrpgUsers, null, moment.utc(), moment.utc().add({days: 7}))
      .then(scheduleNextJob) // All users have been processed, schedule the next job
      .then(done)
      .catch(err => { // The processing errored, crash the job and log the error
        console.log('Error while sending processing apple payments', err);
        done(err);
      });
  });
}
module.exports = function work (parentQueue, parentDb) {
  // Pass db and queue from parent module
  db = parentDb;
  queue = parentQueue;

  return worker;
};
