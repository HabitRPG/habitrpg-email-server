import moment from 'moment';
import { inspect } from 'util';
import { findAffectedUsers } from '../../libs/subscriptionsReminders/expiration.js';

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

  console.log('Start fetching Gift and non-Gift subscriptions due to expire in the next week.');

  findAffectedUsers(habitrpgUsers, null, moment.utc(), queue, baseUrl)
    .then(scheduleNextJob) // All users have been processed, schedule the next job
    .then(done)
    .catch(err => { // The processing errored, crash the job and log the error
      console.log('Error while sending reminders for gift and non-gift subscriptions about to expire', inspect(err, false, null));
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
