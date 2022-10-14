import moment from 'moment';
import iap, {
  validate, GOOGLE, isValidated, getPurchaseData,
} from 'in-app-purchase';
import bluebird from 'bluebird';
import { blocks } from '../subscriptions.js';
import common from './common.js';

const iapValidate = bluebird.promisify(validate, { context: iap });

function processUser (habitrpgUsers, job, user, queue, baseUrl, jobStartDate) {
  const plan = blocks[user.purchased.plan.planId];

  if (!plan) {
    throw new Error(`Plan ${user.purchased.plan.planId} does not exist. User ${user._id}`);
  }
  return iapValidate(GOOGLE, user.purchased.plan.additionalData)
    .then(response => {
      if (isValidated(response)) {
        const purchaseDataList = getPurchaseData(response);
        for (const index in purchaseDataList) {
          if (Object.prototype.hasOwnProperty.call(purchaseDataList, index)) {
            const subscription = purchaseDataList[index];
            const expirationDate = Number(subscription.expirationDate);
            if (common.isInReminderRange(jobStartDate, moment(expirationDate))) {
              return common.sendEmailReminder(user, plan, queue, baseUrl, habitrpgUsers);
            }
          }
        }
      }
      return false;
    }).catch(err => {
      if (!err.validatedData || (err.validatedData && err.validatedData.is_retryable === false)) { // eslint-disable-line no-extra-parens
        throw err;
      } else {
        return false;
      }
    });
};


export {
  processUser,
};
