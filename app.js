// TODO proper logging
// TODO restore persisted states
// TODO housekeeping. Also need to rework state methods -
//      make them pushing to client a notification that user
//      with specified uid has been housekept.
// TODO simple sign up.
// TODO break into separate files/modules,
//      introduce config file.
// TODO brush up require section.
// TODO tests (unit, integration)
// TODO github
// TODO descibe solution design
// TODO see TODOs in the code...

var EventEmitter = require('events').EventEmitter;
var express = require('express');
var cookieParser = require('cookie-parser');
var session = require('express-session');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var sessionstore = require('sessionstore');
var sessStore = sessionstore.createSessionStore();
var redis = require('redis');

var initialAccount = 500;
var minIntervalBetweenItJobs = 1000;
var maxItJobsPerRequest = 5;
var itJobPrice = 10;
var energyCost = 5;
var energyBillInterval = 1000;

var secret = 'very$ecret815XYZ';

var crashing = function(callback, converter, nullable) {
	if (callback == null) {
		callback = function() {};
	}
	return function(err, reply) {
		if (err || !nullable && reply == null) {
			console.log(new Error(err).stack);
			process.exit(1);
		}
		process.nextTick(function() {
			callback(null, converter ? converter(reply) : reply);
		});
	};
};

var crashingNum = function(callback) {
	return crashing(callback, function(reply) { return Number(reply); });
};

var client = redis.createClient();
client.on('error', function (err) {
	console.log(new Error(err).stack);
	process.exit(1);
});

var states = {};

var newState = function(uid) {
	var key = 'user:' + uid;
	var emitter = new EventEmitter();

	var s = {};

	s.getAccount = function(callback) {
		client.hget(key, 'account', crashingNum(callback));
	};

	s.getLastItJobTimestamp = function(callback) {
		client.hget(key, 'lastItJobTimestamp', crashingNum(callback));
	};

	s.debit = function(amount) {
		client.hincrby(key, 'account', -amount, crashingNum(function(err, value) {
			emitter.emit('account', value);
		}));
	};

	s.on = function(event, listener) {
		emitter.on(event, listener);
	};

	s.removeListener = function(event, listener) {
		emitter.removeListener(event, listener);
	};

	// TODO use Redis scripting to guarantee atomicity
	s.payForItJob = function(amount) {
		var timestamp = new Number(new Date());
		s.getLastItJobTimestamp(function(err, reply) {
			if (timestamp - reply >= minIntervalBetweenItJobs) {
				if (amount > maxItJobsPerRequest) {
					amount = maxItJobsPerRequest;
				}
				client.multi()
					.hincrby(key, 'account', amount * itJobPrice)
					.hset(key, 'lastItJobTimestamp', timestamp)
					.exec(crashing(function(err, value) {
						emitter.emit('account', value);
					}, function(replies) { return Number(replies[0]); }));
			}
		});
	};

	// TODO use Redis scripting to guarantee atomicity
	s.chargeForEnergy = function() {
		s.getAccount(function(err, account) {
			var toDebit = Math.min(account, energyCost);
			if (toDebit > 0) {
				s.debit(toDebit);
			}
		});
	};

	s.activate = function() {
		setInterval(s.chargeForEnergy, energyBillInterval);
	};

	s.init = function() {
		client.hmset(key,
			'account', initialAccount,
			'lastItJobTimestamp', 0,
			crashing(s.activate)
		);
		return s;
	};

	return s;
};

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
			states[uid] = newState(uid).init();
		}
		next();
	});

	app.use(express.static(__dirname + '/public'));

	io.on('connection', function(socket) {
		cookieParser(secret, {})(socket.handshake, {}, function (parseErr) {
			var uid = socket.handshake.signedCookies['connect.sid'];
			var s = states[uid];
			if (s != null) {
				socket.on('itJobs', s.payForItJob);
				var accountListener = function(value) {
					socket.emit('account', value);
				};
				s.on('account', accountListener);
				socket.on('disconnect', function() {
					s.removeListener('account', accountListener);
				});
				s.debit(0);
			}
		});
	});

	http.listen(80, function() {
		console.log('listening on *:80');
	});
});
