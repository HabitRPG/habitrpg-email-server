import moment from 'moment';
import { blocks } from '../subscriptions.js';
import common from './common.js';

function processGroup (habitrpgGroups, habitrpgUsers, group, queue, baseUrl, jobStartDate) {
  const plan = blocks[group.purchased.plan.planId];

  // Groups with free subscriptions
  if (group.purchased.plan.customerId === 'habitrpg') return false;

  if (!plan || plan.target !== 'group') {
    throw new Error(`Plan ${group.purchased.plan.planId} does not exist. Group ${group._id}`);
  }

  // Get the last billing date
  const lastBillingDate = moment(group.purchased.plan.lastBillingDate);

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

  if (nextBillingDate.isAfter(startDate) && nextBillingDate.isBefore(endDate)) {
    const subPrice = plan.price * (plan.quantity + group.memberCount - 1);
    return common.sendGroupEmailReminder(group, subPrice, queue, baseUrl, habitrpgUsers, habitrpgGroups);
  }
  return false;
};

export {
  processGroup,
};
