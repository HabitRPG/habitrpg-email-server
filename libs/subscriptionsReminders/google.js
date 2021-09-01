import moment from 'moment';
import iap, {
  validate, GOOGLE, isValidated, getPurchaseData,
} from 'in-app-purchase';
import bluebird from 'bluebird';
import { getToData, getPersonalVariables } from '../email.js';
import { blocks } from '../subscriptions.js';

const USERS_BATCH = 10;

const api = {};

api.iapValidate = bluebird.promisify(validate, { context: iap });

api.scheduleNextCheckForUser = function scheduleNextCheckForUser (habitrpgUsers, user) {
  return habitrpgUsers.update(
    {
      _id: user._id,
    },
    {
      $set: {
        'purchased.plan.lastReminderDate': moment().toDate(),
      },
    },
  );
};

api.sendEmailReminder = function sendEmailReminder (user, plan, queue, baseUrl, habitrpgUsers) {
  return new Promise((resolve, reject) => {
    const toData = getToData(user);
    const personalVariables = getPersonalVariables(toData);
    personalVariables[0].vars.push({
      name: 'SUBSCRIPTION_PRICE',
      content: plan.price,
    });

    if (
      user.preferences.emailNotifications.unsubscribeFromAll !== true
      && user.preferences.emailNotifications.subscriptionReminders !== false
    ) {
      queue.create('email', {
        emailType: 'subscription-renewal-apple',
        to: [toData],
        // Manually pass BASE_URL as emails are sent from here and not from the main server
        variables: [{ name: 'BASE_URL', content: baseUrl }],
        personalVariables,
      })
        .priority('high')
        .attempts(5)
        .backoff({ type: 'fixed', delay: 30 * 60 * 1000 }) // try again after 30 minutes
        .save(err => {
          if (err) return reject(err);
          return resolve();
        });
    } else {
      resolve();
    }
  }).then(() => api.scheduleNextCheckForUser(habitrpgUsers, user));
};

api.processUser = function processUser (habitrpgUsers, user, queue, baseUrl, jobStartDate) {
  const plan = blocks[user.purchased.plan.planId];

  if (!plan) {
    throw new Error(`Plan ${user.purchased.plan.planId} does not exists. User ${user._id}`);
  }

  const startDate = moment(jobStartDate.toDate()).add({
    days: 6,
    hours: 12,
  }).toDate();

  const endDate = moment(jobStartDate.toDate()).add({
    days: 7,
    hours: 12,
  }).toDate();

  return api
    .iapValidate(GOOGLE, user.purchased.plan.additionalData)
    .then(response => {
      if (isValidated(response)) {
        // console.log('Found user with id', user._id, 'lastReminderDate', user.purchased.plan.lastReminderDate);
        // console.log('Plan', plan);

        const purchaseDataList = getPurchaseData(response);
        for (const index in purchaseDataList) {
          if (Object.prototype.hasOwnProperty.call(purchaseDataList, index)) {
            const subscription = purchaseDataList[index];
            const expirationDate = Number(subscription.expirationDate);
            // console.log('subscription', subscription, 'expiration date', moment(expirationDate).toString());
            if (moment(expirationDate).isAfter(startDate) && moment(expirationDate).isBefore(endDate)) {
              // console.log('would send email!\n\n\n\n');
              return api.sendEmailReminder(user, plan, queue, baseUrl, habitrpgUsers);
            }

            // console.log('would not send email\n\n\n\n');
          }
        }
      }
      return false;
    }).catch(err => {
      console.error('Error', err);
      console.log('Found user with id', user._id, 'lastReminderDate', user.purchased.plan.lastReminderDate);
      console.log('Plan', plan);

      if (!err.validatedData || (err.validatedData && err.validatedData.is_retryable === false)) { // eslint-disable-line no-extra-parens
        throw err;
      } else {
        return false;
      }
    });
};

const findAffectedUsers = function findAffectedUsers (habitrpgUsers, lastId, jobStartDate, queue, baseUrl) {
  const query = {
    'purchased.plan.paymentMethod': 'Google',
    'purchased.plan.dateTerminated': null,
    // Where lastReminderDate is not recent (25 days to be sure?) or doesn't exist
    $or: [{
      'purchased.plan.lastReminderDate': {
        $lte: moment(jobStartDate.toDate()).subtract(25, 'days').toDate(),
      },
    }, {
      'purchased.plan.lastReminderDate': null,
    }],
  };

  if (lastId) {
    query._id = {
      $gt: lastId,
    };
  }

  console.log('Run query', query);

  let usersFoundNumber;
  let newLastId;

  return habitrpgUsers.find(query, {
    sort: { _id: 1 },
    limit: USERS_BATCH,
    fields: ['_id', 'auth', 'profile', 'purchased.plan', 'preferences'],
  })
    .then(users => {
      console.log('Google: Found n users', users.length);
      usersFoundNumber = users.length;
      newLastId = usersFoundNumber > 0 ? users[usersFoundNumber - 1]._id : null; // the user if of the last found user

      return Promise.all(users.map(user => api.processUser(habitrpgUsers, user, queue, baseUrl, jobStartDate)));
    }).then(() => {
      if (usersFoundNumber === USERS_BATCH) {
        return findAffectedUsers(habitrpgUsers, newLastId, jobStartDate, queue, baseUrl);
      }
      return true;
    });
};

export {
  findAffectedUsers,
};
