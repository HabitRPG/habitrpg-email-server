import iap from 'in-app-purchase';
import bluebird from 'bluebird';
import { blocks } from './subscriptions.js';
import { cancelSubscriptionForUser, scheduleNextCheckForUser } from './mobilePayments.js';

const USERS_BATCH = 10;

const api = {};

api.iapValidate = bluebird.promisify(iap.validate, { context: iap });

api.processUser = function processUser (habitrpgUsers, user, jobStartDate, nextScheduledCheck) {
  const plan = blocks[user.purchased.plan.planId];

  if (!plan) {
    throw new Error(`Plan ${user.purchased.plan.planId} does not exist. User ${user._id}`);
  }

  const receipt = user.purchased.plan.additionalData;

  receipt.data = typeof receipt.data === 'string' ? JSON.parse(receipt.data) : receipt.data;

  return api.iapValidate(iap.GOOGLE, user.purchased.plan.additionalData)
    .then(response => {
      if (iap.isValidated(response)) {
        const purchaseDataList = iap.getPurchaseData(response);
        const subscription = purchaseDataList[0];
        if (subscription.expirationDate > jobStartDate) {
          return scheduleNextCheckForUser(habitrpgUsers, user, subscription, nextScheduledCheck);
        }
        return cancelSubscriptionForUser(habitrpgUsers, user, 'android');
      }
      return cancelSubscriptionForUser(habitrpgUsers, user, 'android');
    }).catch(err => {
      // Status:410 means that the subsctiption isn't active anymore
      console.log(err.message);
      if (err && err.message === 'Status:410') {
        return cancelSubscriptionForUser(habitrpgUsers, user, 'android');
      }
      throw err;
    }).catch(err => {
      console.log('User:', user._id, 'has errored');
      console.log('date updated', user.purchased.plan.dateUpdated);
      console.log('date created', user.purchased.plan.dateCreated);
      console.log('error', JSON.stringify(err, null, 4));
      console.log('receipt', JSON.stringify(receipt, null, 4));

      throw err;
    });
};

api.findAffectedUsers = function findAffectedUsers (habitrpgUsers, lastId, jobStartDate, nextScheduledCheck) {
  const query = {
    'purchased.plan.paymentMethod': 'Google',
    'purchased.plan.dateTerminated': null,
    'purchased.plan.nextPaymentProcessing': {
      $lte: jobStartDate.toDate(),
    },
  };

  if (lastId) {
    query._id = {
      $gt: lastId,
    };
  }

  let usersFoundNumber;
  let newLastId;

  return habitrpgUsers.find(query, {
    sort: { _id: 1 },
    limit: USERS_BATCH,
    fields: ['_id', 'apiToken', 'purchased.plan'],
  })
    .then(users => {
      usersFoundNumber = users.length;
      newLastId = usersFoundNumber > 0 ? users[usersFoundNumber - 1]._id : null; // the user if of the last found user

      return Promise.all(users.map(user => api.processUser(habitrpgUsers, user, jobStartDate, nextScheduledCheck)));
    }).then(() => {
      if (usersFoundNumber === USERS_BATCH) {
        return api.findAffectedUsers(habitrpgUsers, newLastId, jobStartDate, nextScheduledCheck);
      }
      return true;
    });
};

export default api;
