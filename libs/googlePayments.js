const nconf = require('nconf');
const iap = require('in-app-purchase');
const request = require('request');
const USERS_BATCH = 10;
const BASE_URL = nconf.get('BASE_URL');
const subscriptions = require('../libs/subscriptions');

function cancelSubscriptionForUser (user) {
  return new Promise((resolve, reject) => {
    request({
      url: `${BASE_URL}/iap/android/subscribe/cancel`,
      method: 'GET',
      qs: {
        noRedirect: 'true',
        _id: user._id,
        apiToken: user.apiToken,
      },
    }, (habitError, habitResponse, body) => {
      if (!habitError && habitResponse.statusCode === 200) {
        return resolve();
      }

      reject(habitError || body); // if there's an error or response.statucCode !== 200
    });
  });
}

function scheduleNextCheckForUser (habitrpgUsers, user, subscription, nextScheduledCheck) {
  return new Promise((resolve, reject) => {
    if (subscription.expirationDate < nextScheduledCheck) {
      nextScheduledCheck = subscription.expirationDate;
    }
    habitrpgUsers.update(
      {
        _id: user._id,
      },
      {
        $set: {
          'purchased.plan.nextPaymentProcessing': nextScheduledCheck,
          'purchased.plan.nextBillingDate': subscription.expirationDate,
        },
      }, e => {
        if (e) return reject(e);

        return resolve();
      });
  });
}

function processUser (habitrpgUsers, user, jobStartDate, nextScheduledCheck) {
  let plan = subscriptions.blocks[user.purchased.plan.planId];

  if (!plan) {
    throw new Error(`Plan ${user.purchased.plan.planId} does not exists. User \{user._id}`);
  }
  return new Promise((resolve, reject) => {
    iap.validate(iap.GOOGLE, user.purchased.plan.additionalData, (error, response) => {
      if (error) {
        return reject(error);
      }
      if (iap.isValidated(response)) {
        let purchaseDataList = iap.getPurchaseData(response);
        let subscription = purchaseDataList[0];
        if (subscription.expirationDate < jobStartDate) {
          return cancelSubscriptionForUser(user);
        } else {
          return scheduleNextCheckForUser(habitrpgUsers, user, subscription, nextScheduledCheck);
        }
      }
    });
  });
}

function findAffectedUsers (habitrpgUsers, lastId, jobStartDate, nextScheduledCheck) {
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

      return Promise.all(users.map(user => {
        return processUser(habitrpgUsers, user, jobStartDate, nextScheduledCheck);
      }));
    }).then(() => {
      if (usersFoundNumber === USERS_BATCH) {
        return findAffectedUsers(lastId, jobStartDate, nextScheduledCheck);
      }
    });
}

module.exports = {
  cancelSubscriptionForUser,
  scheduleNextCheckForUser,
  processUser,
  findAffectedUsers,
};