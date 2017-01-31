const nconf = require('nconf');
const iap = require('in-app-purchase');
const request = require('request');
const USERS_BATCH = 10;
const BASE_URL = nconf.get('BASE_URL');
const subscriptions = require('../libs/subscriptions');
const Bluebird = require('bluebird');

let iapValidate = Bluebird.promisify(iap.validate, {context: iap});

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
        console.log('cancelled');
        return resolve();
      }

      reject(habitError || body); // if there's an error or response.statucCode !== 200
    });
  });
}

function scheduleNextCheckForUser (habitrpgUsers, user, subscription, nextScheduledCheck) {
  if (subscription.expirationDate < nextScheduledCheck) {
    nextScheduledCheck = subscription.expirationDate;
  }
  return habitrpgUsers.update(
    {
      _id: user._id,
    },
    {
      $set: {
        'purchased.plan.nextPaymentProcessing': nextScheduledCheck,
        'purchased.plan.nextBillingDate': subscription.expirationDate,
      },
    });
}

function processUser (habitrpgUsers, user, jobStartDate, nextScheduledCheck) {
  let plan = subscriptions.blocks[user.purchased.plan.planId];

  if (!plan) {
    throw new Error(`Plan ${user.purchased.plan.planId} does not exists. User \{user._id}`);
  }
  return iapValidate(iap.GOOGLE, user.purchased.plan.additionalData)
    .then((response) => {
      if (iap.isValidated(response)) {
        let purchaseDataList = iap.getPurchaseData(response);
        let subscription = purchaseDataList[0];
        if (subscription.expirationDate < jobStartDate) {
          console.log("cancelling");
          return cancelSubscriptionForUser(user);
        } else {
          console.log("rescheduling");
          return scheduleNextCheckForUser(habitrpgUsers, user, subscription, nextScheduledCheck);
        }
      } else {
        return cancelSubscriptionForUser(user);
      }
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
        console.log('processing', user._id);
        return processUser(habitrpgUsers, user, jobStartDate, nextScheduledCheck);
      }));
    }).then(() => {
      if (usersFoundNumber === USERS_BATCH) {
        console.log('more users')
        return findAffectedUsers(lastId, jobStartDate, nextScheduledCheck);
      } else {
        console.log('done');
        return;
      }
    });
}

module.exports = {
  cancelSubscriptionForUser,
  scheduleNextCheckForUser,
  processUser,
  findAffectedUsers,
};