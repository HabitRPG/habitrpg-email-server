const nconf = require('nconf');
const request = require('request');
const moment = require('moment');

const BASE_URL = nconf.get('BASE_URL');

const api = {};

api.cancelSubscriptionForUser = function cancelSubscriptionForUser (habitrpgUsers, user, platform) {
    return new Promise((resolve, reject) => {
      request.get(`${BASE_URL}/iap/${platform}/subscribe/cancel`, {
      qs: {
        noRedirect: 'true',
      },
      headers: {
        'x-api-user': user._id,
        'x-api-key': user.apiToken,
      },
      }, (habitError, habitResponse, body) => {
          if (habitResponse && habitResponse.statusCode === 401) {
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
  
  api.scheduleNextCheckForUser = function scheduleNextCheckForUser (habitrpgUsers, user, expirationDate, nextScheduledCheck) {
    if (expirationDate !== null && nextScheduledCheck.isAfter(expirationDate)) {
      nextScheduledCheck = expirationDate;
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

module.exports = api;
