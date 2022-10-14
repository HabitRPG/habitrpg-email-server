import moment from 'moment';
import { getToData, getPersonalVariables } from '../email.js';
import common from './common.js';

function sendEmailReminder (habitrpgUsers, job, user, queue, baseUrl) {
  return new Promise(resolve => {
    const toData = getToData(user);
    const personalVariables = getPersonalVariables(toData);
    personalVariables[0].vars.push({
      name: 'EXPIRATION_DATE',
      content: moment(user.purchased.plan.dateTerminated).format('MMMM D'),
    });

    if (
      user.preferences.emailNotifications.unsubscribeFromAll !== true
      && user.preferences.emailNotifications.subscriptionReminders !== false
    ) {
      queue.add('email', {
        emailType: 'gift-subscription-reminder', // not actually limited to gift subscriptions
        to: [toData],
        // Manually pass BASE_URL as emails are sent from here and not from the main server
        variables: [{ name: 'BASE_URL', content: baseUrl }],
        personalVariables,
      });
    } else {
      resolve();
    }
  }).then(() => common.scheduleNextCheck(habitrpgUsers, user));
};

export {
  sendEmailReminder,
};
