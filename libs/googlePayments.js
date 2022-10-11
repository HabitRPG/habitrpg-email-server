const iap = require('in-app-purchase');
const subscriptions = require('../libs/subscriptions');
const mobilePayments = require('./mobilePayments');
const Bluebird = require('bluebird');

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
          return mobilePayments.cancelSubscriptionForUser(habitrpgUsers, user, 'android');
        } else {
          return mobilePayments.scheduleNextCheckForUser(habitrpgUsers, user, expirationDate, nextScheduledCheck);
        }
      } else {
        return mobilePayments.cancelSubscriptionForUser(habitrpgUsers, user, 'android');
      }
      return cancelSubscriptionForUser(habitrpgUsers, user, 'android');
    }).catch(err => {
      // Status:410 means that the subsctiption isn't active anymore
      console.log(err.message);
      if (err && err.message === 'Status:410') {
        return mobilePayments.cancelSubscriptionForUser(habitrpgUsers, user, 'android');
      } else {
        throw err;
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
