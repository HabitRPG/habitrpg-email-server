import moment from 'moment';
import pagedQueryer from '../../libs/pagedQueryer.js';

export default function work (comQueue, paymentName, library, db, baseUrl) {
  const habitrpgGroups = db.get('groups', { castIds: false })
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
    pagedQueryer(habitrpgGroups, job, null, query, group => {
      library.processGroup(habitrpgGroups, habitrpgUsers, group, comQueue, baseUrl, jobStartDate);
    }, ['_id', 'purchased.plan', 'leader', 'name', 'memberCount'])
      .then(() => {
        done();
      })
      .catch(err => {
        done(err);
      });
  }

  return worker;
}
