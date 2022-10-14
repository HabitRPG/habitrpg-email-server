import moment from 'moment';
import { blocks } from '../subscriptions.js';
import common from './common.js';

function processUser (habitrpgUsers, job, user, queue, baseUrl, jobStartDate) {
  const plan = blocks[user.purchased.plan.planId];

  if (!plan) {
    throw new Error(`Plan ${user.purchased.plan.planId} does not exist. User ${user._id}`);
  }
  const lastBillingDate = moment(user.purchased.plan.lastBillingDate);

  // Calculate the (rough) next one
  const nextBillingDate = moment(lastBillingDate.toDate()).add({ months: plan.months });
  if (common.isInReminderRange(jobStartDate, nextBillingDate)) {
    return common.sendEmailReminder(user, plan, queue, baseUrl, habitrpgUsers);
  }
  return false;
};

export {
  processUser,
};
