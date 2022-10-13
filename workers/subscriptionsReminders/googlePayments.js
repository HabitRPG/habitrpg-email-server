import moment from 'moment';
import { inspect } from 'util';
import { findAffectedUsers } from '../../libs/subscriptionsReminders/google.js';

// Defined later
let db;
let queue;
let baseUrl;
let habitrpgUsers;

function worker (job, done) {
  habitrpgUsers = db.get('users', { castIds: false });

  findAffectedUsers(habitrpgUsers, null, moment.utc(), queue, baseUrl)
    .then(() => {
      done();
    })
    .catch(err => { // The processing errored, crash the job and log the error
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
