import moment from 'moment';
import { getToData, getPersonalVariables } from '../email.js';

const USERS_BATCH = 10;

const api = {};

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

api.sendEmailReminder = function sendEmailReminder (user, queue, baseUrl, habitrpgUsers) {
  return new Promise(resolve => {
    const toData = getToData(user);
    const personalVariables = getPersonalVariables(toData);
    personalVariables[0].vars.push({
      name: 'EXPIRATION_DATE',
      content: moment(user.purchased.plan.dateTerminated).format('MMMM D'),
    });

    if (
      user.preferences.emailNotifications.unsubscribeFromAll !== true
      && user.preferences.emailNotifications.subscriptionReminders !== false
    ) {
      queue.add('email', {
        emailType: 'gift-subscription-reminder', // not actually limited to gift subscriptions
        to: [toData],
        // Manually pass BASE_URL as emails are sent from here and not from the main server
        variables: [{ name: 'BASE_URL', content: baseUrl }],
        personalVariables,
      });
    } else {
      resolve();
    }
  }).then(() => api.scheduleNextCheckForUser(habitrpgUsers, user));
};

api.processUser = function processUser (habitrpgUsers, user, queue, baseUrl) {
  /* console.log(
    'Found user with id', user._id, 'lastReminderDate', user.purchased.plan.lastReminderDate,
    'dateTerminated', user.purchased.plan.dateTerminated); */

  api.sendEmailReminder(user, queue, baseUrl, habitrpgUsers);
};

const findAffectedUsers = function findAffectedUsers (habitrpgUsers, lastId, jobStartDate, queue, baseUrl) {
  const query = {
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
  let newLastId;
  return habitrpgUsers.find(query, {
    sort: { _id: 1 },
    limit: USERS_BATCH,
    fields: ['_id', 'auth', 'profile', 'purchased.plan', 'preferences'],
  })
    .then(users => {
      console.log('Expiring Subscriptions Reminders: Found n users', users.length);
      usersFoundNumber = users.length;
      newLastId = usersFoundNumber > 0 ? users[usersFoundNumber - 1]._id : null; // the user if of the last found user

      return Promise.all(users.map(user => api.processUser(habitrpgUsers, user, queue, baseUrl)));
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
