import moment from 'moment';
import nconf from 'nconf';
import { Stripe } from 'stripe';
import { blocks } from '../subscriptions.js';
import { getToData, getPersonalVariables } from '../email.js';

const stripe = Stripe(nconf.get('STRIPE_API_KEY'));

const GROUPS_BATCH = 10;

const api = {};

api.scheduleNextCheckForGroup = function scheduleNextCheckForGroup (habitrpgGroups, group) {
  return habitrpgGroups.update(
    {
      _id: group._id,
    },
    {
      $set: {
        'purchased.plan.lastReminderDate': moment().toDate(),
      },
    },
  );
};

api.getLeaderData = function getLeaderData (group, habitrpgUsers) {
  // console.log('Fetching leader for group', group._id, 'id', group.leader);
  return habitrpgUsers.find({ _id: group.leader }, {
    sort: { _id: 1 },
    fields: ['_id', 'auth', 'profile', 'preferences'],
  })
    .then(users => {
      if (!users || users.length === 0 || users.length > 1) {
        throw new Error(`Cannot find leader for group ${group._id} found ${users.length} results, leader ${group.leader}`);
      }
      // console.log('Found leader for group', group._id, 'id', group.leader);

      return users[0];
    });
};

api.sendEmailReminder = function sendEmailReminder (group, subPrice, queue, baseUrl, habitrpgUsers, habitrpgGroups) {
  return api
    .getLeaderData(group, habitrpgUsers)
    .then(user => new Promise((resolve, reject) => {
      const toData = getToData(user);
      const personalVariables = getPersonalVariables(toData);
      personalVariables[0].vars.push({
        name: 'GROUP_PRICE',
        content: subPrice,
      });

      if (
        user.preferences.emailNotifications.unsubscribeFromAll !== true
          && user.preferences.emailNotifications.subscriptionReminders !== false
      ) {
        /* console.log('would send email, data', JSON.stringify({
            emailType: 'group-renewal',
            to: [toData],
            // Manually pass BASE_URL as emails are sent from here and not from the main server
            variables: [{name: 'BASE_URL', content: baseUrl}],
            personalVariables,
          }, null, 4));
          resolve(); */

        queue.create('email', {
          emailType: 'group-renewal',
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
        // console.log('would not send email due to preferences');
        resolve();
      }
    })).then(() => api.scheduleNextCheckForGroup(habitrpgGroups, group));
};

api.processGroup = function processGroup (habitrpgGroups, habitrpgUsers, group, queue, baseUrl, jobStartDate) {
  const plan = blocks[group.purchased.plan.planId];

  // Groups with free subscriptions
  if (group.purchased.plan.customerId === 'habitrpg') return false;

  if (!plan || plan.target !== 'group') {
    throw new Error(`Plan ${group.purchased.plan.planId} does not exists. Group ${group._id}`);
  }

  const { customerId } = group.purchased.plan;

  return stripe.subscriptions.list({ customer: customerId }).then(customerSubscriptions => {
    const subscription = customerSubscriptions.data[0]; // We always have one subscription per customer
    // console.log('customer id', customerId, 'for user', user._id, user.auth.local.username);
    // console.log('subscription data', subscription);
    if (!subscription) {
      throw new Error(`Group ${group._id} with customerId ${customerId} does not have any subscription.`);
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
        'Found group with id', group._id, 'lastReminderDate', group.purchased.plan.lastReminderDate,
        // * 1000 because stripe returns timestamps in seconds from 1970 not milliseconds
        'last paymentdate', moment(subscription.current_period_start * 1000).toString(),
        'next date', nextInvoice.toString(),
        'plan id', subscription.plan.id
      );
      console.log('Plan', plan); */

      if (nextInvoice.isAfter(startDate) && nextInvoice.isBefore(endDate)) {
        const subPrice = (subscription.plan.amount / 100) * subscription.quantity; // stripe stores subscriptions in cents
        // console.log('would send email!\n\n\n\n');

        return api.sendEmailReminder(group, subPrice, queue, baseUrl, habitrpgUsers, habitrpgGroups);
      }
      // console.log('would not send email');
    } else {
      // * 1000 because stripe returns timestamps in seconds from 1970 not milliseconds
      throw new Error(`Issue with subscription.current_period_end, value: ${moment(subscription.current_period_end * 1000).toString()} for group ${group._id}`);
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

const findAffectedGroups = function findAffectedGroups (habitrpgGroups, habitrpgUsers, lastId, jobStartDate, queue, baseUrl) {
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

  let groupsFoundNumber;
  let newLastId;

  return habitrpgGroups.find(query, {
    sort: { _id: 1 },
    limit: GROUPS_BATCH,
    fields: ['_id', 'purchased.plan', 'leader', 'name'],
  })
    .then(groups => {
      console.log('Stripe Reminders: Found n groups', groups.length);
      groupsFoundNumber = groups.length;
      newLastId = groupsFoundNumber > 0 ? groups[groupsFoundNumber - 1]._id : null; // the group if of the last found group

      return Promise.all(groups.map(group => api.processGroup(habitrpgGroups, habitrpgUsers, group, queue, baseUrl, jobStartDate)));
    }).then(() => new Promise(resolve => {
      setTimeout(() => {
        resolve();
      }, 3000);
    })).then(() => {
      if (groupsFoundNumber === GROUPS_BATCH) {
        return findAffectedGroups(habitrpgGroups, habitrpgUsers, newLastId, jobStartDate, queue, baseUrl);
      }
      return true;
    });
};

export {
  findAffectedGroups,
};
