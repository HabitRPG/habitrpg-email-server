import nconf from 'nconf';
import PushNotifications from 'node-pushnotifications';
import Bluebird from'bluebird';
import AWS from'aws-sdk';

var push;

// Load APN certificate and key from S3
var APN_ENABLED = nconf.get('PUSH_CONFIGS:APN_ENABLED') === 'true';


if (APN_ENABLED) {
  if(nconf.get('NODE_ENV') === 'production') {
    var S3_BUCKET = nconf.get('S3:bucket');
    var S3 = new AWS.S3({
      accessKeyId: nconf.get('S3:accessKeyId'),
      secretAccessKey: nconf.get('S3:secretAccessKey'),
    });
    Bluebird.all([
      S3.getObject({
        Bucket: S3_BUCKET,
        Key: 'apple_apn/cert.pem',
      }).promise(),
      S3.getObject({
        Bucket: S3_BUCKET,
        Key: 'apple_apn/key.pem',
      }).promise(),
    ])
      .then(([certObj, keyObj]) => {
        var cert = certObj.Body.toString();
        var key = keyObj.Body.toString();
        configureApn(cert, key);
      });
  } else {
    configurePush('./cert.pem', './key.pem');
  }
}

function configurePush(cert, key) {
    const settings = {
        gcm: {
            id: null,
            phonegap: false, // phonegap compatibility mode, see below (defaults to false)
        },
        apn: {
            token: {
                key: key, // optionally: fs.readFileSync('./certs/key.p8')
                keyId: 'ABCD',
                teamId: 'EFGH',
            },
            production: false // true for APN production environment, false for APN sandbox environment,
        },
        isAlwaysUseFCM: false, // true all messages will be sent through node-gcm (which actually uses FCM)
    };
    push = new PushNotifications(settings);
}

function sendNotifications(users, details) {
  users.forEach(user => {
    sendNotification(user, details);
  })
}

function sendNotification (user, details) {
  if (!user) throw new Error('User is required.');
  var pushDevices = user.pushDevices;

  if (details === undefined) details = {};

  if (!details.identifier) throw new Error('details.identifier is required.');
  if (!details.title) throw new Error('details.title is required.');
  if (!details.message) throw new Error('details.message is required.');

  var payload = details.payload ? details.payload : {};
  payload.identifier = details.identifier;

  var ids = pushDevices.map(device => { 
    return device.regId;
  });
  push.send(registrationIds, {
        title: details.title,
        topic: 'com.habitrpg.ios.Habitica',
        body: details.message,
        sound: 'default',
        category: details.category,
        custom: payload
    }, (err, result) => {
        if (err) {
            console.log(err);
        }
    });

  pushDevices.forEach(pushDevice => {
    switch (pushDevice.type) {
      case 'android':
        // Required for fcm to be received in background
        payload.title = details.title;
        payload.body = details.message;

        if (fcmSender) {
          var message = new gcmLib.Message({
            data: payload,
          });

          fcmSender.send(message, {
            registrationTokens: [pushDevice.regId],
          }, 10, (err) => {
            if (err) console.log('FCM Error', err);
          });
        }
        break;

      case 'ios':
        if (apn) {
          apn.send({
            token: pushDevice.regId,
            alert: details.message,
            sound: 'default',
            category: details.category,
            payload,
          });
        }
        break;
    }
  });
}

export {
    sendNotifications,
    sendNotification,
};