import iap from 'in-app-purchase';
import { blocks } from './subscriptions.js';
import { cancelSubscriptionForUser, scheduleNextCheckForUser } from './mobilePayments.js';
import Bluebird from 'bluebird';

const api = {};

api.iapValidate = Bluebird.promisify(iap.validate, { context: iap });

api.processUser = function processUser (habitrpgUsers, job, user, jobStartDate, nextScheduledCheck) {
  const plan = blocks[user.purchased.plan.planId];

  if (!plan || user.auth.blocked === true) {
    return;
  }

  const receipt = user.purchased.plan.additionalData;

  receipt.data = typeof receipt.data === 'string' ? JSON.parse(receipt.data) : receipt.data;

  return api.iapValidate(iap.GOOGLE, user.purchased.plan.additionalData)
    .then(response => {
      if (iap.isValidated(response)) {
        let purchaseDataList = iap.getPurchaseData(response);
        let expirationDate;
        for (let i in purchaseDataList) {
          const purchase = purchaseDataList[i];
          if (purchase.autoRenewing === true) {
            expirationDate = purchase.expirationDate;
            break;
          } else if (!expirationDate || Number(purchase.expirationDate) > Number(expirationDate)) {
            expirationDate = subscriptions.expirationDate;
          }
        }
        if (expirationDate && expirationDate < jobStartDate) {
          return cancelSubscriptionForUser(habitrpgUsers, job, user, 'android');
        } else {
          return scheduleNextCheckForUser(habitrpgUsers, user, expirationDate, nextScheduledCheck);
        }
      }
      return mobilePayments.scheduleNextCheckForUser(habitrpgUsers, user, null, nextScheduledCheck);
    }).catch(err => {
      // Status:410 means that the subsctiption isn't active anymore
      if (err && err.message === 'Status:410') {
        return cancelSubscriptionForUser(habitrpgUsers, job, user, 'android');
      } else {
        if (err) {
          job.log(`User Errored: ${err}`);
        }
        return scheduleNextCheckForUser(habitrpgUsers, user, null, nextScheduledCheck);
      }
    });
};

export default api;
