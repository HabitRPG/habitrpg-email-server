var moment = require('moment'),
    utils = require('../utils'),
    _ = require('lodash'),
    uuidGen = require('uuid'),
    AWS = require('aws-sdk'),
    canvas = require('canvas'),
    Chart = require('nchart'),
    fs = require('fs'),
    async = require('async');

var s3 = new AWS.S3();

// Defined later
var queue, habitrpgUsers, baseUrl, db;

var worker = function(job, done){
  var uuid = job.data.uuid;

  habitrpgUsers.findOne({
    _id: uuid,
    //preferences.sleep
  }, {
    fields: ['_id', 'auth', 'profile', 'lastCron', 'history', 'habits', 'dailys', 'todos', 'flags.weeklyRecapEmailsPhase']
  }, function(err, user){
    if(err) return done(err);
    if(!user) return done(new Error('User not found with uuid ' + uuid + ' (or in the inn)'));

    var variables = {};

    var lastCron = moment(user.lastCron);

    var END_DATE = lastCron;
    var START_DATE = moment(lastCron).subtract(7, 'days');

    variables.END_DATE = END_DATE.format('dddd, MMMM Do YYYY');
    variables.START_DATE = START_DATE.format('dddd, MMMM Do YYYY');
    
    var XP_START, XP_END, XP_START_INDEX;

    // TODO this assumes exp history is sorted from least to most recent
    XP_START = _.find(user.history.exp, function(obj, i){
      if(moment(obj.date).isSame(START_DATE) || moment(obj.date).isAfter(START_DATE)){
        XP_START_INDEX = i;
        return true;
      }else{
        return false;
      }
    }).value;

    XP_END = user.history.exp[user.history.exp.length - 1].value;

    variables.XP_EARNED = parseInt(XP_END - XP_START) || 0;

    variables.TODOS_ADDED = 0;
    variables.TODOS_COMPLETED = 0;
    variables.OLDEST_TODO_COMPLETED_DATE = null;

    user.todos.forEach(function(todo){
      if(moment(todo.dateCreated).isAfter(START_DATE) || moment(todo.dateCreated).isSame(START_DATE)){
        variables.TODOS_ADDED++;
      }

      if(todo.dateCompleted && (moment(todo.dateCompleted).isAfter(START_DATE) || moment(todo.dateCompleted).isSame(START_DATE))){
        variables.TODOS_COMPLETED++;
        if(!variables.OLDEST_TODO_COMPLETED_DATE || moment(todo.dateCreated).isBefore(variables.OLDEST_TODO_COMPLETED_DATE)){
          variables.OLDEST_TODO_COMPLETED_DATE = moment(todo.dateCreated).format("dddd, MMMM Do YYYY");
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
    }else if(variables.HIGHEST_DAILY_STREAK < 15){
      variables.HIGHEST_DAILY_STREAK_MESSAGE = 'Keep going, and you\'ll earn a 21-Day Streak Achievement!';
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

    // TODO move all text to the template, using a code to identify them
    if(variables.STRONG_HABITS < variables.WEAK_HABITS){
      variables.HABITS_MESSAGE = 'Uh oh! Work hard to turn those weak Habits blue!';
    }else if(variables.STRONG_HABITS > variables.WEAK_HABITS){
      variables.HABITS_MESSAGE = 'Well done! Keep attacking those Habits to keep them strong!';
    }else{
      variables.HABITS_MESSAGE = 'You\'re almost there! Work hard to tip the balance.';
    }

    if(!user.flags.weeklyRecapEmailsPhase || !isNan(user.flags.weeklyRecapEmailsPhase)){
      var phase = user.flags.weeklyRecapEmailsPhase || 0;
      variables.TIP_NUMBER = phase < 10 ? (phase + 1) : 10;
    }

    var xpGraphData = {
      labels: [],
      datasets: [{
        label: 'EXP history',
        fillColor: 'rgba(220,220,220,0.2)',
        strokeColor: 'rgba(220,220,220,1)',
        pointColor: 'rgba(220,220,220,1)',
        pointStrokeColor: '#fff',
        pointHighlightFill: '#fff',
        pointHighlightStroke: 'rgba(220,220,220,1)',
        data: []
      }]
    };

    // TODO be sure on how many values taken
    _.last(user.history.exp, user.history.exp.length - XP_START_INDEX)
      .forEach(function(item){
        xpGraphData.labesl.push(moment(item.date).format('dddd, MMMM Do YYYY'));
        xpGraphData.datasets[0].data.push(item.value);
      });

    var xpCanvas = new Canvas(1600, 800);
    var xpCanvasCtx = xpCanvas.getContext('2d');

    new Chart(ctx).Line(xpGraphData);

    var habitsGraphData = {
      labels: ['Weak Habits', 'Strong Habits'],
      datasets: [{
        label: 'Habits',
        fillColor: 'rgba(151,187,205,0.5)',
        strokeColor: 'rgba(151,187,205,0.8)',
        highlightFill: 'rgba(151,187,205,0.75)',
        highlightStroke: 'rgba(151,187,205,1)',
        data: [variables.WEAK_HABITS, variables.STRONG_HABITS]
      }]
    };

    var habitsCanvas = new Canvas(1600, 800);
    var habitsCanvasCtx = habitsCanvas.getContext('2d');

    new Chart(ctx).Line(habitsGraphData);

    variables.GRAPHS_UUID = uuidGen.v1();

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

    if(!toData.email){
      return done(new Error('Email unavalaible for uuid:' + uuid));
    }

    variables = [{
      rcpt: toData.email,
      vars: variables.concat([
        {
          name: 'RECIPIENT_UNSUB_URL',
          content: baseUrl + '/unsubscribe?code=' + utils.encrypt(JSON.stringify({
            _id: toData._id,
            email: toData.email
          }))
        },
        {
          name: 'RECIPIENT_NAME',
          content: toData.name
        }
      ])
    }];

    async.parallel([
      function(cb){
        xpCanvas.toBuffer(function(err, buf){
          if(err) return cb(err);

          var params = {
            Bucket: 'habitica-assets',
            Key: ('emails/weekly-recap-graphs/xp-' + variables.GRAPHS_UUID + '.png'),
            Body: buf,
            StorageClass: 'REDUCED_REDUNDANCY'
          };

          s3.putObject(params, function(err, data){
            if(err) return cb(err);
            cb();
          });
        });
      },

      function(cb){
        habitsCanvas.toBuffer(function(err, buf){
          if(err) return cb(err);

          var params = {
            Bucket: 'habitica-assets',
            Key: ('emails/weekly-recap-graphs/habits-' + variables.GRAPHS_UUID + '.png'),
            Body: buf,
            StorageClass: 'REDUCED_REDUNDANCY'
          };

          s3.putObject(params, function(err, data){
            if(err) return cb(err);
            cb();
          });
        });
      }
    ], function(err, res){
      if(err) return done(err);

      // Update the recaptureEmailsPhase flag in the database for each user
      habitrpgUsers.update(
        {
          _id: uuid
        },
        {
          $inc: {
            'flags.weeklyRecapEmailsPhase': 1
          }
        }, function(e, res){
          if(e) return done(e);

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
        });
    });
  });
}

module.exports = function(parentQueue, parentDb, parentBaseUrl){
  queue = parentQueue; // Pass queue from parent module
  db = parentDb; // Pass db from parent module
  baseUrl = parentBaseUrl; // Pass baseurl from parent module

  habitrpgUsers = db.get('users');

  // FIXME Override the id function as otherwise it always tries to convert to ObjectIds
  habitrpgUsers.id = function(str){ return str; };
  
  return worker;
}
