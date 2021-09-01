import iap from 'in-app-purchase';
import { blocks } from './subscriptions.js';
import { cancelSubscriptionForUser, scheduleNextCheckForUser } from './mobilePayments.js';

const USERS_BATCH = 10;

const INVALID_RECEIPT_ERROR = 21010;

const api = {};

api.processUser = function processUser (habitrpgUsers, user, jobStartDate, nextScheduledCheck) {
  const plan = blocks[user.purchased.plan.planId];

  // Skip users with a blocked account
  if (user.auth.blocked === true) return false;

  if (!plan) {
    throw new Error(`Plan ${user.purchased.plan.planId} does not exists. User ${user._id}`);
  }
  return iap.validate(iap.APPLE, user.purchased.plan.additionalData)
    .then(response => {
      if (iap.isValidated(response)) {
        const purchaseDataList = iap.getPurchaseData(response);
        for (const index in purchaseDataList) {
          if (Object.prototype.hasOwnProperty.call(purchaseDataList, index)) {
            const subscription = purchaseDataList[index];
            if (subscription.expirationDate > jobStartDate) {
              return scheduleNextCheckForUser(habitrpgUsers, user, subscription, nextScheduledCheck);
            }
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
      console.error(`Error processing subscription for user ${user._id}`);
      throw err;
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
