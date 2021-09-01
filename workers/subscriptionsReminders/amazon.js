import moment from 'moment';
import { inspect } from 'util';
import { findAffectedUsers } from '../../libs/subscriptionsReminders/amazon.js';

// Defined later
let db;
let queue;
let baseUrl;
let habitrpgUsers;

function scheduleNextJob () {
  console.log('Scheduling new job');

  return new Promise((resolve, reject) => {
    queue
      .create('amazonPaymentsReminders')
      .priority('critical')
      .delay(moment().add({ hours: 6 }).toDate() - new Date())
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

  console.log('Start fetching subscriptions due in the next week with Amazon Payments.');

  findAffectedUsers(habitrpgUsers, null, moment.utc(), queue, baseUrl)
    .then(scheduleNextJob) // All users have been processed, schedule the next job
    .then(done)
    .catch(err => { // The processing errored, crash the job and log the error
      console.log('Error while sending reminders for amazon payments subscriptions', inspect(err, false, null));
      done(err);
    });
}

export default function work (parentQueue, parentDb, parentBaseUrl) {
  // Pass db and queue from parent module
  db = parentDb;
  queue = parentQueue;
  baseUrl = parentBaseUrl;

  return worker;
}
