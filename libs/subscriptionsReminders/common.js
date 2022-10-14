import { getToData, getPersonalVariables } from '../email.js';

function scheduleNextCheck (collection, entity) {
    return collection.update(
      {
        _id: entity._id,
      },
      {
        $set: {
          'purchased.plan.lastReminderDate': moment().toDate(),
        },
      },
    );
  };
  
function sendEmailReminder (user, plan, queue, baseUrl, habitrpgUsers) {
    return new Promise(resolve => {
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
        queue.add('email', {
          emailType: 'subscription-renewal-apple',
          to: [toData],
          // Manually pass BASE_URL as emails are sent from here and not from the main server
          variables: [{ name: 'BASE_URL', content: baseUrl }],
          personalVariables,
        });
      } else {
        resolve();
      }
    }).then(() => scheduleNextCheck(habitrpgUsers, user));
  };

  function sendGroupEmailReminder (group, subPrice, queue, baseUrl, habitrpgUsers, habitrpgGroups) {
    return getLeaderData(group, habitrpgUsers)
      .then(user => new Promise(resolve => {
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
  
          queue.add('email', {
            emailType: 'group-renewal',
            to: [toData],
            // Manually pass BASE_URL as emails are sent from here and not from the main server
            variables: [{ name: 'BASE_URL', content: baseUrl }],
            personalVariables,
          });
        } else {
          resolve();
        }
      })).then(() => common.scheduleNextCheck(habitrpgGroups, group));
  };

function getLeaderData (group, habitrpgUsers) {
    return habitrpgUsers.find({ _id: group.leader }, {
      sort: { _id: 1 },
      fields: ['_id', 'auth', 'profile', 'preferences'],
    })
      .then(users => {
        if (!users || users.length === 0 || users.length > 1) {
          throw new Error(`Cannot find leader for group ${group._id} found ${users.length} results, leader ${group.leader}`);
        }
        return users[0];
      });
  };

function isInReminderRange (now, date) {
  const startDate = moment(now.toDate()).add({
    days: 6,
    hours: 12,
  }).toDate();

  const endDate = moment(now.toDate()).add({
    days: 7,
    hours: 12,
  }).toDate();
  return date.isAfter(startDate) && date.isBefore(endDate)
}

  export {
    sendEmailReminder,
    scheduleNextCheck,
    sendGroupEmailReminder,
    isInReminderRange
  }