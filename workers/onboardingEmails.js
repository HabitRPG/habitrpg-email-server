const moment = require('moment');

const USERS_BATCH = 5;

// Defined later
let queue;
let dbUsers;
let dbTasks;
let db;

function hasCheckedOffTask () {
}

function hasAddedEditedTask () {
}

function hasSetReminder () {
}

function hasBoughtReward () {
}

function hasJoinedGuild () {
}

function hasPostedGuildMessage () {
}

function hasJoinedParty () {
}

function processUser (user) {
  return user;
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
    if (usersFoundNumber < USERS_BATCH) {
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
  .catch(err => { // The processing errored, crash the job and log the error
    console.log('Error while sending onboarding emails.', err);
    done(err);
  });
}

module.exports = (parentQueue, parentDb) => {
  queue = parentQueue; // Pass queue from parent module
  db = parentDb; // Pass db from parent module

  dbUsers = db.get('users', { castIds: false });
  dbTasks = db.get('tasks', { castIds: false });

  return onboardingEmailsWorker;
};
