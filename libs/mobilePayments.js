import nconf from 'nconf';
import request from 'request';
import moment from 'moment';

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
      if (habitResponse.statusCode === 401) {
        return habitrpgUsers.update(
          {
            _id: user._id,
          },
          {
            $set: {
              'purchased.plan.dateTerminated': new Date(),
            },
          },
        );
      }
      if (!habitError && habitResponse.statusCode === 200) {
        return resolve();
      }

      return reject(habitError || body); // if there's an error or response.statusCode !== 200
    });
  };
  
  api.scheduleNextCheckForUser = function scheduleNextCheckForUser (habitrpgUsers, user, expirationDate, nextScheduledCheck) {
    if (nextScheduledCheck.isAfter(expirationDate)) {
      nextScheduledCheck = expirationDate;
    }
  
    return habitrpgUsers.update(
      {
        _id: user._id,
      },
    },
  );
};

export {
  cancelSubscriptionForUser,
  scheduleNextCheckForUser,
};
