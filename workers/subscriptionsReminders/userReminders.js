import moment from 'moment';
import pagedQueryer from '../../libs/pagedQueryer.js';

export default function work (comQueue, paymentName, library, db, baseUrl) {
  // Pass db and queue from parent module
  const habitrpgUsers = db.get('users', { castIds: false })

  function worker (job, done) {
    const jobStartDate = moment.utc();
    const query = {
        'purchased.plan.paymentMethod': paymentName,
        'purchased.plan.dateTerminated': null,
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
      library.processUser(habitrpgUsers, job, user, comQueue, baseUrl, jobStartDate);
    }, ['_id', 'purchased.plan', 'profile', 'preferences'])
      .then(() => {
        done();
      })
      .catch(err => {
        done(err);
      });
  }

  return worker;
}
