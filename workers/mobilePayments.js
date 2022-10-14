import moment from 'moment';
import { setup } from 'in-app-purchase';
import pagedQueryer from '../libs/pagedQueryer.js';

export default function work (paymentName, library, parentDb) {
  const habitrpgUsers = parentDb.get('users', { castIds: false });

  return function worker (job, done) {
    setup(error => {
      if (error) {
        done(error);
        return;
      }
      const jobStartDate = moment.utc();
      const nextScheduledCheck = moment.utc().add({ days: 7 });
      const query = {
        'purchased.plan.paymentMethod': paymentName,
        'purchased.plan.dateTerminated': null,
        'purchased.plan.nextPaymentProcessing': {
          $lte: jobStartDate.toDate(),
        },
      };
      pagedQueryer(habitrpgUsers, job, null, query, user => {
        library.processUser(habitrpgUsers, job, user, jobStartDate, nextScheduledCheck);
      })
        .then(() => {
          done();
        })
        .catch(err => {
          done(err);
        });
    });
  }
}
