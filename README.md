The email server used to send all HabitRPG's emails.

Uses Mandrill as the email provider and Redis to persist jobs.

It can be configured renaming `config.json.example` to `config.json` and editing the variables there.

ATTENTION: running it on your local machine is not supported and we can't assure it'll work as expected, 
in particular the `workers/sendBatchEmails.js` file.