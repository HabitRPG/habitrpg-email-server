const nconf = require('nconf');
const iap = require('in-app-purchase');
const request = require('request');
const subscriptions = require('../libs/subscriptions');
const Bluebird = require('bluebird');

const USERS_BATCH = 10;
const BASE_URL = nconf.get('BASE_URL');

let api = {};

api.iapValidate = Bluebird.promisify(iap.validate, {context: iap});

api.cancelSubscriptionForUser = function cancelSubscriptionForUser (user) {
  return new Promise((resolve, reject) => {
    request.get(`${BASE_URL}/iap/android/subscribe/cancel`, {
      qs: {
        noRedirect: 'true',
        _id: user._id,
        apiToken: user.apiToken,
      },
    }, (habitError, habitResponse, body) => {
      if (!habitError && habitResponse.statusCode === 200) {
        return resolve();
      }

      reject(habitError || body); // if there's an error or response.statusCode !== 200
    });
  });
};

api.scheduleNextCheckForUser = function scheduleNextCheckForUser (habitrpgUsers, user, subscription, nextScheduledCheck) {
  if (nextScheduledCheck.isAfter(subscription.expirationDate)) {
    nextScheduledCheck = subscription.expirationDate;
  } else {
    nextScheduledCheck = nextScheduledCheck.toDate()
  }
  return habitrpgUsers.update(
    {
      _id: user._id,
    },
    {
      $set: {
        'purchased.plan.nextPaymentProcessing': nextScheduledCheck,
      },
    });
};

api.processUser = function processUser (habitrpgUsers, user, jobStartDate, nextScheduledCheck) {
  let plan = subscriptions.blocks[user.purchased.plan.planId];

  if (!plan) {
    throw new Error(`Plan ${user.purchased.plan.planId} does not exists. User \{user._id}`);
  }
  return api.iapValidate(iap.GOOGLE, user.purchased.plan.additionalData)
    .then((response) => {
      if (iap.isValidated(response)) {
        let purchaseDataList = iap.getPurchaseData(response);
        let subscription = purchaseDataList[0];
        if (subscription.expirationDate < jobStartDate) {
          return api.cancelSubscriptionForUser(user);
        } else {
          return api.scheduleNextCheckForUser(habitrpgUsers, user, subscription, nextScheduledCheck);
        }
      } else {
        return api.cancelSubscriptionForUser(user);
      }
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
