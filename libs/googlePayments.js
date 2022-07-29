const iap = require('in-app-purchase');
const subscriptions = require('../libs/subscriptions');
const mobilePayments = require('./mobilePayments');
const Bluebird = require('bluebird');

const USERS_BATCH = 10;

let api = {};

api.iapValidate = Bluebird.promisify(iap.validate, {context: iap});

api.processUser = function processUser (habitrpgUsers, user, jobStartDate, nextScheduledCheck) {
  let plan = subscriptions.blocks[user.purchased.plan.planId];
  console.log('Processing google sub for ', user._id);

  if (!plan) {
    throw new Error(`Plan ${user.purchased.plan.planId} does not exists. User \{user._id}`);
  }

  const receipt = user.purchased.plan.additionalData;

  receipt.data = typeof receipt.data === 'string' ? JSON.parse(receipt.data) : receipt.data;

  return api.iapValidate(iap.GOOGLE, user.purchased.plan.additionalData)
    .then((response) => {
      if (iap.isValidated(response)) {
        let purchaseDataList = iap.getPurchaseData(response);
        let subscription = purchaseDataList[0];
        if (subscription.expirationDate < jobStartDate) {
          return mobilePayments.cancelSubscriptionForUser(habitrpgUsers, user, 'android');
        } else {
          return mobilePayments.scheduleNextCheckForUser(habitrpgUsers, user, subscription, nextScheduledCheck);
        }
      } else {
        return mobilePayments.cancelSubscriptionForUser(habitrpgUsers, user, 'android');
      }
    }).catch(err => {
      // Status:410 means that the subsctiption isn't active anymore
      console.log(err.message);
      if (err && err.message === 'Status:410') {
        return mobilePayments.cancelSubscriptionForUser(habitrpgUsers, user, 'android');
      } else {
        throw err;
      }
    }).catch(err => {
      console.log('User:', user._id, 'has errorred');
      console.log('date updated', user.purchased.plan.dateUpdated);
      console.log('date created', user.purchased.plan.dateCreated);
      console.log('error', JSON.stringify(err, null, 4));
      console.log('receipt', JSON.stringify(receipt, null, 4));

      throw err;
    });
};

api.findAffectedUsers = function findAffectedUsers (habitrpgUsers, lastId, jobStartDate, nextScheduledCheck) {
  let query = {
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

  console.log('Run query', query);

  let usersFoundNumber;

  return habitrpgUsers.find(query, {
    sort: {_id: 1},
    limit: USERS_BATCH,
    fields: ['_id', 'apiToken', 'purchased.plan'],
  })
    .then(users => {
      console.log('Google: Found n users', users.length);
      usersFoundNumber = users.length;
      lastId = usersFoundNumber > 0 ? users[usersFoundNumber - 1]._id : null; // the user if of the last found user

      return Promise.all(users.map((user) => {
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
