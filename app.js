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
// TODO implement serialization of transactions via locking
// TODO to fix: scanned ips disappear after page reload

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

var httpPort = 80;
var initialAccount = 75;
var minIntervalBetweenItJobs = 1000;
var maxItJobsPerRequest = 5;
var itJobPrice = 10;
var maxLevel = 80;
var scanResultsCount = 5;
var fullScanTime = 5000;
var energyUnitsPerSecond = 1;

var secret = 'very$ecret815XYZ';


var timeouts = {};
var timeoutsCounter = 1;

var schedule = function(callback, delay) {
	var current = timeoutsCounter++;
	timeouts[current] = setTimeout(function() {
		timeouts[current] = null;
		callback();
	}, delay);
	return current;
};

var unschedule = function(id) {
	clearTimeout(timeouts[id]);
	delete timeouts[id];
};

var crashing = function(callback, converter, nullable) {
	if (callback == null) {
		callback = function() {};
	}
	return function(err, reply) {
		if (err || !nullable && reply == null) {
			console.log(new Error(err).stack);
			process.exit(1);
		}
		callback(null, converter ? converter(reply) : reply);
	};
};

var crashingNum = function(callback) {
	return crashing(callback, function(reply) { return Number(reply); });
};

var crashingBool = function(callback) {
	return crashing(callback, function(reply) { return reply == 'true'; });
};

var crashingList = function(callback) {
	return crashing(callback, function(reply) { return reply == null ? [] : reply; }, true);
};

var redisClient = redis.createClient();
redisClient.on('error', function (err) {
	console.log(new Error(err).stack);
	process.exit(1);
});

var PersistenceClient = function(client) {
	var transformCb = function(a) {
		var cb = a[a.length - 1];
		if (cb instanceof Function) {
			var args = [].slice.call(a, 0, a.length - 1);
			return args.concat(crashing(cb));
		} else {
			return a;
		}
	};

	this.hgetNum = function(key, prop, callback) {
		client.hget(key, prop, crashingNum(callback));
	};
	this.hincrbyfloat = function(key, prop, delta, callback) {
		client.hincrbyfloat(key, prop, delta, crashingNum(callback));
	};
	this.lrange = function(key, start, stop, callback) {
		client.lrange(key, start, stop, crashingList(callback));
	};
	this.del = function(keys, callback) {
		client.del(keys, crashingNum(callback));
	};
	this.hmset = function() {
		client.hmset.apply(client, transformCb(arguments));
	};
	this.hmget = function() {
		client.hmget.apply(client, transformCb(arguments));
	};

	this.multi = function() {
		var redisMulti = client.multi();
		var multi;
		multi = {
			rpush: function() {
				redisMulti.rpush.apply(redisMulti, arguments); return multi;
			},
			hmset: function() {
				redisMulti.hmset.apply(redisMulti, arguments); return multi;
			},
			hmget: function() {
				redisMulti.hmget.apply(redisMulti, arguments); return multi;
			},
			hset: function() {
				redisMulti.hset.apply(redisMulti, arguments); return multi;
			},
			hincrbyfloat: function() {
				redisMulti.hincrbyfloat.apply(redisMulti, arguments); return multi;
			},
			exec: function(callback) {
				redisMulti.exec(crashing(callback, function(results) { return results; }));
			}
		};
		return multi;
	};

};

var client = new PersistenceClient(redisClient);

var VictimManager = function(client) {

	var normalRandom = function() {
		var x, y, s;
		do {
			x = Math.random() * 2 - 1;
			y = Math.random() * 2 - 1;
			s = x * x + y * y;
		} while (s == 0 || s > 1);
		return x * Math.sqrt(-2 * Math.log(s) / s);
	};

	var randomLevel = function(baseLevel) {
		var result = baseLevel + Math.round(normalRandom());
		result = Math.max(result, 1);
		return result;
	};

	var randomIp = function() {
		var getOctet = function() {
			return Math.round(Math.random() * 255);
		};
		return getOctet() + '.' + getOctet() + '.' + getOctet() + '.' + getOctet();
	};

	var newVictim = function(ip, baseLevel) {
		return {
			ip: ip,
			firewallLevel: randomLevel(baseLevel),
			antivirusLevel: randomLevel(baseLevel),
			passwordLevel: randomLevel(baseLevel),
			account: Math.abs(normalRandom() * 500)
		};
	};

	var store = function(victim, callback) {
		var scanResultsKey = 'victims';
			multi
				.rpush(scanResultsKey, r.ip)
				.hmset(scanResultsKey + ':' + r.ip,
					'firewallLevel', r.firewallLevel,
					'antivirusLevel', r.antivirusLevel,
					'passwordLevel', r.passwordLevel,
					'account', r.account);
			multi.exec(callback);
		});
	};

	var generateSingle;
	generateSingle = function(level, cb) {
		var ip = randomIp();
		client.exists(ip, function(err, value) {
			if (1 == value) {
				generateSingle(cb);
			} else {
				cb(null, newVictim(ip, level));
			}
		});
	};

	this.generate = function(qty, level, userId, cb) {
		var results = [];
		for (var i = 0; i < qty; i++) {
			generateSingle(level, function(err, victim) {
				store(victim, function() {
					results.push(victim);
					if (results.length == qty) {
						cb(null, results);
					}
				});
			});
		}
	};
};

var userStates = {};

var newUserState = function(uid) {
	var key = 'user:' + uid;
	var emitter = new EventEmitter();

	var s = {};

	var getLastItJobTimestamp = function(callback) {
		client.hgetNum(key, 'lastItJobTimestamp', callback);
	};

	s.debit = function(amount) {
		client.hincrbyfloat(key, 'account', -amount, function(err, value) {
			emitter.emit('account', value);
		});
	};

	var clearScanResults = function(callback) {
		var scanResultsKey = key + ':scanResults';
		client.lrange(scanResultsKey, 0, -1, function(err, ips) {
			if (ips.length > 0) {
				client.del([scanResultsKey].concat(ips.map(function(ip) { return scanResultsKey + ':' + ip; })), callback);
			} else {
				callback(null, 0);
			}
		});
	};

	var storeScanResults = function(results, callback) {
		var scanResultsKey = key + ':scanResults';
		clearScanResults(function(err, num) {
			var multi = client.multi();
			results.forEach(function(r) {
				multi
					.rpush(scanResultsKey, r.ip)
					.hmset(scanResultsKey + ':' + r.ip,
						'firewallLevel', r.firewallLevel,
						'antivirusLevel', r.antivirusLevel,
						'passwordLevel', r.passwordLevel);
			});
			multi.exec(callback);
		});
	};

	s.generateScanResults = function(callback) {
		var newScanResults = scanResults();
		storeScanResults(newScanResults, function() { callback(null, newScanResults); });
	};

	var getScanResults = function(cb) {
		var scanResultsKey = key + ':scanResults';
		client.lrange(scanResultsKey, 0, -1, function(err, ips) {
			var multi = client.multi();
			ips.forEach(function(ip) {
				multi.hmget(scanResultsKey + ':' + ip,
					'firewallLevel', 'antivirusLevel', 'passwordLevel');
			});
			var n = 0;
			multi.exec(function(err, results) {
				cb(null, results.map(function(e) { return {
					ip: ips[n++],
					firewallLevel: e[0],
					antivirusLevel: e[1],
					passwordLevel: e[2]
				}; }));
			});
		});
	};

	s.on = function(event, listener) {
		emitter.on(event, listener);
	};

	s.removeListener = function(event, listener) {
		emitter.removeListener(event, listener);
	};

	s.payForItJob = function(amount) {
		var timestamp = Date.now();
		getLastItJobTimestamp(function(err, reply) {
			if (timestamp - reply >= minIntervalBetweenItJobs) {
				if (amount > maxItJobsPerRequest) {
					amount = maxItJobsPerRequest;
				}
				client.multi()
					.hincrbyfloat(key, 'account', amount * itJobPrice)
					.hset(key, 'lastItJobTimestamp', timestamp)
					.exec(function(err, replies) { emitter.emit('account', Number(replies[0])); });
			}
		});
	};

	s.startProgress = function(progKey, fullTime, etaCallback) {
		client.hgetNum(key, progKey + ':id', function(err, progId) {
			if (!progId) {
				client.hgetNum(key, progKey + ':checkpoint:progress', function(err, checkpointProgress) {
					if (checkpointProgress > 100) {
						checkpointProgress = 100;
					}
					var eta = Math.round((100 - checkpointProgress) / 100 * fullTime);
					var progId = schedule(function() { etaCallback(progKey); }, eta);
					client.hmset(key,
						progKey + ':id', progId,
						progKey + ':eta', eta,
						progKey + ':fullTime', fullTime,
						progKey + ':state', 'running',
						progKey + ':checkpoint:timestamp', Date.now(),
						progKey + ':checkpoint:progress', checkpointProgress,
						function() {
							emitter.emit(progKey, {progress: checkpointProgress, eta: eta, state: 'running'});
						}
					);
				});
			}
		});
	};

	s.stopProgress = function(progKey, forcedProgress) {
		client.hgetNum(key, progKey + ':id', function(err, progId) {
			if (progId) {
				unschedule(progId);
				client.hmget(key,
					progKey + ':checkpoint:progress',
					progKey + ':checkpoint:timestamp',
					progKey + ':fullTime',
					function(err, results) {
						var checkpointProgress = Number(results[0]);
						var checkpointTimestamp = Number(results[1]);
						var fullTime = Number(results[2]);
						var now = Date.now();
						var progress = forcedProgress == null ?
							(now - checkpointTimestamp) / fullTime * 100 + checkpointProgress :
							forcedProgress;
						if (progress >= 100) {
							progress = 100;
						}
						client.hmset(key,
							progKey + ':id', 0,
							progKey + ':eta', 0,
							progKey + ':state', 'stopped',
							progKey + ':checkpoint:timestamp', now,
							progKey + ':checkpoint:progress', progress,
							function() {
								emitter.emit(progKey, {progress: progress, state: 'stopped'});
							}
						);
					});
			}
		});
	};

	var getProgress = function(progKey, cb) {
		client.hmget(key,
			progKey + ':checkpoint:progress',
			progKey + ':checkpoint:timestamp',
			progKey + ':fullTime',
			progKey + ':id',
			function(err, results) {
				var checkpointProgress = Number(results[0]);
				var checkpointTimestamp = Number(results[1]);
				var fullTime = Number(results[2]);
				var progId = Number(results[3]);
				var now = Date.now();
				var progress = (now - checkpointTimestamp) / fullTime * 100 + checkpointProgress;
				if (progress >= 100) {
					progress = 100;
				}
				var eta = Math.round((100 - progress) / 100 * fullTime);
				var result = {
					progress: progress,
					state: progId ? 'running' : 'stopped'
				};
				if (progId) {
					result.eta = eta;
				}
				cb(null, result);
			});	
	};

	s.getMainState = function(cb) {
		client.hgetNum(key, 'account', function(err, account) {
			getProgress('progress:scan', function(err, scanProgress) {
				getScanResults(function(err, scanResults) {
					cb(null, {
						account: account,
						scanProgress: scanProgress,
						scanResults: scanResults
					});
				});
			});
		});
	};

	var activate = function() {
		// TODO
	};

	var initProgress = function(progKey, multi) {
		multi.hmset(key,
			progKey + ':id', 0,
			progKey + ':eta', 0,
			progKey + ':checkpoint:timestamp', 0,
			progKey + ':checkpoint:progress', 0
		);
	};

	s.init = function() {
		var multi = client.multi();
		multi.hmset(key,
			'account', initialAccount,
			'lastItJobTimestamp', 0,
			'frozen', 0
		);
		initProgress('progress:scan', multi);
		multi.exec(activate);
		return s;
	};

	s.destroy = function() {
		// TODO
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
			userStates[uid] = newUserState(uid).init();
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
				var scanListener = function(value) {
					sock().emit('scan', value);
				};
				s.on('progress:scan', scanListener);

				var accountListener = function(value) {
					sock().emit('account', value);
				};
				s.on('account', accountListener);

				sock().on('itJobs', s.payForItJob);
				sock().on('scan', function() {
					s.startProgress('progress:scan', fullScanTime, function(progKey) {
						s.stopProgress(progKey, 0);
						s.generateScanResults(function(err, results) {
							sock().emit('scanResults', results);
						});
					});
				});
				sock().on('disconnect', function() {
					s.removeListener('account', accountListener);
					s.removeListener('progress:scan', scanListener);
					s.destroy();
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
