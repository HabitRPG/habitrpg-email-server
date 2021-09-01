import moment from 'moment';
import nconf from 'nconf';
import { Stripe } from 'stripe';
import { blocks } from '../subscriptions.js';
import { getToData, getPersonalVariables } from '../email.js';

const stripe = Stripe(nconf.get('STRIPE_API_KEY'));

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

  // Users with free subscriptions
  if (user.purchased.plan.customerId === 'habitrpg') return false;

  if (!plan) {
    throw new Error(`Plan ${user.purchased.plan.planId} does not exists. User ${user._id}`);
  }

  const { customerId } = user.purchased.plan;

  return stripe.subscriptions.list({ customer: customerId }).then(customerSubscriptions => {
    const subscription = customerSubscriptions.data[0]; // We always have one subscription per customer
    // console.log('customer id', customerId, 'for user', user._id, user.auth.local.username);
    // console.log('subscription data', subscription);
    if (!subscription) {
      throw new Error(`User ${user._id} with customerId ${customerId} does not have any subscription.`);
    }

    if (subscription.current_period_end) {
      if (subscription.status === 'canceled') return false;

      // * 1000 because stripe returns timestamps in seconds from 1970 not milliseconds
      const nextInvoice = moment(subscription.current_period_end * 1000);

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
        // * 1000 because stripe returns timestamps in seconds from 1970 not milliseconds
        'last paymentdate', moment(subscription.current_period_start * 1000).toString(),
        'next date', nextInvoice.toString());
      console.log('Plan', plan); */

      if (nextInvoice.isAfter(startDate) && nextInvoice.isBefore(endDate)) {
        // console.log('would send email!\n\n\n\n');
        return api.sendEmailReminder(user, plan, queue, baseUrl, habitrpgUsers);
      }
      // console.log('would not send email');
    } else {
      // * 1000 because stripe returns timestamps in seconds from 1970 not milliseconds
      throw new Error(`Issue with subscription.current_period_end, value: ${moment(subscription.current_period_end * 1000).toString()} for user ${user._id}`);
    }
    return false;
  }).catch(stripeError => {
    // Catch and ignore errors due to having an account using Stripe test data
    if (stripeError && stripeError.code === 'resource_missing'
      && stripeError.message && stripeError.message.indexOf('exists in test mode, but a live mode key was used') !== -1) {
      return false;
    }
    throw stripeError;
  });
};

const findAffectedUsers = function findAffectedUsers (habitrpgUsers, lastId, jobStartDate, queue, baseUrl) {
  const query = {
    'purchased.plan.paymentMethod': 'Stripe',
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
      console.log('Stripe Reminders: Found n users', users.length);
      usersFoundNumber = users.length;
      newLastId = usersFoundNumber > 0 ? users[usersFoundNumber - 1]._id : null; // the user if of the last found user

      return Promise.all(users.map(user => api.processUser(habitrpgUsers, user, queue, baseUrl, jobStartDate)));
    }).then(() => new Promise(resolve => {
      setTimeout(() => {
        resolve();
      }, 3000);
    })).then(() => {
      if (usersFoundNumber === USERS_BATCH) {
        return findAffectedUsers(habitrpgUsers, newLastId, jobStartDate, queue, baseUrl);
      }
      return true;
    });
};

export {
  findAffectedUsers,
};
