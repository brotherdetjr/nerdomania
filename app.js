// TODO proper logging
// TODO restore persisted states
// TODO housekeeping. Also need to rework state methods -
//      make them pushing to redisDao a notification that user
//      with specified uid has been housekept.
// TODO simple sign up.
// TODO break into separate files/modules,
//      introduce config file.
// TODO brush up require section.
// TODO tests (unit, integration)
// TODO descibe solution design
// TODO see TODOs in the code...
// TODO implement serialization of transactions via locking
var pongular = require('pongular').pongular;
var express = require('express');
var cookieParser = require('cookie-parser');
var session = require('express-session');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var sessionstore = require('sessionstore');
var sessStore = sessionstore.createSessionStore();

pongular
.module('app', [])
.value('redisClient', require('redis').createClient())
.uses('*.js');

var injector = pongular.injector(['app']);
injector.invoke(['userStateFactory', function(userStateFactory) {

var httpPort = 80;
var secret = 'very$ecret815XYZ';

var userStates = {};

sessStore.on('connect', function() {

	app.use(cookieParser());

	app.use(session({
		secret: secret,
		saveUninitialized: true,
		resave: true,
		store: sessStore
	}));

	app.use(function(req, res, next) {
		var uid = req.session.id;
		if (req.session.uid == null) {
			req.session.uid = uid;
			console.log('Anonymous user connected. Assigned uid: %s', uid);
			userStates[uid] = userStateFactory(uid).init();
		}
		next();
	});

	app.use(express.static(__dirname + '/public'));

	var userSockets = {};

	io.on('connection', function(socket) {

		cookieParser(secret, {})(socket.handshake, {}, function (parseErr) {
			var uid = socket.handshake.signedCookies['connect.sid'];
			var s = userStates[uid];
			userSockets[uid] = socket;
			var sock = function() { return userSockets[uid]; };
			if (s != null) {
				var scanProgress = s.progress('progress:scan');
				var scanListener = function(value) {
					sock().emit('scan', value);
					if (value.progress >= 100) {
						scanProgress.setValue(0, function() {
							s.scan(function(err, results) {
								sock().emit('scanResults', results);
							});
						});
					}
				};
				scanProgress.on('update', scanListener);

				var accountListener = function(value) {
					sock().emit('account', value);
				};
				s.on('account', accountListener);

				sock().on('itJobs', function(amount) { s.payForItJob(amount); });
				sock().on('scan', function() {
					scanProgress.start();
				});
				sock().on('startHacking', function(ip) {
					s.startHacking(ip);
				});
				sock().on('stopHacking', function(ip) {
					s.stopHacking(ip);
				});
				var hackingListener = function(evt) {
					sock().emit('hacking', evt);
				};
				s.on('hacking', hackingListener);
				sock().on('moveToHacking', function(ip) {
					s.moveToHacking(ip, function() {
						sock().emit('movedToHacking', ip);
					});
				});
				sock().on('removeFromHacking', function(ip) {
					s.removeFromHacking(ip, function() {
						socket.emit('removedFromHacking', ip);
					});
				});
				sock().on('disconnect', function() {
//					scanProgress.removeListener('update', scanListener);
					s.removeListener('account', accountListener)
					.removeListener('hacking', hackingListener)
					.destroy();
					delete userSockets[uid];
				});

				s.getMainState(function(err, state) {
					sock().emit('mainState', state);
				});
			}
		});
	});

	http.listen(httpPort, function() {
		console.log('listening on *:%d', httpPort);
	});
});

}]);
