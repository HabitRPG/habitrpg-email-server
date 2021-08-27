const nconf = require('nconf');
const iap = require('in-app-purchase');
const subscriptions = require('../libs/subscriptions');
const mobilePayments = require('./mobilePayments');

const USERS_BATCH = 10;
const BASE_URL = nconf.get('BASE_URL');

const INVALID_RECEIPT_ERROR = 21010;

let api = {};

api.processUser = function processUser (habitrpgUsers, user, jobStartDate, nextScheduledCheck) {
  let plan = subscriptions.blocks[user.purchased.plan.planId];

  // Skip users with a blocked account
  if (user.auth.blocked === true) return;

  if (!plan) {
    throw new Error(`Plan ${user.purchased.plan.planId} does not exists. User \{user._id}`);
  }
  return iap.validate(iap.APPLE, user.purchased.plan.additionalData)
    .then((response) => {
      if (iap.isValidated(response)) {
        let purchaseDataList = iap.getPurchaseData(response);
        for (let index in purchaseDataList) {
          let subscription = purchaseDataList[index];
          if (subscription.expirationDate > jobStartDate) {
            return mobilePayments.scheduleNextCheckForUser(habitrpgUsers, user, subscription, nextScheduledCheck);
          }
        }
        return mobilePayments.cancelSubscriptionForUser(habitrpgUsers, user, "ios");
      }
    })
    .catch(err => {
      if (err.status === INVALID_RECEIPT_ERROR ||  (err.validatedData && err.validatedData.is_retryable === false && err.validatedData.status === INVALID_RECEIPT_ERROR)) {
        return mobilePayments.cancelSubscriptionForUser(habitrpgUsers, user, "ios");
      } else {
        console.error(`Error processing subscription for user ${user._id}`);
        throw err;
      }
    });
};

api.findAffectedUsers = function findAffectedUsers (habitrpgUsers, lastId, jobStartDate, nextScheduledCheck) {
  let query = {
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

  console.log('Run query', query);

  let usersFoundNumber;

  return habitrpgUsers.find(query, {
    sort: {_id: 1},
    limit: USERS_BATCH,
    fields: ['_id', 'auth', 'apiToken', 'purchased.plan'],
  })
    .then(users => {
      console.log('Apple: Found n users', users.length);
      usersFoundNumber = users.length;
      lastId = usersFoundNumber > 0 ? users[usersFoundNumber - 1]._id : null; // the user if of the last found user

      return Promise.all(users.map(user => {
        return api.processUser(habitrpgUsers, user, jobStartDate, nextScheduledCheck);
      }));
    }).then(() => {
      if (usersFoundNumber === USERS_BATCH) {
        return api.findAffectedUsers(habitrpgUsers, lastId, jobStartDate, nextScheduledCheck);
      } else {
        return;
      }
    });
};

module.exports = api;
