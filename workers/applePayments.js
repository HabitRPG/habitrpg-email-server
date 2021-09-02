import moment from 'moment';
import { setup } from 'in-app-purchase';
import { inspect } from 'util';
import applePayments from '../libs/applePayments.js';

// Defined later
let db;
let habitrpgUsers;

function worker (job, done) {
  habitrpgUsers = db.get('users', { castIds: false });

  console.log('Start fetching subscriptions due with Apple Payments.');

  setup(error => {
    if (error) {
      done(error);
      return;
    }
    applePayments.findAffectedUsers(habitrpgUsers, null, moment.utc(), moment.utc().add({ days: 7 }))
      .then(() => {
        done();
      })
      .catch(err => { // The processing errored, crash the job and log the error
        console.log('Error while sending processing apple payments', inspect(err, false, null));
        done(err);
      });
  });
}
export default function work (parentQueue, parentDb) {
  // Pass db and queue from parent module
  db = parentDb;

  return worker;
}
