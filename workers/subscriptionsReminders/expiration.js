import moment from 'moment';
import pagedQueryer from '../../libs/pagedQueryer.js';
import { sendEmailReminder } from '../../libs/subscriptionsReminders/expiration.js';

// Defined later
let db;
let queue;
let baseUrl;
let habitrpgUsers;

function worker (job, done) {
  habitrpgUsers = db.get('users', { castIds: false });
  const jobStartDate = moment.utc();
  const query = {
    'purchased.plan.dateTerminated': {
      $gt: moment(jobStartDate.toDate()).add({
        days: 6,
        hours: 12,
      }).toDate(),
      $lt: moment(jobStartDate.toDate()).add({
        days: 7,
        hours: 12,
      }).toDate(),
    },
    // Where lastReminderDate is not recent (25 days to be sure?) or doesn't exist
    $or: [{
      'purchased.plan.lastReminderDate': {
        $lte: moment(jobStartDate.toDate()).subtract(25, 'days').toDate(),
      },
    }, {
      'purchased.plan.lastReminderDate': null,
    }],
  };
  pagedQueryer(habitrpgUsers, job, null, query, user => {
    sendEmailReminder(habitrpgUsers, job, user, queue, baseUrl);
  })
    .then(() => {
      done();
    })
    .catch(err => {
      done(err);
    });
}

export default function work (comQueue, parentDb, parentBaseUrl) {
  // Pass db and queue from parent module
  db = parentDb;
  queue = comQueue;
  baseUrl = parentBaseUrl;

  return worker;
}
