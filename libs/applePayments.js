import iap from 'in-app-purchase';
import { blocks } from './subscriptions.js';
import { cancelSubscriptionForUser, scheduleNextCheckForUser } from './mobilePayments.js';

const USERS_BATCH = 10;

const INVALID_RECEIPT_ERROR = 21010;

const api = {};

api.processUser = function processUser (habitrpgUsers, user, jobStartDate, nextScheduledCheck) {
  const plan = blocks[user.purchased.plan.planId];

  if (!plan) {
    return;
  }
  return iap.validate(iap.APPLE, user.purchased.plan.additionalData)
    .then(response => {
      if (iap.isValidated(response)) {
        let purchaseDataList = iap.getPurchaseData(response);
        for (let index in purchaseDataList) {
          let subscription = purchaseDataList[index];
          if (subscription.expirationDate > jobStartDate) {
            return mobilePayments.scheduleNextCheckForUser(habitrpgUsers, user, subscription.expirationDate, nextScheduledCheck);
          }
        }
        return cancelSubscriptionForUser(habitrpgUsers, user, 'ios');
      }
      return false;
    })
    .catch(err => {
      if (err.status === INVALID_RECEIPT_ERROR || (err.validatedData && err.validatedData.is_retryable === false && err.validatedData.status === INVALID_RECEIPT_ERROR)) {
        return cancelSubscriptionForUser(habitrpgUsers, user, 'ios');
      }
      return mobilePayments.scheduleNextCheckForUser(habitrpgUsers, user, expirationDate, nextScheduledCheck);
    });
};

api.findAffectedUsers = function findAffectedUsers (habitrpgUsers, lastId, jobStartDate, nextScheduledCheck) {
  const query = {
    'purchased.plan.paymentMethod': 'Apple',
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
    fields: ['_id', 'auth', 'apiToken', 'purchased.plan'],
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
