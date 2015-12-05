var moment = require('moment'),
    utils = require('../utils'),
    _ = require('lodash'),
    uuidGen = require('uuid'),
    AWS = require('aws-sdk'),
    Canvas = require('canvas'),
    Chart = require('nchart'),
    fs = require('fs'),
    async = require('async');

var s3 = new AWS.S3();

// Defined later
var queue, habitrpgUsers, baseUrl, db;

var worker = function(job, done){
  var jobStartDate, oneWeekAgo;
  var lastId;
  
  var findAffectedUsers = function(){
    var query = {
      'flags.lastWeeklyRecap': {
        $lt: oneWeekAgo 
      },

      'preferences.sleep': false,
      'preferences.emailNotifications.unsubscribeFromAll': {$ne: true},
      'preferences.emailNotifications.weeklyRecaps': {$ne: false}
    };

    if(lastId){
      query._id = {
        $gt: lastId
      } 
    }

    console.log('Run query', query);

    habitrpgUsers.find(query, {
      sort: {_id: 1},
      limit: 10,
      fields: ['_id', 'auth', 'profile', 'lastCron', 'history', 'habits', 'dailys', 'todos', 'flags.weeklyRecapEmailsPhase']
    }, function(err, docs){
        if(err) return done(err);

        // When there are no users to process, schedule next job & end this one
        if(docs.length === 0){
          queue.create('sendWeeklyRecapEmails')
          .priority('critical')
          .delay(moment(jobStartDate).add({hours: 1}).toDate() - new Date())
          .attempts(5)
          .save(function(err){
            return err ? done(err) : done();
          });
          return;
        }

        lastId = docs.length > 0 ? docs[docs.length - 1]._id : null;

        var currentUserId;

        async.each(docs, function(user, cb){
          try{
            console.log('Processing', user._id);

            // When a user has not enough data, set his flags.lastWeeklyRecap
            // to 6 days agoso we process it a day later
            var handleUserWithoutData = function(){
              habitrpgUsers.update(
                {
                  _id: user._id
                },
                {
                  $set: {
                    'flags.lastWeeklyRecap': moment(jobStartDate).subtract(6, 'days').toDate()
                  }
                }, function(e, res){
                  if(e) return cb(e);

                  return cb();
                });              
            };

            currentUserId = user._id; // FIXME for debugging

            var variables = {};

            var lastCron = moment(user.lastCron);

            var END_DATE = lastCron;
            var START_DATE = moment(lastCron).subtract(7, 'days');

            variables.END_DATE = END_DATE.format('dddd, MMMM Do YYYY');
            variables.START_DATE = START_DATE.format('dddd, MMMM Do YYYY');
            
            var XP_START, XP_END, XP_START_INDEX;

            if(user.history.exp.length === 0 ||
               user.todos.length === 0 ||
               user.habits.length === 0){
              return handleUserWithoutData();
            }

            // TODO this assumes exp history is sorted from least to most recent
            XP_START = _.find(user.history.exp, function(obj, i){
              if(moment(obj.date).isSame(START_DATE) || moment(obj.date).isAfter(START_DATE)){
                XP_START_INDEX = i;
                return true;
              }else{
                return false;
              }
            });

            if(!XP_START) return handleUserWithoutData();
            XP_START = XP_START.value;

            XP_END = user.history.exp[user.history.exp.length - 1];

            if(!XP_END) return handleUserWithoutData();
            XP_END = XP_END.value;

            variables.XP_EARNED = parseInt(XP_END - XP_START) || 0;
            if(variables.XP_EARNED === 0) return handleUserWithoutData();

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

            (user.dailys || []).forEach(function(daily){
              if(daily.streak > variables.HIGHEST_DAILY_STREAK){
                variables.HIGHEST_DAILY_STREAK = daily.streak;
              }
            });

            if(variables.HIGHEST_DAILY_STREAK === 0){
              variables.HIGHEST_DAILY_STREAK_MESSAGE = 1;
            }else if(variables.HIGHEST_DAILY_STREAK < 15){
              variables.HIGHEST_DAILY_STREAK_MESSAGE = 2;
            }else if(variables.HIGHEST_DAILY_STREAK < 20){
              variables.HIGHEST_DAILY_STREAK_MESSAGE = 3;
            }else if(variables.HIGHEST_DAILY_STREAK < 41){
              variables.HIGHEST_DAILY_STREAK_MESSAGE = 4;
            }else{
              variables.HIGHEST_DAILY_STREAK_MESSAGE = 5;
            }

            variables.WEAK_HABITS = 0;
            variables.STRONG_HABITS = 0;
            // minimum value a negative-only habit has to reach to be considered strong
            // taken from api.taskClasses in habitrpg/common/script/index.js (lower bound for neutral)
            var weakHabitCutoff = -1;

            user.habits.forEach(function(habit){
              // treat brightly yellow negative-only habits as strong
              if(habit.down === true && habit.up === false && habit.value >= weakHabitCutoff){
                variables.STRONG_HABITS++;
              }else if(habit.down === false && habit.up === false){
                  // ignore markerless habits (notes, separators etc.)
              }else{
                  // is the task at least of neutral value?
                  // taken from api.taskClasses in habitrpg/common/script/index.js (upper bound for neutral)
                  if(habit.value < 1){
                    variables.WEAK_HABITS++;
                  }else{
                    variables.STRONG_HABITS++;
                  }
              }
            });

            // TODO move all text to the template, using a code to identify them
            if(variables.STRONG_HABITS < variables.WEAK_HABITS){
              variables.HABITS_MESSAGE = 1;
            }else if(variables.STRONG_HABITS > variables.WEAK_HABITS){
              variables.HABITS_MESSAGE = 2;
            }else{
              variables.HABITS_MESSAGE = 3;
            }

            if(!user.flags.weeklyRecapEmailsPhase || !isNaN(user.flags.weeklyRecapEmailsPhase)){
              var phase = user.flags.weeklyRecapEmailsPhase || 0;
              variables.TIP_NUMBER = phase < 10 ? (phase + 1) : 10;
            }

            var xpGraphData = {
              labels: [],
              datasets: [{
                label: 'EXP history',
                fillColor: 'rgba(151,187,205,0.2)',
                strokeColor: 'rgba(151,187,205,1)',
                pointColor: 'rgba(151,187,205,1)',
                pointStrokeColor: '#fff',
                pointHighlightFill: '#fff',
                pointHighlightStroke: 'rgba(151,187,205,1)',
                data: []
              }]
            };

            // TODO be sure on how many values taken
            _.takeRight(user.history.exp, user.history.exp.length - XP_START_INDEX)
              .forEach(function(item){
                xpGraphData.labels.push(moment(item.date).format('MM/DD'));
                xpGraphData.datasets[0].data.push(item.value);
              });

            var xpCanvas = new Canvas(600, 300);
            var xpCanvasCtx = xpCanvas.getContext('2d');

            var xpChart = new Chart(xpCanvasCtx).Line(xpGraphData, {
              animation: false,
              scaleShowGridLines: false,
              scaleShowLabels: true,
              barShowStroke: true,
              barStrokeWidth: 2,
              showTooltips: false
            });

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

            var habitsCanvas = new Canvas(600, 300);
            var habitsCanvasCtx = habitsCanvas.getContext('2d');

            var habitsChart = new Chart(habitsCanvasCtx).Bar(habitsGraphData, {
              animation: false,
              scaleShowGridLines: false,
              scaleShowLabels: true,
              barShowStroke: true,
              barStrokeWidth: 2,
              showTooltips: false
            });

            variables.GRAPHS_UUID = uuidGen.v1().toString();

            var toData = {_id: user._id};

            // Code taken from habitrpg/src/controllers/payments.js
            if(user.auth.local && user.auth.local.email){
              toData.email = user.auth.local.email;
              toData.name = user.profile.name || user.auth.local.username;
            }else if(user.auth.facebook && user.auth.facebook.emails && user.auth.facebook.emails[0] && user.auth.facebook.emails[0].value){
              toData.email = user.auth.facebook.emails[0].value;
              toData.name = user.profile.name || user.auth.facebook.displayName || user.auth.facebook.username;
            }

            // If missing email, skip, don't break the whole process
            if(!toData.email) return handleUserWithoutData();

            async.parallel([
              function(cbParallel){
                xpCanvas.toBuffer(function(err, buf){
                  if(err) return cbParallel(err);

                  var params = {
                    Bucket: 'habitica-assets',
                    Key: ('emails/weekly-recap-graphs/xp-' + variables.GRAPHS_UUID + '.png'),
                    Body: buf,
                    StorageClass: 'REDUCED_REDUNDANCY'
                  };

                  s3.putObject(params, function(err, data){
                    if(err) return cbParallel(err);
                    xpChart.destroy();
                    cbParallel();
                  });
                });
              },

              function(cbParallel){
                habitsCanvas.toBuffer(function(err, buf){
                  if(err) return cbParallel(err);

                  var params = {
                    Bucket: 'habitica-assets',
                    Key: ('emails/weekly-recap-graphs/habits-' + variables.GRAPHS_UUID + '.png'),
                    Body: buf,
                    StorageClass: 'REDUCED_REDUNDANCY'
                  };

                  s3.putObject(params, function(err, data){
                    if(err) return cbParallel(err);
                    habitsChart.destroy();
                    cbParallel();
                  });
                });
              }
            ], function(err, res){
              if(err) return cb(err);

              // Update the recaptureEmailsPhase flag in the database for each user
              habitrpgUsers.update(
                {
                  _id: user._id
                },
                {
                  $inc: {
                    'flags.weeklyRecapEmailsPhase': 1
                  },
                  $set: {
                    'flags.lastWeeklyRecap': jobStartDate
                  }
                }, function(e, res){
                  if(e) return cb(e);

                  variables = Object.keys(variables).map(function(key){
                    return {name: key, content: variables[key]};
                  });

                  variables = [{
                    rcpt: toData.email,
                    vars: variables.concat([
                      {
                        name: 'RECIPIENT_UNSUB_URL',
                        content: '/unsubscribe?code=' + utils.encrypt(JSON.stringify({
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

                  queue.create('email', {
                    emailType: 'weekly-recap',
                    to: toData,
                    tags: ['weekly-recap-phase-' + ((user.flags.weeklyRecapEmailsPhase || 0) + 1)],
                    // Manually pass BASE_URL and EMAIL_SETTINGS_URL as they are sent from here and not from the main server
                    variables: [{name: 'BASE_URL', content: baseUrl}],
                    personalVariables: variables
                  })
                  .priority('high')
                  .attempts(5)
                  .backoff({type: 'fixed', delay: 60*1000})
                  .save(function(err){
                    if(err) return cb(err);
                    cb();
                  });
                });
            });
          }catch(e){
            //FIXME
            console.error(e, 'ERROR PROCESSING WEEKLY RECAP for user ', currentUserId);
            cb();
          }
        }, function(err){
          if(err) return done(err);
          if(docs.length === 10){
            findAffectedUsers();
          }else{
            queue.create('sendWeeklyRecapEmails')
            .priority('critical')
            .delay(moment(jobStartDate).add({hours: 1}).toDate() - new Date())
            .attempts(5)
            .save(function(err){
              return err ? done(err) : done();
            });
          }
        });
    });
  }

  console.log('Start sending weekly recap emails.');
  jobStartDate = new Date();
  oneWeekAgo = moment(jobStartDate).subtract(7, 'days').toDate();
  findAffectedUsers();
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
