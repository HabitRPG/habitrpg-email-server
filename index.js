var kue = require('kue'),
    express = require('express'),
    monk = require('monk'),
    url = require('url'),
    nconf = require('nconf');

nconf
  .argv()
  .env()
  .file({ file: __dirname + '/config.json' });

var app = express();

var baseUrl = 'https://habitrpg.com';

var db = monk(nconf.get('MONGODB_URL'));
db.options.multi = true;

var AWS = require('aws-sdk');

AWS.config.update({
  accessKeyId: nconf.get('AWS_ACCESS_KEY'),
  secretAccessKey: nconf.get('AWS_SECRET_KEY')
});

var kueRedisOpts = {
  port: nconf.get('REDIS_PORT'),
  host: nconf.get('REDIS_HOST')
};

if(nconf.get('NODE_ENV') === 'production'){
  var redisURL = url.parse(process.env.REDIS_URL);
  kueRedisOpts.auth = redisURL.auth.split(":")[1];
  kueRedisOpts.host = redisURL.hostname;
  kueRedisOpts.port = redisURL.port;
}

var queue = kue.createQueue({
  disableSearch: true,
  redis: kueRedisOpts
});

queue.process('email', 10, require('./workers/email'));
queue.process('sendBatchEmails', require('./workers/sendBatchEmails')(queue, db, baseUrl));
queue.process('sendWeeklyRecapEmails', require('./workers/sendWeeklyRecapEmails')(queue, db, baseUrl));
queue.process('amazonPayments', require('./workers/amazonPayments')(queue, db));

queue.promote();

queue.on('job complete', function(id, result){
  kue.Job.get(id, function(err, job){
    if(err) return;
    job.remove(function(err){
      if(err) throw err;
    });
  });
});

queue.on('job failed', function(){
  var args = Array.prototype.slice.call(arguments);
  args.unshift('Error processing job.');
  console.error.apply(console, JSON.stringify(args));
});

queue.watchStuckJobs();

process.once('uncaughtException', function(err){
  queue.shutdown(function(err2){
    process.exit(0);
  }, 9500);
});

process.once('SIGTERM', function(sig){
  queue.shutdown(function(err) {
    console.log('Kue is shutting down.', err || '');
    process.exit(0);
  }, 9500);
});

app.use(require('basic-auth-connect')(nconf.get('AUTH_USER'), nconf.get('AUTH_PASSWORD')));
app.use(kue.app);
app.listen(nconf.get('PORT'));
console.log('Server listening on port ' + nconf.get('PORT'));