var CallActions = require('../actions/call-actions');
var ChannelStore = require('../stores/channel-store');
var AppStore = require('../stores/app-store');
var AppActions = require('../actions/app-actions');
// var Stopwatch = require('./stopwatch');
var WebRTC = require('./webrtc');
var getUserMedia = require('getusermedia');
var MediaManager = require('./media-manager');
var hark = require('hark');
var _ = require('underscore');

var ringInterval = 2000;
var ringTimeout = 30000;

var Calls = {
  actions: {
    'user.configuration':        'connectOrRequestPermissions',
    'user.mute':                 'muteLocalStream',
    'user.unmute':               'unmuteLocalStream',
    'session.destroy':           'disconnect',
    'session.error':             'disconnect',
    'socks.disconnected':        'disconnect',
    'app.quitting':              'disconnect',
    'app.request_audio_stream':  'requestStream',
    'me.channel.joined':         'meChannelJoined',
    'channel.leave':             'disconnect',
    'channel.created':           'connectOrRequestPermissions',
    'channel.found':             'connectOrRequestPermissions',
    'channel.deleted':           'channelDeleted',
    'channel.defunct':           'channelDeleted',
    'channel.cancelled':         'channelCancelled',
    'webrtc.disconnected':       'webrtcDisconnected',
    'webrtc.permissions_granted':'connectOrRequestPermissions'
  },
  
  reconnect_to: null,
  requesting_media: false,
  
  connectOrRequestPermissions: function() {
    if (AppStore.get('permission_granted')) {
      if (AppStore.get('has_configuration') && ChannelStore.get('id')) {
        CallActions.connect(ChannelStore.state);
      }
      
    } else if (!this.requesting_media) {
      this.permissions_timeout = setTimeout(this.showPermissionsDialog, 500);
      this.requesting_media = true;
      
      // we request userMedia here just to get the permission dialog
      // and then throw away the resulting stream
      getUserMedia({audio: true, video: true}, function(err, stream) {
        clearTimeout(this.permissions_timeout);
        this.requesting_media = false;
        
        if (err) {
          console.error(err);
          return CallActions.permissionsDialog(false);
        }
        
        if (stream) {
          var tracks = stream.getAudioTracks();
          if (tracks && tracks[0] && tracks[0].stop) tracks[0].stop();
        
          tracks = stream.getVideoTracks();
          if (tracks && tracks[0] && tracks[0].stop) tracks[0].stop();
        }
        CallActions.permissionsGranted(false);
      }.bind(this));
    }
  },

  getLocalStream: function() {
    return this.local_stream;
  },

  updateLocalStream: function(stream) {
    console.log('Calls:updateLocalStream');
    this.stopLocalStream();

    var context = MediaManager.getAudioContext();
    this.microphone = context.createMediaStreamSource(stream);

    // ensure new stream keeps our mute preference
    if (!AppStore.get('muted')) this.connectMicrophone();

    // begin processing new stream for speech events
    this.speech_events = hark(stream);
    this.speech_events.on('speaking', CallActions.startSpeaking);
    this.speech_events.on('stopped_speaking', CallActions.stopSpeaking);

    this.local_stream = stream;
  },

  connectMicrophone: function() {
    if (this.microphone) {
      this.microphone.connect(WebRTC.proxy_destination);
    }
  },

  stopLocalStream: function() {
    // stop processing incoming audio / speech
    if (this.speech_events) {
      this.speech_events.off('speaking');
      this.speech_events.off('stopped_speaking');
      this.speech_events.stop();
      delete this.speech_events;
    }

    // disconnect mediastream source node from proxy destination
    if (this.microphone) this.microphone.disconnect();

    // release hardware
    if (this.local_stream) {
      var tracks = this.local_stream.getAudioTracks();
      if (tracks && tracks[0] && tracks[0].stop) tracks[0].stop();
      
      delete this.local_stream;
    }
  },

  muteLocalStream: function() {
    // disconnects the microphone stream from the outgoing media
    if (this.microphone) this.microphone.disconnect();
  },

  unmuteLocalStream: function() {
    this.connectMicrophone();
  },

  requestStream: function(force) {
    if (force === true) this.activateMedia(true);
  },

  activateMedia: function(force) {
    console.log("Calls:activateMedia");

    if (!this.local_stream || force) {
      var self = this;
      
      MediaManager.getAudioConstraints(function(constraints){
        getUserMedia(constraints, function(err, stream) {
          if (err) {
            CallActions.permissionsDialog(false);
          } else {
            console.log("Calls:gotUserMedia");
            self.updateLocalStream(stream);
            CallActions.localStream({stream: stream});
          }
        });
      });
    }
  },

  showPermissionsDialog: function() {
    CallActions.permissionsDialog(true);
  },
  
  webrtcDisconnected: function(data) {
    console.log('Calls:webrtcDisconnected');
    if(this.reconnect_to) {
      CallActions.connect(this.reconnect_to);
      this.reconnect_to = null;
    }
  },

  channelJoin: function(data) {
    this.connect(data);
  },

  channelDeleted: function(data) {
    //TODO
  },

  connect: function(data) {
    // if (!Stopwatch.isRunning()) {
    //   // start the timer from receivers side
    //   Stopwatch.start({
    //     params: {
    //       channel_id: data.id,
    //       server: data.server,
    //       initiator: false
    //     },
    //     stop: function(timings) {
    //       // as the events are async and can be returned in any order we simply
    //       // provide the events that must be received in order to finish timing.
    //       return timings['me channel joined'] && timings['webrtc connected'];
    //     }
    //   });
    // }

    CallActions.connect(ChannelStore.state);
  },

  disconnect: function() {
    console.log("Calls:disconnect");

    this.stopLocalStream();
    CallActions.localStream({stream: null});
    CallActions.disconnect();
  },

  meChannelJoined: function(data) {
    // Stopwatch.mark('me channel joined');

    this.activateMedia();
  },

  dispatchAction: function(action, payload) {
    var callback = this.actions[action];

    if (callback) {
      if (this[callback]) {
        this[callback].call(this, payload);
      } else {
        throw new Error("Calls callback "+ callback +" does not exist for action " + action);
      }
    }
  }
};

module.exports = Calls;
