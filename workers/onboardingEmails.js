const moment = require('moment');
const utils = require('../utils');

const USERS_BATCH = 5;

// Defined later
let queue;
let baseUrl;
let dbUsers;
let dbTasks;
let dbGroups;
let db;

function hasCheckedOffTask (user) {
  return dbTasks.find({
    userId: user._id,
  }, {
    fields: ['completed', 'history'],
  }).then(tasks => {
    return tasks.some(task => { // check if the user scored a task (history record exist or task is completed)
      return task.completed || task.history && task.history.length > 0;
    });
  });
}

function hasAddedEditedTask (user) {
  return dbTasks.find({
    userId: user._id,
  }, {
    fields: ['createdAt'],
  }).then(tasks => {
    return tasks.some(task => { // check if the user added a task (except the ones created at the same time of the account)
      return moment(task.createdAt).isAfter(moment(user.auth.timestamps.created).add(1, 'minutes'));
    });
  });
}

function hasSetReminder (user) {
  return dbTasks.find({
    userId: user._id,
  }, {
    fields: ['reminders'],
  }).then(tasks => {
    return tasks.some(task => { // check if any reminder on tasks has been set by the user
      return task.reminders ? task.reminders.length > 0 : false;
    });
  });
}

function hasBoughtReward (user) {
  let owned = user.items.gear.owned;
  let ownedKeys = Object.keys(owned);

  // Skip special items and the ones set to false
  // See if the user bought anything else (at least one item set to true)
  return ownedKeys
    .filter(k => k.indexOf('_special_'))
    .every(k => {
      return !owned[k]; // !false -> true -> OK because means not bought
    });
}

function hasJoinedGuild (user) {
  return user.guilds && user.guilds.length > 0;
}

function hasPostedGuildMessage (user) {
  return dbGroups.find({
    $in: user.guilds || [],
  }).then(guilds => {
    return guilds.some(guild => { // check if any message in guilds the user belongs to has been sent by the user
      return (guild.chat || []).some(msg => {
        return msg ? msg.uuid === user._id : false;
      });
    });
  });
}

function hasJoinedParty (user) {
  return Boolean(user.party._id);
}

let mapEmailCodeToEmail = {
  1: 'check-off-task',
  2: 'set-reminder',
  3: 'add-edit-task',
  4: 'buy-reward',
  5: 'join-guild',
  6: 'post-message-guild',
  7: 'join-party',
};

// TODO abstract
function getToData (user) {
  let email;
  let name;

  // Code taken from habitrpg/src/controllers/payments.js
  if (user.auth.local) {
    email = user.auth.local.email;
    name = user.profile.name || user.auth.local.username;
  } else if (user.auth.facebook && user.auth.facebook.emails && user.auth.facebook.emails[0] && user.auth.facebook.emails[0].value) {
    email = user.auth.facebook.emails[0].value;
    name = user.profile.name || user.auth.facebook.displayName || user.auth.facebook.username;
  } else if (user.auth.google && user.auth.google.emails && user.auth.google.emails[0] && user.auth.google.emails[0].value) {
    email = user.auth.google.emails[0].value;
    name = user.profile.name || user.auth.google.displayName || user.auth.google.username;
  }

  return {email, name, _id: user._id};
}

function getPersonalVariables (toData) {
  return [{
    rcpt: toData.email,
    vars: [
      {
        name: 'RECIPIENT_NAME',
        content: toData.name,
      },
      {
        name: 'RECIPIENT_UNSUB_URL',
        content: `/email/unsubscribe?code=${utils.encrypt(JSON.stringify({
          _id: toData._id,
          email: toData.email,
        }))}`,
      },
    ],
  }];
}

function sendEmail (email, user) {
  return dbUsers.update({ // update user to signal that the email has been sent
    _id: user._id,
  }, {
    $set: {
      'flags.onboardingEmailsPhase': `${email}-${Date.now()}`,
    },
  }).then(() => {
    let toData = getToData(user);

    console.log('Sending onboarding email: ', `onboarding-${mapEmailCodeToEmail[email[0]]}-1`, ' to: ', user._id);

    return new Promise((resolve, reject) => {
      queue.create('email', {
        emailType: `onboarding-${mapEmailCodeToEmail[email[0]]}-1`, // needed to correctly match the template
        to: [toData],
        // Manually pass BASE_URL as emails are sent from here and not from the main server
        variables: [{name: 'BASE_URL', content: baseUrl}],
        personalVariables: getPersonalVariables(toData),
      })
      .priority('high')
      .attempts(5)
      .backoff({type: 'fixed', delay: 60 * 1000}) // try again after 60s
      .save((err) => {
        if (err) return reject(err);
        resolve();
      });
    });
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
  let lastOnboarding = user.flags.onboardingEmailsPhase;
  let lastEmail;
  let lastPhase;

  if (!lastOnboarding) {
    lastEmail = mapEmailCodeToEmail['1'];
  } else {
    let lastOnboardingSplit = lastOnboarding.split('-');

    lastEmail = mapEmailCodeToEmail[lastOnboardingSplit[0]];
    lastPhase = lastOnboardingSplit[1];
    let lastDate = moment(lastOnboardingSplit[2]);

    let yesterday = moment().subtract(24, 'hours');

    if (lastDate.isAfter(yesterday) || moment(user.auth.timestamps.created).isAfter(yesterday)) {
      return; // Wait 24 hours between an email and the next or 24 hours after account creation
    }
  }


  let emailToSend;

  switch (lastEmail) {
    case 'check-off-task':
      // lastPhase can be undefined if no email has been sent yet
      if (lastPhase && lastPhase !== 'a') return sendEmail('2-a', user); // already got two emails, next one

      return hasCheckedOffTask(user).then(hasCheckedTask => {
        if (hasCheckedTask) { // next onboarding, has set reminder
          emailToSend = '2-a';
        } else {
          emailToSend = !lastPhase ? '1-a' : '1-b'; // send the first onboarding email
        }

        return sendEmail(emailToSend, user);
      });
    case 'set-reminder':
      if (lastPhase !== 'a') return sendEmail('3-a', user); // already got two emails, next one

      return hasSetReminder(user).then(hasReminder => {
        if (hasReminder) { // next onboarding, has set reminder
          emailToSend = '3-a';
        } else { // send again the same email
          emailToSend = '2-b';
        }

        return sendEmail(emailToSend, user);
      });
    case 'add-edit-task':
      if (lastPhase !== 'a') return sendEmail('4-a', user); // already got two emails, next one

      return hasAddedEditedTask(user).then(hasTask => {
        if (hasTask) { // next onboarding, has added task
          emailToSend = user.stats.gp > 0 ? '4-a' : '5-a'; // has enough gold to buy a reward? email 4 otherwise skip it
        } else { // send again the same email
          emailToSend = '3-b';
        }

        return sendEmail(emailToSend, user);
      });
    case 'buy-reward':
      if (hasBoughtReward(user) || lastPhase !== 'a') { // next onboarding, has bought reward or already got 2 emails
        emailToSend = '5-a';
      } else { // send again the same email
        emailToSend = '5-b';
      }

      return sendEmail(emailToSend, user);
    case 'join-guild':
      if (hasJoinedGuild(user)) { // next onboarding, has joined guild
        emailToSend = '6-a';
      } else if (lastPhase === 'a') { // send again the same email
        emailToSend = '5-b';
      } else { // if the 5-b has already been sent, skip 6 since it requires a guild
        emailToSend = '7-a';
      }

      return sendEmail(emailToSend, user);
    case 'post-message-guild':
      if (lastPhase !== 'a') return sendEmail('7-a', user); // already got two emails, next one

      return hasPostedGuildMessage(user).then(hasPosted => {
        if (hasPosted) { // next onboarding, has posted message
          emailToSend = '7-a';
        } else { // send again the same email
          emailToSend = '6-b';
        }

        return sendEmail(emailToSend, user);
      });
    case 'join-party':
      // onboarding finished, has joined a party or already got 2 emails about it
      if (hasJoinedParty(user) || lastPhase !== 'a') {
        return;
      } else { // send again the same email
        return sendEmail('7-b', user);
      }
    default:
      throw new Error(`Invalid last email ${lastEmail} for user ${user._id}`);
  }
}

function findAffectedUsers ({twoWeeksAgo, lastUserId}) {
  let query = {
    // Fetch all users that signed up in the last two weeks
    'auth.timestamps.created': {
      $gte: twoWeeksAgo,
    },

    'preferences.emailNotifications.unsubscribeFromAll': {$ne: true},
    'preferences.emailNotifications.onboarding': {$ne: false},
  };

  if (lastUserId) {
    query._id = {
      $gt: lastUserId,
    };
  }

  console.log('Running query: ', query);

  let usersFoundNumber; // the number of found users: 5 -> some missing, <5 -> all have been processed

  return dbUsers.find(query, {
    sort: {_id: 1},
    limit: USERS_BATCH,
  }).then(users => {
    usersFoundNumber = users.length;
    lastUserId = usersFoundNumber > 0 ? users[usersFoundNumber - 1]._id : null; // the user if of the last found user

    return Promise.all(users.map(user => {
      return processUser(user);
    }));
  }).then(() => {
    if (usersFoundNumber === USERS_BATCH) {
      return findAffectedUsers({ // Find and process another batch of users
        twoWeeksAgo,
        lastUserId,
      });
    } else {
      return; // Finish the job
    }
  });
}

function scheduleNextJob () {
  console.log('Scheduling new job');

  return new Promise((resolve, reject) => {
    queue
      .create('sendOnboardingEmails')
      .priority('critical')
      .delay(moment().add({hours: 1}).toDate() - new Date()) // schedule another job, 1 hour from now
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
  let jobStartDate = new Date();
  let twoWeeksAgo = moment(jobStartDate).subtract(14, 'days').toDate();
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
    console.log('Error while sending onboarding emails.', err);
    done(err);
  });
}

module.exports = (parentQueue, parentDb, parentBaseUrl) => {
  queue = parentQueue; // Pass queue from parent module
  db = parentDb; // Pass db from parent module
  baseUrl = parentBaseUrl; // Pass baseUrl from parent module

  dbUsers = db.get('users', { castIds: false });
  dbTasks = db.get('tasks', { castIds: false });
  dbGroups = db.get('groups', { castIds: false });

  return onboardingEmailsWorker;
};
