const nconf = require('nconf');
const request = require('request');
const moment = require('moment');

const BASE_URL = nconf.get('BASE_URL');

api.cancelSubscriptionForUser = function cancelSubscriptionForUser (habitrpgUsers, user, platform) {
    return new Promise((resolve, reject) => {
      request.get(`${BASE_URL}/iap/${patform}/subscribe/cancel`, {
      qs: {
        noRedirect: 'true',
      },
      headers: {
        'x-api-user': user._id,
        'x-api-key': user.apiToken,
      },
      }, (habitError, habitResponse, body) => {
          if (habitResponse.statusCode === 401) {
            return habitrpgUsers.update(
                {
                  _id: user._id,
                },
                {
                  $set: {
                    'purchased.plan.dateTerminated': Date(),
                  },
                });
          }
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
    }
  
    return habitrpgUsers.update(
      {
        _id: user._id,
      },
      {
        $set: {
          'purchased.plan.nextPaymentProcessing': moment(nextScheduledCheck).toDate(),
        },
      });
  };