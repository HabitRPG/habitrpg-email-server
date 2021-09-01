import moment from 'moment';
import { blocks } from '../subscriptions.js';
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
        emailType: 'subscription-renewal',
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

  // Get the last billing date
  const lastBillingDate = moment(user.purchased.plan.lastBillingDate);

  // Calculate the (rough) next one
  const nextBillingDate = moment(lastBillingDate.toDate()).add({ months: plan.months });

  const startDate = moment(jobStartDate.toDate()).add({
    days: 6,
    hours: 12,
  }).toDate();

  const endDate = moment(jobStartDate.toDate()).add({
    days: 7,
    hours: 12,
  }).toDate();

  /* console.log(
    'Found user with id', user._id, 'lastReminderDate', user.purchased.plan.lastReminderDate,
    'last paymentdate', lastBillingDate.toString(),
    'next date', nextBillingDate.toString());
  console.log('Plan', plan); */

  if (nextBillingDate.isAfter(startDate) && nextBillingDate.isBefore(endDate)) {
    // console.log('would send email!\n\n\n\n');
    return api.sendEmailReminder(user, plan, queue, baseUrl, habitrpgUsers);
  }
  // console.log('would not send email');
  return false;
};

const findAffectedUsers = function findAffectedUsers (habitrpgUsers, lastId, jobStartDate, queue, baseUrl) {
  const query = {
    'purchased.plan.paymentMethod': 'Amazon Payments',
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
      console.log('Amazon Payments Reminders: Found n users', users.length);
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
