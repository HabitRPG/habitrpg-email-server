import moment from 'moment';
import { inspect } from 'util';
import { findAffectedGroups } from '../../libs/subscriptionsReminders/stripeGroups.js';

// Defined later
let db;
let queue;
let baseUrl;
let habitrpgUsers;
let habitrpgGroups;

function worker (job, done) {
  habitrpgUsers = db.get('users', { castIds: false });
  habitrpgGroups = db.get('groups', { castIds: false });

  findAffectedGroups(habitrpgGroups, habitrpgUsers, null, moment.utc(), queue, baseUrl)
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
