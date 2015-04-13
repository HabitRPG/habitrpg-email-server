var moment = require('moment'),
    utils = require('../utils'),
    _ = require('lodash');

// Defined later
var queue, db, baseUrl, habitrpgUsers;

var worker = function(job, done){
  var habitrpgUsers = db.get('users');

  // FIXME Override the id function as otherwise it tries to convert non ObjectIDs to them
  habitrpgUsers.id = function (str) { return str; };

  var uuid = job.data.uuid;

  habitrpgUsers.findOne({
    _id: uuid,
    //preferences.sleep
  }, {
    fields: ['_id', 'auth', 'profile', 'lastCron', 'history', 'habits', 'dailys', 'todos']
  }, function(err, user){
    if(err) return done(err);
    if(!user) return done(new Error('User not found with uuid ' + uuid + ' (or in the inn)'));

    var variables = {};

    var lastCron = moment(user.lastCron);

    variables.END_DATE = lastCron.toDate();
    variables.START_DATE = moment(lastCron).subtract(7, 'days').toDate();

    // TODO break after first iteration
    user.history.exp.forEach(function(obj){
      if(!variables.XP_START){
        if(moment(obj.date).isSame(variables.START_DATE) || moment(obj.date).isAfter(variables.START_DATE)){
          variables.XP_START = obj.value;
        }
      }
    });

    variables.XP_END = user.history.exp[user.history.exp.length - 1].value;

    variables.TODOS_ADDED = 0;
    variables.TODOS_COMPLETED = 0;
    variables.OLDEST_TODO_COMPLETED_DATE = null;

    user.todos.forEach(function(todo){
      if(moment(todo.dateCreated).isAfter(variables.START_DATE) || moment(todo.dateCreated).isSame(variables.START_DATE)){
        variables.TODOS_ADDED++;
      }

      if(todo.dateCompleted && (moment(todo.dateCompleted).isAfter(variables.START_DATE) || moment(todo.dateCompleted).isSame(variables.START_DATE))){
        variables.TODOS_COMPLETED++;
        if(!variables.OLDEST_TODO_COMPLETED_DATE || moment(todo.dateCreated).isBefore(variables.OLDEST_TODO_COMPLETED_DATE)){
          variables.OLDEST_TODO_COMPLETED_DATE = moment(todo.dateCreated).toDate();
        }
      }
    });

    variables.HIGHEST_DAILY_STREAK = 0;

    user.dailys.forEach(function(daily){
      if(daily.streak > variables.HIGHEST_DAILY_STREAK){
        variables.HIGHEST_DAILY_STREAK = daily.streak;
      }
    });

    if(variables.HIGHEST_DAILY_STREAK === 0){
      variables.HIGHEST_DAILY_STREAK_MESSAGE = 'Don\'t despair! Apply yourself, and soon that number will be sky-high!';
    }else if(variables.HIGHEST_DAILY_STREAK < 20){
      variables.HIGHEST_DAILY_STREAK_MESSAGE = 'You\'re getting close to a 21-Day Streak Achievement! Don\'t give up!';
    }else if(variables.HIGHEST_DAILY_STREAK < 41){
      variables.HIGHEST_DAILY_STREAK_MESSAGE = 'Can you stack your 21-day Streak Achievement?';
    }else{
      variables.HIGHEST_DAILY_STREAK_MESSAGE = 'You\'re racking up the Streak Achievements! How high can you go?';
    }

    variables.WEAK_HABITS = 0;
    variables.STRONG_HABITS = 0;

    user.habits.forEach(function(habit){
      if(habit.value < 1){
        variables.WEAK_HABITS++;
      }else{
        variables.STRONG_HABITS++;
      }
    });

    if(variables.STRONG_HABITS > variables.WEAK_HABITS){
      variables.HABITS_MESSAGE = 'Uh oh! Work hard to turn those weak Habits blue!';
    }else if(variables.STRONG_HABITS < variables.WEAK_HABITS){
      variables.HABITS_MESSAGE = 'Well done! Keep attacking those Habits to keep them strong!';
    }else{
      variables.HABITS_MESSAGE = 'You\'re almost there! Work hard to tip the balance.';
    }

    variables = Object.keys(variables).map(function(key){
      return {name: key, content: variables[key]};
    });

    var toData = {_id: user._id};

    // Code taken from habitrpg/src/controllers/payments.js
    if(user.auth.local && user.auth.local.email){
      toData.email = user.auth.local.email;
      toData.name = user.profile.name || user.auth.local.username;
    }else if(user.auth.facebook && user.auth.facebook.emails && user.auth.facebook.emails[0] && user.auth.facebook.emails[0].value){
      toData.email = user.auth.facebook.emails[0].value;
      toData.name = user.profile.name || user.auth.facebook.displayName || user.auth.facebook.username;
    }

    variables = [{
      rcpt: toData.email,
      vars: variables.concat([{
        name: 'RECIPIENT_UNSUB_URL',
        content: baseUrl + '/unsubscribe?code=' + utils.encrypt(JSON.stringify({
          _id: toData._id,
          email: toData.email
        }))
      }])
    }];

    if(toData.email){
      queue.create('email', {
        emailType: 'weekly-recap',
        to: toData,
        // Manually pass BASE_URL and EMAIL_SETTINGS_URL as they are sent from here and not from the main server
        variables: [{name: 'BASE_URL', content: baseUrl}],
        personalVariables: variables
      })
      .priority('high')
      .attempts(5)
      .backoff({type: 'fixed', delay: 60*1000})
      .save(function(err){
        if(err) return done(err);
        done();
      });
    }
  });
}

module.exports = function(parentQueue, parentDb, parentBaseUrl){
  queue = parentQueue; // Pass queue from parent module
  db = parentDb; // Pass db from parent module
  baseUrl = parentBaseUrl; // Pass baseurl from parent module
  
  return worker;
}
