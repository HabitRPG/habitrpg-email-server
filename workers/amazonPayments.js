// Defined later
var db, habitrpgUsers;

var worker = function(job, done){
  habitrpgUsers = db.get('users');


}

module.exports = function(parentDb){
  db = parentDb; // Pass db from parent module
  
  return worker;
}
