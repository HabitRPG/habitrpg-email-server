import moment from 'moment';
import nconf from 'nconf';
import { Stripe } from 'stripe';
import { blocks } from '../subscriptions.js';
import common from './common.js';

const stripe = Stripe(nconf.get('STRIPE_API_KEY'));

function processUser (habitrpgUsers, job, user, queue, baseUrl, jobStartDate) {
  const plan = blocks[user.purchased.plan.planId];

  // Users with free subscriptions
  if (user.purchased.plan.customerId === 'habitrpg') return false;

  if (!plan) {
    throw new Error(`Plan ${user.purchased.plan.planId} does not exist. User ${user._id}`);
  }

  const { customerId } = user.purchased.plan;

  return stripe.subscriptions.list({ customer: customerId }).then(customerSubscriptions => {
    const subscription = customerSubscriptions.data[0]; // We always have one subscription per customer
    if (!subscription) {
      throw new Error(`User ${user._id} with customerId ${customerId} does not have any subscription.`);
    }

    if (subscription.current_period_end) {
      if (subscription.status === 'canceled') return false;

      // * 1000 because stripe returns timestamps in seconds from 1970 not milliseconds
      const nextInvoice = moment(subscription.current_period_end * 1000);

      if (common.isInReminderRange(jobStartDate, nextInvoice)) {
        return common.sendEmailReminder(user, plan, queue, baseUrl, habitrpgUsers);
      }
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

export {
  processUser,
};
