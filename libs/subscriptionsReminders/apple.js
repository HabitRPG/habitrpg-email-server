const subscriptions = require('../subscriptions');
const moment = require('moment');
const emailsLib = require('../email');
const iap = require('in-app-purchase');

const getToData = emailsLib.getToData;
const getPersonalVariables = emailsLib.getPersonalVariables;

const USERS_BATCH = 10;

let api = {};

api.scheduleNextCheckForUser = function scheduleNextCheckForUser (habitrpgUsers, user) {
  return habitrpgUsers.update(
    {
      _id: user._id,
    },
    {
      $set: {
        'purchased.plan.lastReminderDate': moment().toDate(),
      },
    }
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
      user.preferences.emailNotifications.unsubscribeFromAll !== true &&
      user.preferences.emailNotifications.subscriptionReminders !== false
    ) {
      queue.create('email', {
        emailType: 'subscription-renewal-apple',
        to: [toData],
        // Manually pass BASE_URL as emails are sent from here and not from the main server
        variables: [{name: 'BASE_URL', content: baseUrl}],
        personalVariables,
      })
      .priority('high')
      .attempts(5)
      .backoff({type: 'fixed', delay: 30 * 60 * 1000}) // try again after 30 minutes
      .save((err) => {
        if (err) return reject(err);
        resolve();
      });
    } else {
      resolve();
    }
  }).then(() => {
    return api.scheduleNextCheckForUser(habitrpgUsers, user);
  });
};

api.processUser = function processUser (habitrpgUsers, user, queue, baseUrl, jobStartDate) {
  let plan = subscriptions.blocks[user.purchased.plan.planId];

  if (!plan) {
    throw new Error(`Plan ${user.purchased.plan.planId} does not exists. User \{user._id}`);
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
    .validate(iap.APPLE, user.purchased.plan.additionalData)
    .then((response) => {
      if (iap.isValidated(response)) {
        // console.log('Found user with id', user._id, 'lastReminderDate', user.purchased.plan.lastReminderDate);
        // console.log('Plan', plan);

        const purchaseDataList = iap.getPurchaseData(response);
        for (const index in purchaseDataList) {
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
    }).catch(err => {
      console.error('Error', err);
      console.log('Found user with id', user._id, 'lastReminderDate', user.purchased.plan.lastReminderDate);
      console.log('Plan', plan);

      if (!err.validatedData || (err.validatedData && err.validatedData.is_retryable === false)) { // eslint-disable-line no-extra-parens
        throw err;
      } else {
        return;
      }
    });
};

api.findAffectedUsers = function findAffectedUsers (habitrpgUsers, lastId, jobStartDate, queue, baseUrl) {
  let query = {
    'purchased.plan.paymentMethod': 'Apple',
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

  return habitrpgUsers.find(query, {
    sort: {_id: 1},
    limit: USERS_BATCH,
    fields: ['_id', 'auth', 'profile', 'purchased.plan', 'preferences'],
  })
    .then(users => {
      console.log('Apple: Found n users', users.length);
      usersFoundNumber = users.length;
      lastId = usersFoundNumber > 0 ? users[usersFoundNumber - 1]._id : null; // the user if of the last found user

      return Promise.all(users.map(user => {
        return api.processUser(habitrpgUsers, user, queue, baseUrl, jobStartDate);
      }));
    }).then(() => {
      if (usersFoundNumber === USERS_BATCH) {
        return api.findAffectedUsers(habitrpgUsers, lastId, jobStartDate, queue, baseUrl);
      } else {
        return;
      }
    });
};

module.exports = api;
