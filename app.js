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
var fullScanTime = 2000;

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
	return crashing(callback, function(reply) { return reply == 1; });
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
	this.lrem = function(key, count, sample, callback) {
		client.lrem(key, count, sample, crashingNum(callback));
	};
	this.hset = function(key, field, value, callback) {
		client.hset(keys, field, value, crashingBool(callback));
	};
	this.hmset = function() {
		client.hmset.apply(client, transformCb(arguments));
	};
	this.hmget = function() {
		client.hmget.apply(client, transformCb(arguments));
	};
	this.exists = function(key, callback) {
		client.exists(key, crashingBool(callback));
	};
	this.rpush = function() {
		client.rpush.apply(client, transformCb(arguments));
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
			hget: function() {
				redisMulti.hget.apply(redisMulti, arguments); return multi;
			},
			hincrbyfloat: function() {
				redisMulti.hincrbyfloat.apply(redisMulti, arguments); return multi;
			},
			lrem: function() {
				redisMulti.lrem.apply(redisMulti, arguments); return multi;
			},
			del: function() {
				redisMulti.del.apply(redisMulti, arguments); return multi;
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

	var round2 = function(num) {
		return Math.round(num * 100) / 100;
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
			account: Math.abs(round2(normalRandom() * 250 + 500))
		};
	};

	var save = function(victim, callback) {
		client.hmset('victims:' + victim.ip,
			'firewallLevel', victim.firewallLevel,
			'antivirusLevel', victim.antivirusLevel,
			'passwordLevel', victim.passwordLevel,
			'account', victim.account,
			callback);
	};

	var generateSingle;
	generateSingle = function(level, cb) {
		var ip = randomIp();
		client.exists(ip, function(err, value) {
			if (1 == value) {
				generateSingle(level, cb);
			} else {
				cb(null, newVictim(ip, level));
			}
		});
	};

	this.generate = function(qty, level, cb) {
		var results = [];
		for (var i = 0; i < qty; i++) {
			generateSingle(level, function(err, victim) {
				save(victim, function() {
					results.push(victim);
					if (results.length == qty) {
						cb(null, results);
					}
				});
			});
		}
	};

	this.remove = function(ips, callback) {
		if (!(ips instanceof Array)) {
			ips = [ips];
		}
		if (ips.length > 0) {
			client.del(ips.map(function(ip) { return 'victims' + ':' + ip; }), callback);
		} else {
			callback(null, 0);
		}
	};

	this.getVictims = function(ips, cb) {
		var multi = client.multi();
		ips.forEach(function(ip) {
			multi.hmget('victims:' + ip, 'firewallLevel', 'antivirusLevel', 'passwordLevel');
		});
		var n = 0;
		multi.exec(function(err, results) {
			cb(null, results.map(function(e) {
				return {
					ip: ips[n++],
					firewallLevel: e[0],
					antivirusLevel: e[1],
					passwordLevel: e[2]
				};
			}));
		});
	};

};

var victimManager = new VictimManager(client);

var userStates = {};

var newUserState = function(uid) {
	var key = 'user:' + uid;
	var emitter = new EventEmitter();

	var s = {};

	var getLastItJobTimestamp = function(callback) {
		client.hgetNum(key, 'lastItJobTimestamp', callback);
	};

	var clearScanResults = function(callback) {
		var scannedIpsKey = key + ':scannedIps';
		client.lrange(scannedIpsKey, 0, -1, function(err, ips) {
			victimManager.remove(ips, function() {
				client.del(scannedIpsKey, callback);
			});
		});
	};

	var saveScannedIps = function(ips, callback) {
		// TODO refactor client dao to make such calls as client.rpush(client, key + ':scannedIps', ips, callback);
		client.rpush.apply(client, [key + ':scannedIps'].concat(ips, callback));
	};

	s.scan = function(callback) {
		clearScanResults(function() {
			victimManager.generate(scanResultsCount, 1, function(err, victims) {
				saveScannedIps(victims.map(function(v) { return v.ip; }), function() {
					callback(null, victims);
				});
			});
		});
	};

	var getScanResults = function(cb) {
		client.lrange(key + ':scannedIps', 0, -1, function(err, ips) {
			victimManager.getVictims(ips, cb);
		});
	};

	var firstHackStage = 'firewall';

	var nextHackStage = function(stage) {
		if (stage == firstHackStage) {
			return 'antivirus';
		} else if (stage == 'antivirus') {
			return 'password';
		} else if (stage == 'password') {
			return 'account';
		} else {
			return null;
		}
	};

	var subscribeForHackingEvents = function(ip, stage) {
		emitter.on('progress:hacking:' + ip + ':' + stage, function(evt) {
			var nextStage = nextHackStage(stage);
			emitter.emit('hacking', {
				ip: ip,
				stage: stage,
				nextStage: nextStage,
				progress: evt.progress,
				state: evt.state,
				eta: evt.eta
			});
			if (evt.progress >= 100 && nextStage != null) {
				s.subscribeForHackingEvents(ip, nextStage);
			}
		});
	};

	s.moveToHacking = function(ip, cb) {
		subscribeForHackingEvents(ip, firstHackStage);
		client.lrem(key + ':scannedIps', 1, ip, function(err, removedCount) {
			if (removedCount > 0) {
				client.multi()
					.rpush(key + ':hacking', ip)
					.hset(key + ':hacking:' + ip, 'state', 'stopped')
					.exec(cb);
			}
		});
	};

	var unsubscribeFromHackingEvents = function(ip) {
		var stage = firstHackStage;
		while (stage != null) {
			emitter.removeAllListeners('progress:hacking:' + ip + ':' + stage);
			stage = nextHackStage(stage);
		}
	};

	s.getHackingStage = function(ip, cb) {
		// TODO
	};

	s.removeFromHacking = function(ip, cb) {
		unsubscribeFromHackingEvents(ip);
		client.multi()
			.lrem(key + ':hacking', 1, ip)
			.del(key + ':hacking:' + ip)
			.exec(function(err, result) {
				if (result[0] > 0) {
					victimManager.remove(ip, function() {
						cb(null, true);
					});
				}
			});
	};

	var getHacking = function(cb) {
		client.lrange(key + ':hacking', 0, -1, function(err, ips) {
			var multi = client.multi();
			ips.forEach(function(ip) {
				multi.hmget(key + ':hacking:' + ip,
					'state',
					'firewall:progress',
					'firewall:eta',
					'antivirus:progress',
					'antivirus:eta',
					'password:progress',
					'password:eta',
					'transfer:progress',
					'transfer:eta'
				);
			});
			var n = 0;
			multi.exec(function(err, hackingList) {
				victimManager.getVictims(ips, function(err, victims) {
					cb(null, hackingList.map(function(e) {
						return {
							ip: ips[n],
							state: e[0],
							firewall: {
								progress: e[1],
								eta: e[2],
								level: victims[n].firewallLevel
							},
							antivirus: {
								progress: e[3],
								eta: e[4],
								level: victims[n].antivirusLevel
							},
							password: {
								progress: e[5],
								eta: e[6],
								level: victims[n++].passwordLevel
							},
							transfer: {
								progress: e[7],
								eta: e[8]
							}
						};
					}));
				})
			});
		});
	};

	s.on = function(event, listener) {
		emitter.on(event, listener);
		return s;
	};

	s.removeListener = function(event, listener) {
		emitter.removeListener(event, listener);
		return s;
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

	var limitProgress = function(value) {
		if (value > 100) {
			value = 100;
		} else if (value < 0) {
			value = 0;
		}
		return value;
	};

	var setStateToStopped = function(progKey, cb) {
		client.hmset(key,
			progKey + ':id', 0,
			progKey + ':eta', 0,
			cb
		);
	};

	var scheduleFinish = function(progKey, eta) {
		return schedule(function() {
			setStateToStopped(progKey, function() {
				s.setProgress(progKey, 100);
			});
		}, eta);
	};

	s.setFullTime = function(progKey, fullTime, cb) {
		client.hset(key, progKey + ':fullTime', fullTime, cb);
	};

	var getCheckpointProgressAndFullTime = function(progKey, cb) {
		client.hgetNum(key, progKey + ':id', function(err, progId) {
			if (!progId) {
				client.hmget(key,
					progKey + ':checkpoint:progress',
					progKey + ':fullTime',
					function(err, results) {
						cb(null, {
							checkpointProgress: limitProgress(Number(results[0])),
							fullTime: Number(results[1])
						});
					}
				);
			}
		});
	};

	var startProgressAt = function(progKey, progress, eta) {
		client.hmset(key,
			progKey + ':id', scheduleFinish(progKey, eta),
			progKey + ':eta', eta,
			progKey + ':checkpoint:timestamp', Date.now(),
			function() {
				emitter.emit(progKey, {progress: progress, eta: eta, state: 'running'});
			}
		);
	};

	s.startProgress = function(progKey) {
		getCheckpointProgressAndFullTime(progKey, function(err, result) {
			var eta = Math.round((100 - result.checkpointProgress) / 100 * result.fullTime);
			startProgressAt(progKey, result.checkpointProgress, eta);
		});
	};

	var getProgressAt = function(progKey, timestamp, cb) {
		client.hmget(key,
			progKey + ':checkpoint:progress',
			progKey + ':checkpoint:timestamp',
			progKey + ':fullTime',
			function(err, results) {
				var checkpointProgress = Number(results[0]);
				var checkpointTimestamp = Number(results[1]);
				var fullTime = Number(results[2]);
				var progress = (timestamp - checkpointTimestamp) / fullTime * 100 + checkpointProgress;
				cb(null, limitProgress(progress));
			});
	};

	var setProgressAt = function(progKey, progress, timestamp, cb) {
		client.multi()
			.hmset(key,
				progKey + ':checkpoint:timestamp', timestamp,
				progKey + ':checkpoint:progress', progress)
			.hget(key, progKey + ':eta')
			.exec(function(err, results) {
				var eta = Number(results[1]);
				var result = {progress: progress, state: eta ? 'running' : 'stopped'};
				if (eta) {
					result.eta = eta;
				}
				if (cb != null) {
					cb(null, result);
				}
				emitter.emit(progKey, result);
			});
	};

	var unscheduleByProgKey = function(progKey, cb) {
		client.hgetNum(key, progKey + ':id', function(err, progId) {
			if (progId) {
				unschedule(progId);
				cb(null, progId);
			}
		});
	};

	s.setProgress = function(progKey, progress, cb) {
		setProgressAt(progKey, progress, Date.now(), cb);
	};

	s.stopProgress = function(progKey, cb) {
		var now = Date.now();
		unscheduleByProgKey(progKey, function() {
			getProgressAt(progKey, now, function(err, progress) {
				setProgressAt(progKey, progress, now, function() {
					setStateToStopped(progKey, function() {
						emitter.emit(progKey, {progress: progress, state: 'stopped'});
						cb(null, progress);
					});
				});
			});
		});
	};

	var getProgressState = function(progKey, cb) {
		getProgressAt(progKey, Date.now(), function(err, progress) {
			client.hmget(key, progKey + ':id', progKey + ':fullTime', function(err, results) {
				var progId = Number(results[0]);
				var fullTime = Number(results[1]);
				var result = {
					progress: progress,
					state: progId ? 'running' : 'stopped'
				};
				if (progId) {
					result.eta = Math.round((100 - progress) / 100 * fullTime);
				}
				cb(null, result);
			});
		});
	};

	s.getMainState = function(cb) {
		client.hgetNum(key, 'account', function(err, account) {
			getProgressState('progress:scan', function(err, scanProgress) {
				getScanResults(function(err, scanResults) {
					getHacking(function(err, hacking) {
						cb(null, {
							account: account,
							scanProgress: scanProgress,
							scanResults: scanResults,
							hacking: hacking
						});
					});
				});
			});
		});
	};

	var activate = function() {
		// TODO
	};

	s.initProgress = function(progKey, fullTime, cb) {
		client.hmset(key,
			progKey + ':id', 0,
			progKey + ':eta', 0,
			progKey + ':fullTime', fullTime,
			progKey + ':checkpoint:timestamp', 0,
			progKey + ':checkpoint:progress', 0,
			cb
		);
	};

	s.init = function() {
		client.hmset(key,
			'account', initialAccount,
			'lastItJobTimestamp', 0,
			'frozen', 0,
			function() {
				s.initProgress('progress:scan', fullScanTime, activate);
			}
		);
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
					if (value.progress >= 100) {
						s.setProgress('progress:scan', 0, function() {
							s.scan(function(err, results) {
								sock().emit('scanResults', results);
							});
						});
					}
				};
				s.on('progress:scan', scanListener);

				var accountListener = function(value) {
					sock().emit('account', value);
				};
				s.on('account', accountListener);

				sock().on('itJobs', s.payForItJob);
				sock().on('scan', function() {
					s.startProgress('progress:scan');
				});
				sock().on('startHacking', function(ip) {
					s.getHackingStage(ip, function(err, stage) {
						s.startProgress('progress:hacking:' + ip + ':' + stage);
					});
				});
				sock().on('stopHacking', function(ip) {
					s.getHackingStage(ip, function(err, stage) {
						s.stopProgress('progress:hacking:' + ip + ':' + stage);
					});
				});
				var hackingListener = function(evt) {
					sock().emit('hacking', evt);
					if (evt.progress >= 100 && evt.nextStage != null) {
						s.startProgress('progress:hacking:' + evt.ip + ':' + evt.nextStage);
					}
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
					s.removeListener('account', accountListener)
					.removeListener('progress:scan', scanListener)
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
