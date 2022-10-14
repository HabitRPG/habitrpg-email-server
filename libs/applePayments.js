import iap from 'in-app-purchase';
import { blocks } from './subscriptions.js';
import { cancelSubscriptionForUser, scheduleNextCheckForUser } from './mobilePayments.js';

const INVALID_RECEIPT_ERROR = 21010;


function processUser (habitrpgUsers, job, user, jobStartDate, nextScheduledCheck) {
  const plan = blocks[user.purchased.plan.planId];

  if (user.auth.blocked === true) return;

  if (!plan) {
    return;
  }
  return iap.validate(iap.APPLE, user.purchased.plan.additionalData)
    .then((response) => {
      if (iap.isValidated(response)) {
        let purchaseDataList = iap.getPurchaseData(response);
        for (let index in purchaseDataList) {
          let subscription = purchaseDataList[index];
          if (subscription.expirationDate > jobStartDate) {
            return scheduleNextCheckForUser(habitrpgUsers, user, subscription.expirationDate, nextScheduledCheck);
          }
        }
        return cancelSubscriptionForUser(habitrpgUsers, job, user, "ios");
      }
    })
    .catch(err => {
      if (err && (err.status === INVALID_RECEIPT_ERROR || (typeof num === 'string' && err.includes('"status":21010')) ||  (err.validatedData && err.validatedData.is_retryable === false && err.validatedData.status === INVALID_RECEIPT_ERROR))) {
        return cancelSubscriptionForUser(habitrpgUsers, job, user, "ios");
      } else {
        job.log(`Error processing subscription for user ${user._id}`);
        return scheduleNextCheckForUser(habitrpgUsers, user, null, nextScheduledCheck);
      }
    });
};

export default { processUser };
