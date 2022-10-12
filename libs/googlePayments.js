const iap = require('in-app-purchase');
const subscriptions = require('../libs/subscriptions');
const mobilePayments = require('./mobilePayments');
const Bluebird = require('bluebird');

const USERS_BATCH = 50;

let api = {};

api.iapValidate = Bluebird.promisify(iap.validate, {context: iap});

api.processUser = function processUser (habitrpgUsers, user, jobStartDate, nextScheduledCheck) {
  let plan = subscriptions.blocks[user.purchased.plan.planId];

  if (!plan) {
    return;
  }

  const receipt = user.purchased.plan.additionalData;

  receipt.data = typeof receipt.data === 'string' ? JSON.parse(receipt.data) : receipt.data;

  return api.iapValidate(iap.GOOGLE, user.purchased.plan.additionalData)
    .then((response) => {
      if (iap.isValidated(response)) {
        let purchaseDataList = iap.getPurchaseData(response);
        let expirationDate;
        for (let i in purchaseDataList) {
          const purchase = purchaseDataList[i];
          if (purchase.autoRenewing === true) {
            expirationDate = purchase.expirationDate;
            break;
          } else if (!expirationDate || Number(purchase.expirationDate) > Number(expirationDate)) {
            expirationDate = subscriptions.expirationDate;
          }
        }
        if (expirationDate < jobStartDate) {
          console.log("CANCELLING SUB", expirationDate);
          return mobilePayments.cancelSubscriptionForUser(habitrpgUsers, user, 'android');
        }
      }
      return mobilePayments.scheduleNextCheckForUser(habitrpgUsers, user, expirationDate, nextScheduledCheck);
    }).catch(err => {
      // Status:410 means that the subsctiption isn't active anymore
      if (err && err.message === 'Status:410') {
        console.log("CANCELLING SUB");
        return mobilePayments.cancelSubscriptionForUser(habitrpgUsers, user, 'android');
      } else {
        return mobilePayments.scheduleNextCheckForUser(habitrpgUsers, user, null, nextScheduledCheck);
      }
    }).catch(err => {
      console.log('User:', user._id, 'has errorred');
      console.log('date updated', user.purchased.plan.dateUpdated);
      console.log('date created', user.purchased.plan.dateCreated);
      console.log('error', JSON.stringify(err, null, 4));
      console.log('receipt', JSON.stringify(receipt, null, 4));

      return mobilePayments.scheduleNextCheckForUser(habitrpgUsers, user, null, nextScheduledCheck);
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
