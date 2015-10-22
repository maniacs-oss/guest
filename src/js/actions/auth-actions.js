var AppDispatcher = require('../dispatcher/app-dispatcher');
var Bulldog = require('../libs/bulldog');
var History = require('../libs/thepast');

var AuthActions = {
  signout: function(input) {
    AppDispatcher.dispatch('session.destroy');
    History.replaceState(null, '/login')
  },
  
  signin: function(input) {
    Bulldog.createSessionFromEmailPassword(input);
  }
};

module.exports = AuthActions;
