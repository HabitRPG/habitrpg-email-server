const moment = require('moment');
const emailsLib = require('../email');

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

api.sendEmailReminder = function sendEmailReminder (user, queue, baseUrl, habitrpgUsers) {
  return new Promise((resolve, reject) => {
    const toData = getToData(user);
    const personalVariables = getPersonalVariables(toData);
    personalVariables[0].vars.push({
      name: 'EXPIRATION_DATE',
      content: moment(user.purchased.plan.dateTerminated).format('MMMM D'),
    });

    if (
      user.preferences.emailNotifications.unsubscribeFromAll !== true &&
      user.preferences.emailNotifications.subscriptionReminders !== false
    ) {
      queue.create('email', {
        emailType: 'gift-subscription-reminder', // not actually limited to gift subscriptions
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

api.processUser = function processUser (habitrpgUsers, user, queue, baseUrl) {
  /* console.log(
    'Found user with id', user._id, 'lastReminderDate', user.purchased.plan.lastReminderDate,
    'dateTerminated', user.purchased.plan.dateTerminated); */

  api.sendEmailReminder(user, queue, baseUrl, habitrpgUsers);
};

api.findAffectedUsers = function findAffectedUsers (habitrpgUsers, lastId, jobStartDate, queue, baseUrl) {
  let query = {
    'purchased.plan.dateTerminated': {
      $gt: moment(jobStartDate.toDate()).add({
        days: 6,
        hours: 12,
      }).toDate(),
      $lt: moment(jobStartDate.toDate()).add({
        days: 7,
        hours: 12,
      }).toDate(),
    },
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
      console.log('Expiring Subscriptions Reminders: Found n users', users.length);
      usersFoundNumber = users.length;
      lastId = usersFoundNumber > 0 ? users[usersFoundNumber - 1]._id : null; // the user if of the last found user

      return Promise.all(users.map(user => {
        return api.processUser(habitrpgUsers, user, queue, baseUrl);
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
