import moment from 'moment';
import { inspect } from 'util';
import { setup } from 'in-app-purchase';
import googlePayments from '../libs/googlePayments.js';

// Defined later
let db;
let habitrpgUsers;

function worker (job, done) {
  habitrpgUsers = db.get('users', { castIds: false });

  setup(error => {
    if (error) {
      done(error);
      return;
    }
    googlePayments.findAffectedUsers(habitrpgUsers, job,  null, moment.utc(), moment.utc().add({ days: 7 }))
      .then(() => {
        done();
      })
      .catch(err => { // The processing errored, crash the job and log the error
        done(err);
      });
  });
}
export default function work (parentQueue, parentDb) {
  // Pass db and queue from parent module
  db = parentDb;

  return worker;
}
