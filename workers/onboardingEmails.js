import moment from 'moment';
import lodash from 'lodash';
import { sendNotification } from '../libs/pushNotifications.js';
import { getToData, getPersonalVariables } from '../libs/email.js';

const USERS_BATCH = 10;

// Defined later
let queue;
let baseUrl;
let dbUsers;
let dbTasks;
let dbGroups;
let db;

// Currently disabled emails
const DISABLED_EMAILS = [3, 4, 5, 6];

// check: a function (must be a promise) to check if each user has completed a step
// requires: optional string, if the steps requires the completion of a previous one
const steps = [
  false, // 0, we want steps to start from index 1

  // 1
  {
    check: function hasCheckedOffTask (user) {
      return dbTasks.find({
        userId: user._id,
      }, {
        fields: ['completed', 'history'],
      }).then(tasks => tasks.some(task => task.completed || (task.history && task.history.length > 0)));
    },
    requires: null,
  },

  // 2
  {
    check: function hasAddedEditedTask (user) {
      return dbTasks.find({
        userId: user._id,
      }, {
        fields: ['createdAt'],
      }).then(tasks => tasks.some(task => moment(task.createdAt).isAfter(moment(user.auth.timestamps.created).add(1, 'minutes'))));
    },
    requires: null,
  },

  // 3
  {
    check: function hasSetReminder (user) {
      return dbTasks.find({
        userId: user._id,
      }, {
        fields: ['reminders'],
      }).then(tasks => tasks.some(task => (task.reminders ? task.reminders.length > 0 : false)));
    },
    requires: null,
  },

  // 4
  {
    check: function hasBoughtReward (user) {
      // Return a promise even if no async op is necessary for consistency
      return new Promise(resolve => {
        const { owned } = user.items.gear;
        const ownedKeys = Object.keys(owned);

        // Skip special items and the ones set to false
        // See if the user bought anything else (at least one item set to true)
        const hasNotBoughtAReward = ownedKeys
          .filter(k => k.indexOf('_special_'))
          .every(k => !owned[k] /* !false -> true -> OK because means not bought */);

        const hasBoughtAReward = !hasNotBoughtAReward;

        resolve(hasBoughtAReward);
      });
    },
    requires: 1,
  },

  // 5
  {
    check: function hasJoinedGuild (user) {
      // Return a promise even if no async op is necessary for consistency
      return new Promise(resolve => {
        resolve(user.guilds && user.guilds.length > 0);
      });
    },
    requires: null,
  },

  // 6
  {
    check: function hasPostedGuildMessage (user) {
      return dbGroups.find({
        _id: { $in: user.guilds || [] },
      }).then(guilds => guilds.some(guild => (guild.chat || []).some(msg => (msg ? msg.uuid === user._id : false))));
    },
    requires: 5,
  },

  // 7
  {
    check: function hasJoinedParty (user) {
      // Return a promise even if no async op is necessary for consistency
      return new Promise(resolve => {
        resolve(Boolean(user.party._id));
      });
    },
    requires: null,
  },
];

const mapCodeToEmail = {
  1: 'check-off-task',
  2: 'add-edit-task',
  3: 'set-reminder',
  4: 'buy-reward',
  5: 'join-guild',
  6: 'post-message-guild',
  7: 'join-party',
};

const pushNotificationsMap = {
  1: {
    title: 'Check off a task!',
    messages: [
      'Hey <%= name %>! Don\'t forget to check off tasks to earn gold and experience!',
      'Have you done any tasks yet, <%= name %>? Don\'t forget to check them off for gold and experience!',
      '<%= name %>, want gold and experience? Do a task and check it off!',
    ],
  },
  2: {
    title: 'Customize your tasks!',
    messages: [
      'Hi <%= name %>, customize your task list by adding or editing tasks!',
      'Hi <%= name %>, what tasks do you want to add? Make some new ones, or edit existing ones!',
      'Hi <%= name %>, don\'t forget to customize your tasks! What do you want to work on?',
    ],
  },
  3: {
    title: 'Set a task reminder!',
    messages: [
      '<%= name %>, do you want us to remind you about your tasks? Just tap to add a reminder!',
      'Hi <%= name %>! Don\'t forget to set reminders for your tasks so you remember to do them. Just tap a task to add one.',
      'Hi <%= name %>! Don\'t forget to add reminders for your task so you can earn gold and experience! Just tap a task to add one.',
    ],
  },
  4: {
    title: 'Buy a reward!',
    messages: [
      '<%= name %>, you have new rewards waiting for you! Go spend your hard-earned gold.',
      'Hi <%= name %>, don\'t forget to spend your hard-earned gold on rewards!',
      'Have you seen the rewards you can earn by completing your tasks? Go check them out!',
    ],
  },
  5: {
    title: 'Check out guilds!',
    messages: [
      'Hi <% name %>! Try joining a Guild for support!',
      'Hi <% name %>, get support with your tasks by joining a Guild!',
      'Hey <% name %>! If you want support in your quest for self-improvement, you should check out some Guilds.',
    ],
  },
  6: {
    title: 'Post in your guild!',
    messages: [
      'Hi <%= name %>, don\'t be shy! Introduce yourself to the members of the <%= guildName %> Guild.',
      'Hi <%= name %>, have you posted in the <%= guildName %> Guild yet? People are eager to share tips!',
      'Hi <%= name %>, don\'t forget to post a message in the <%= guildName %> Guild to introduce yourself and get motivated!',
    ],
  },
  7: {
    title: 'Join a Party with friends!',
    messages: [
      '<%= name %>, don\'t quest alone! Invite your friends to battle monsters with you.',
      '<%= name %>, want to battle monsters with your friends? Invite them to be in a party with you!',
      'Hi <%= name %>, invite your friends to your party to stay accountable and fight monsters!',
    ],
  },
};

function sendEmail (user, email) {
  return dbUsers.update({ // update user to signal that the email has been sent
    _id: user._id,
  }, {
    $set: {
      'flags.onboardingEmailsPhase': `${email}-${Date.now()}`,
    },
  }).then(() => {
    const toData = getToData(user);
    const step = email[0];

    // If the email is disabled, don't send it
    if (DISABLED_EMAILS.indexOf(Number(step)) !== -1) return new Promise(resolve => resolve());

    console.log('Sending onboarding email: ', `onboarding-${mapCodeToEmail[step]}-1`, ' to: ', user._id);

    return new Promise((resolve, reject) => {
      queue.create('email', {
        emailType: `onboarding-${mapCodeToEmail[step]}-1`, // needed to correctly match the template
        to: [toData],
        // Manually pass BASE_URL as emails are sent from here and not from the main server
        variables: [{ name: 'BASE_URL', content: baseUrl }],
        personalVariables: getPersonalVariables(toData),
      })
        .priority('high')
        .attempts(5)
        .backoff({ type: 'fixed', delay: 60 * 1000 }) // try again after 60s
        .save(err => {
          if (err) return reject(err);
          return resolve();
        });
    });
  });
}

function sendPushNotification (user, notification) {
  // step-phase
  const step = notification[0];
  const phase = notification[2];

  const notificationDetails = pushNotificationsMap[step];
  const random = lodash.random(0, 3); // 0, 1, 2, 3 // 3 means Version D, no notification
  const version = ['A', 'B', 'C', 'D'][random];

  return dbUsers.update({ // update user to signal that the email has been sent
    _id: user._id,
  }, {
    $set: {
      'flags.onboardingEmailsPhase': `${notification}-${Date.now()}`,
      '_ABTests.onboardingPushNotification': `Onboarding-Step${step}-Phase${phase}-Version${version}`,
    },
  }).then(() => {
    const toData = getToData(user);

    console.log('Sending onboarding notifications: ', `onboarding-${mapCodeToEmail[notification[0]]}-1`, ' to: ', user._id);

    if (version === 'D') return false; // Version D means no push notification

    if (step === 6) { // load guild info
      return dbGroups.findOne({
        _id: { $in: user.guilds || [] },
      }, 'name').then(guild => {
        sendNotification(user, {
          identifier: `onboarding-${notification}`,
          title: notificationDetails.title,
          message: lodash.template(notificationDetails.messages[random])(lodash.assign({ guildName: guild.name }, toData)),
        });
      });
    }
    sendNotification(user, {
      identifier: `onboarding-${notification}`,
      title: notificationDetails.title,
      message: lodash.template(notificationDetails.messages[random])(toData),
    });
    return true;
  });
}

// user has received all possible emails, set it to the latest possible step and phase
function stopOnboarding (user) {
  return dbUsers.update({ // update user to signal that the email has been sent
    _id: user._id,
  }, {
    $set: {
      // length - 1 to account for the first element in the steps array being empty
      'flags.onboardingEmailsPhase': `${steps.length - 1}-b-${Date.now()}`,
    },
  });
}

// see if user has completed step and in case send email
function hasCompletedStep (user, lastStep, lastPhase) {
  const step = steps[lastStep];
  let stepToSend;
  let phaseToSend;

  return step.check(user).then(result => {
    if (result === false) { // user has not completed last step
      if (lastPhase === undefined) { // hasn't received any email yet
        // send first email (lastPhase undefined means no email received) with phase a
        stepToSend = lastStep;
        phaseToSend = 'a';
      } else if (lastPhase === 'b') { // has already received two emails
        if (lastStep === 7) return stopOnboarding(user); // has received all emails, stop
        return hasCompletedStep(user, lastStep + 1); // try next email
      } else if (lastPhase === 'a') {
        // re-send current email with phase b
        stepToSend = lastStep;
        phaseToSend = 'b';
      } else { // something went wrong
        throw new Error(`Invalid onboarding email for user ${user._id}.`);
      }
    } else { // has completed step
      if (lastStep === 7) return stopOnboarding(user); // has received all emails, stop
      return hasCompletedStep(user, lastStep + 1); // try next email
    }

    // first check if the step has any requirement
    const requirement = steps[stepToSend].requires;
    if (requirement) { // see if requirement is fulfilled
      return steps[requirement].check(user).then(hasCompletedRequirement => {
        if (hasCompletedRequirement) return sendEmail(user, `${stepToSend}-${phaseToSend}`); // send email
        // try next email because requirement is not fulfilled
        return hasCompletedStep(user, stepToSend + 1);
      });
    }
    return phaseToSend === 'a'
      ? sendPushNotification(user, `${stepToSend}-${phaseToSend}`)
      : sendEmail(user, `${stepToSend}-${phaseToSend}`);
  });
}

// Process a user and see if an onboarding email must be sent.
// user.flags.onboardingEmailsPhase is a string used to store the last onboarding email sent
// Possible values are:
// '1-phase-date' - Score a task
// '2-phase-date' - Set a reminder
// '3-phase-date' - Add / Edit a task
// '4-phase-date' - Buy a reward
// '5-phase-date' - Join a guild
// '6-phase-date' - Post a message in a guild
// '7-phase-date' - Join a party
//
// The number indicates the last email sent,
// phase is 'a' or 'b' and indicated if the first or second email for the phase was sent
// date indicates when the last email was sent.
function processUser (user) {
  const yesterday = moment().subtract(24, 'hours');
  const lastOnboarding = user.flags.onboardingEmailsPhase;
  let lastStep;
  let lastPhase = undefined; // eslint-disable-line no-undef-init

  if (moment(user.auth.timestamps.created).isAfter(yesterday)) { // Do not send email until 24 hours after account creation
    return false;
  } if (!lastOnboarding) {
    lastStep = 1;
  } else {
    const lastOnboardingSplit = lastOnboarding.split('-');

    [lastStep, lastPhase] = lastOnboardingSplit;
    const lastDate = moment(Number(lastOnboardingSplit[2]));

    if (lastDate.isAfter(yesterday)) {
      return false; // Wait 24 hours between an email and the next
    }
  }

  if (lastStep === 7 && lastPhase === 'b') return false; // user has got all possible emails

  return hasCompletedStep(user, lastStep, lastPhase);
}

function findAffectedUsers ({ twoWeeksAgo, lastUserId }) {
  const query = {
    // Fetch all users that signed up in the last two weeks
    'auth.timestamps.created': {
      $gte: twoWeeksAgo,
    },

    'preferences.emailNotifications.unsubscribeFromAll': { $ne: true },
    'preferences.emailNotifications.onboarding': { $ne: false },
  };

  if (lastUserId) {
    query._id = {
      $gt: lastUserId,
    };
  }

  console.log('Running query: ', query);

  let usersFoundNumber; // the number of found users: 5 -> some missing, <5 -> all have been processed
  let newLastId;

  return dbUsers.find(query, {
    sort: { _id: 1 },
    limit: USERS_BATCH,
  }).then(users => {
    usersFoundNumber = users.length;
    newLastId = usersFoundNumber > 0 ? users[usersFoundNumber - 1]._id : null; // the user if of the last found user

    return Promise.all(users.map(user => processUser(user)));
  }).then(() => {
    if (usersFoundNumber === USERS_BATCH) {
      return findAffectedUsers({ // Find and process another batch of users
        twoWeeksAgo,
        newLastId,
      });
    }
    return false;
    // Finish the job
  });
}

function scheduleNextJob () {
  console.log('Scheduling new job');

  return new Promise((resolve, reject) => {
    queue
      .create('sendOnboardingEmails')
      .priority('critical')
      .delay(moment().add({ hours: 6 }).toDate() - new Date()) // schedule another job, 1 hour from now
      .attempts(5)
      .save(err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
  });
}

function onboardingEmailsWorker (job, done) {
  const jobStartDate = new Date();
  const twoWeeksAgo = moment(jobStartDate).subtract(14, 'days').toDate();
  let lastUserId; // id of the last processed user

  console.log('Start sending onboarding emails.');

  findAffectedUsers({
    twoWeeksAgo,
    lastUserId,
  })
    .then(scheduleNextJob) // All users have been processed, schedule the next job
    .then(() => {
      done();
    })
    .catch(err => { // The processing errored, crash the job and log the error
      done(err);
      console.log('Error while sending onboarding emails.', err);
    });
}

export default (parentQueue, parentDb, parentBaseUrl) => {
  queue = parentQueue; // Pass queue from parent module
  db = parentDb; // Pass db from parent module
  baseUrl = parentBaseUrl; // Pass baseUrl from parent module

  dbUsers = db.get('users', { castIds: false });
  dbTasks = db.get('tasks', { castIds: false });
  dbGroups = db.get('groups', { castIds: false });

  return onboardingEmailsWorker;
};
