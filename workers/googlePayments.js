import moment from 'moment';
import { inspect } from 'util';
import { setup } from 'in-app-purchase';
import googlePayments from '../libs/googlePayments.js';

// Defined later
let db;
let queue;
let habitrpgUsers;

function scheduleNextJob () {
  console.log('Scheduling new job');

  return new Promise((resolve, reject) => {
    queue
      .create('googlePayments')
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

  console.log('Start fetching subscriptions due with Google Payments.');

  setup(error => {
    if (error) {
      done(error);
      return;
    }
    googlePayments.findAffectedUsers(habitrpgUsers, null, moment.utc(), moment.utc().add({ days: 7 }))
      .then(scheduleNextJob) // All users have been processed, schedule the next job
      .then(done)
      .catch(err => { // The processing errored, crash the job and log the error
        console.log('Error while sending processing google payments', inspect(err, { depth: null, showHidden: true }));
        console.log(JSON.stringify(err, null, 2));
        done(err);
      });
  });
}
export default function work (parentQueue, parentDb) {
  // Pass db and queue from parent module
  db = parentDb;
  queue = parentQueue;

  return worker;
}
