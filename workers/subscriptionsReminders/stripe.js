import moment from 'moment';
import { inspect } from 'util';
import { findAffectedUsers } from '../../libs/subscriptionsReminders/stripe.js';

// Defined later
let db;
let queue;
let baseUrl;
let habitrpgUsers;

function worker (job, done) {
  habitrpgUsers = db.get('users', { castIds: false });

  console.log('Start fetching subscriptions due in the next week with Stripe.');

  findAffectedUsers(habitrpgUsers, null, moment.utc(), queue, baseUrl)
    .then(() => {
      done();
    })
    .catch(err => { // The processing errored, crash the job and log the error
      console.log('Error while sending reminders for Stripe subscriptions', inspect(err, false, null));
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
