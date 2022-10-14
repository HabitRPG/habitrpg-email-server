import moment from 'moment';
import nconf from 'nconf';
import { Stripe } from 'stripe';
import { blocks } from '../subscriptions.js';
import { getToData, getPersonalVariables } from '../email.js';
import common from './common.js';

const stripe = Stripe(nconf.get('STRIPE_API_KEY'));

function processGroup (habitrpgGroups, habitrpgUsers, group, queue, baseUrl, jobStartDate) {
  const plan = blocks[group.purchased.plan.planId];

  // Groups with free subscriptions
  if (group.purchased.plan.customerId === 'habitrpg') return false;

  if (!plan || plan.target !== 'group') {
    throw new Error(`Plan ${group.purchased.plan.planId} does not exist. Group ${group._id}`);
  }

  const { customerId } = group.purchased.plan;

  return stripe.subscriptions.list({ customer: customerId }).then(customerSubscriptions => {
    const subscription = customerSubscriptions.data[0]; // We always have one subscription per customer
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

      if (nextInvoice.isAfter(startDate) && nextInvoice.isBefore(endDate)) {
        const subPrice = (subscription.plan.amount / 100) * subscription.quantity; // stripe stores subscriptions in cents

        return common.sendGroupEmailReminder(group, subPrice, queue, baseUrl, habitrpgUsers, habitrpgGroups);
      }
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

export {
  processGroup,
};
