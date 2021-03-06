const subscriptions = require('../subscriptions');
const moment = require('moment');
const emailsLib = require('../email');

const getToData = emailsLib.getToData;
const getPersonalVariables = emailsLib.getPersonalVariables;

const GROUPS_BATCH = 10;

let api = {};

api.scheduleNextCheckForGroup = function scheduleNextCheckForGroup (habitrpgGroups, group) {
  return habitrpgGroups.update(
    {
      _id: group._id,
    },
    {
      $set: {
        'purchased.plan.lastReminderDate': moment().toDate(),
      },
    }
  );
};

api.getLeaderData = function getLeaderData (group, habitrpgUsers) {
  // console.log('Fetching leader for group', group._id, 'id', group.leader);
  return habitrpgUsers.find({_id: group.leader}, {
    sort: {_id: 1},
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
    .then(user => {
      return new Promise((resolve, reject) => {
        const toData = getToData(user);
        const personalVariables = getPersonalVariables(toData);
        personalVariables[0].vars.push({
          name: 'GROUP_PRICE',
          content: subPrice,
        });

        if (
          user.preferences.emailNotifications.unsubscribeFromAll !== true &&
          user.preferences.emailNotifications.subscriptionReminders !== false
        ) {
          /* console.log('would send email, data', JSON.stringify({
            emailType: 'group-renewal',
            to: [toData],
            // Manually pass BASE_URL as emails are sent from here and not from the main server
            variables: [{name: 'BASE_URL', content: baseUrl}],
            personalVariables,
          }, null, 4));
          resolve();*/

          queue.create('email', {
            emailType: 'group-renewal',
            to: [toData],
            // Manually pass BASE_URL as emails are sent from here and not from the main server
            variables: [{name: 'BASE_URL', content: baseUrl}],
            personalVariables,
          })
          .priority('high')
          .attempts(5)
          .backoff({type: 'fixed', delay: 30 * 60 * 1000}) // try again after 30 minutes
          .save((err) => {
            if (err) return reject(err);
            resolve();
          });
        } else {
          // console.log('would not send email due to preferences');
          resolve();
        }
      });
    }).then(() => {
      return api.scheduleNextCheckForGroup(habitrpgGroups, group);
    });
};

api.processGroup = function processGroup (habitrpgGroups, habitrpgUsers, group, queue, baseUrl, jobStartDate) {
  let plan = subscriptions.blocks[group.purchased.plan.planId];

  // Groups with free subscriptions
  if (group.purchased.plan.customerId === 'habitrpg') return;

  if (!plan || plan.target !== 'group') {
    throw new Error(`Plan ${group.purchased.plan.planId} does not exists. Group ${group._id}`);
  }

  // Get the last billing date
  const lastBillingDate = moment(group.purchased.plan.lastBillingDate);

  // Calculate the (rough) next one
  const nextBillingDate = moment(lastBillingDate.toDate()).add({months: plan.months});

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
    'last paymentdate', lastBillingDate.toString(),
    'next date', nextBillingDate.toString());
  console.log('Plan', plan); */

  if (nextBillingDate.isAfter(startDate) && nextBillingDate.isBefore(endDate)) {
    const subPrice = plan.price * (plan.quantity + group.memberCount - 1);

    // console.log('would send email!\n\n\n\n');

    return api.sendEmailReminder(group, subPrice, queue, baseUrl, habitrpgUsers, habitrpgGroups);
  } else {
    // console.log('would not send email');
  }
};

api.findAffectedGroups = function findAffectedGroups (habitrpgGroups, habitrpgUsers, lastId, jobStartDate, queue, baseUrl) {
  let query = {
    'purchased.plan.paymentMethod': 'Amazon Payments',
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

  return habitrpgGroups.find(query, {
    sort: {_id: 1},
    limit: GROUPS_BATCH,
    fields: ['_id', 'purchased.plan', 'leader', 'name', 'memberCount'],
  })
    .then(groups => {
      console.log('Amazon Reminders: Found n groups', groups.length);
      groupsFoundNumber = groups.length;
      lastId = groupsFoundNumber > 0 ? groups[groupsFoundNumber - 1]._id : null; // the group if of the last found group

      return Promise.all(groups.map(group => {
        return api.processGroup(habitrpgGroups, habitrpgUsers, group, queue, baseUrl, jobStartDate);
      }));
    }).then(() => {
      if (groupsFoundNumber === GROUPS_BATCH) {
        return api.findAffectedGroups(habitrpgGroups, habitrpgUsers, lastId, jobStartDate, queue, baseUrl);
      } else {
        return;
      }
    });
};

module.exports = api;
