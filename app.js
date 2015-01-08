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

pongular
.module('app', ['dao.redis', 'service.victim'])
.factory('redisClient', function() {
	return require('redis').createClient();
})
.uses('*.js');

var injector = pongular.injector(['app']);
injector.invoke(['victimService', 'redisDao', function(victimService, redisDao) {

var EventEmitter = require('events').EventEmitter;
var express = require('express');
var cookieParser = require('cookie-parser');
var session = require('express-session');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var sessionstore = require('sessionstore');
var sessStore = sessionstore.createSessionStore();

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


var userStates = {};

var newUserState = function(uid) {
	var key = 'user:' + uid;
	var emitter = new EventEmitter();

	var s = {};

	var getLastItJobTimestamp = function(callback) {
		redisDao.hgetNum(key, 'lastItJobTimestamp', callback);
	};

	var clearScanResults = function(callback) {
		var scannedIpsKey = key + ':scannedIps';
		redisDao.lrange(scannedIpsKey, 0, -1, function(err, ips) {
			victimService.remove(ips, function() {
				redisDao.del(scannedIpsKey, callback);
			});
		});
	};

	var saveScannedIps = function(ips, callback) {
		// TODO refactor dao to make such calls as redisDao.rpush(key + ':scannedIps', ips, callback);
		redisDao.rpush.apply(redisDao, [key + ':scannedIps'].concat(ips, callback));
	};

	s.scan = function(callback) {
		clearScanResults(function() {
			victimService.generate(scanResultsCount, 1, function(err, victims) {
				saveScannedIps(victims.map(function(v) { return v.ip; }), function() {
					callback(null, victims);
				});
			});
		});
	};

	var getScanResults = function(cb) {
		redisDao.lrange(key + ':scannedIps', 0, -1, function(err, ips) {
			victimService.getVictims(ips, cb);
		});
	};

	var firstHackingStage = 'firewall';

	var nextHackingStage = function(stage) {
		if (stage == firstHackingStage) {
			return 'antivirus';
		} else if (stage == 'antivirus') {
			return 'password';
		} else if (stage == 'password') {
			return 'transfer';
		} else {
			return null;
		}
	};

	var stageFullTime = function(ip, stage, cb) {
		var result;
		if (stage == firstHackingStage) {
			result = 3000;
		} else if (stage == 'antivirus') {
            result = 2000;
		} else if (stage == 'password') {
			result = 4000;
		} else if (stage == 'transfer') {
			result = 1500;
		}
		cb(null, result);
	};

	var subscribeForHackingEvents = function(ip, stage) {
		emitter.on('progress:hacking:' + ip + ':' + stage, function(evt) {
			var nextStage = nextHackingStage(stage);
			emitter.emit('hacking', {
				ip: ip,
				stage: stage,
				nextStage: nextStage,
				progress: evt.progress,
				state: evt.state,
				eta: evt.eta
			});
			if (evt.progress >= 100 && nextStage != null) {
				s.startProgress('progress:hacking:' + ip + ':' + nextStage);
				subscribeForHackingEvents(ip, nextStage);
			}
		});
	};

	var initHackingStage = function(ip, stage, fullTime, cb) {
		s.initProgress('progress:hacking:' + ip + ':' + stage, fullTime, cb);
	};

	var initHackingProgress;
	initHackingProgress = function(ip, stage, cb) {
		if (stage != null) {
			stageFullTime(ip, stage, function(err, fullTime) {
				initHackingStage(ip, stage, fullTime, function() {
					initHackingProgress(ip, nextHackingStage(stage), cb);
				});
			});
		} else {
			cb();
		}
	};

	s.moveToHacking = function(ip, cb) {
		subscribeForHackingEvents(ip, firstHackingStage);
		initHackingProgress(ip, firstHackingStage, function() {
			redisDao.lrem(key + ':scannedIps', 1, ip, function(err, removedCount) {
				if (removedCount > 0) {
					redisDao.multi()
						.rpush(key + ':hacking', ip)
						.exec(cb);
				}
			});
		});
	};

	var unsubscribeFromHackingEvents = function(ip) {
		var stage = firstHackingStage;
		while (stage != null) {
			emitter.removeAllListeners('progress:hacking:' + ip + ':' + stage);
			stage = nextHackingStage(stage);
		}
	};

	s.removeFromHacking = function(ip, cb) {
		unsubscribeFromHackingEvents(ip);
		redisDao.multi()
			.lrem(key + ':hacking', 1, ip)
			.del(key + ':hacking:' + ip)
			.exec(function(err, result) {
				if (result[0] > 0) {
					victimService.remove(ip, function() {
						cb(null, true);
					});
				}
			});
	};

	var getHacking = function(cb) {
		redisDao.lrange(key + ':hacking', 0, -1, function(err, ips) {
			var multi = redisDao.multi();
			ips.forEach(function(ip) {
				var args = [key];
				var stage = firstHackingStage;
				while (stage != null) {
					args.push('progress:hacking:' + ip + ':' + stage + ':checkpoint:progress');
					args.push('progress:hacking:' + ip + ':' + stage + ':checkpoint:timestamp');
					args.push('progress:hacking:' + ip + ':' + stage + ':eta');
					args.push('progress:hacking:' + ip + ':' + stage + ':fullTime');
					stage = nextHackingStage(stage);
				}
				multi.hmget.apply(multi, args);
			});
			var n = 0;
			multi.exec(function(err, hackingList) {
				victimService.getVictims(ips, function(err, victims) {
					cb(null, hackingList.map(function(e) {
						var now = Date.now();
						var result = {ip: ips[n], state: 'stopped'};
						var stage = firstHackingStage;
						var m = 0;
						while (stage != null) {
							var checkpointProgress = Number(e[m * 4]);
							var checkpointTimestamp = Number(e[m * 4 + 1]);
							var eta = Number(e[m * 4 + 2]);
							var fullTime = Number(e[m * 4 + 3]);
							var progress = eta ?
								(now - checkpointTimestamp) / fullTime * 100 + checkpointProgress :
								checkpointProgress;
							result[stage] = {
								progress: progress,
								eta: eta ? Math.round((100 - progress) / 100 * fullTime) : 0,
								level: victims[n][stage + 'Level']
							};
							if (eta) {
								result.state = 'running';
							}
							stage = nextHackingStage(stage);
							m++;
						}
						n++;
						return result;
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
				redisDao.multi()
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
		redisDao.hmset(key,
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
		redisDao.hset(key, progKey + ':fullTime', fullTime, cb);
	};

	var getCheckpointProgressAndFullTime = function(progKey, cb) {
		redisDao.hgetNum(key, progKey + ':id', function(err, progId) {
			if (!progId) {
				redisDao.hmget(key,
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
		redisDao.hmset(key,
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
		redisDao.hmget(key,
			progKey + ':checkpoint:progress',
			progKey + ':checkpoint:timestamp',
			progKey + ':fullTime',
			progKey + ':eta',
			function(err, results) {
				var checkpointProgress = Number(results[0]);
				var checkpointTimestamp = Number(results[1]);
				var fullTime = Number(results[2]);
				var eta = Number(results[3]);
				var progress = eta ?
					(timestamp - checkpointTimestamp) / fullTime * 100 + checkpointProgress :
					checkpointProgress;
				cb(null, limitProgress(progress));
			});
	};

	var setProgressAt = function(progKey, progress, timestamp, cb) {
		redisDao.multi()
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
		redisDao.hgetNum(key, progKey + ':id', function(err, progId) {
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
				setStateToStopped(progKey, function() {
					setProgressAt(progKey, progress, now, function() {
						if (cb != null) {
							cb(null, progress);
						}
					});
				});
			});
		});
	};

	var getProgressState = function(progKey, cb) {
		getProgressAt(progKey, Date.now(), function(err, progress) {
			redisDao.hmget(key, progKey + ':id', progKey + ':fullTime', function(err, results) {
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

	var getHackingStage;
	getHackingStage = function(ip, stage, cb) {
		if (stage != null) {
			getProgressState('progress:hacking:' + ip + ':' + stage, function(err, result) {
				if (result.state == 'stopped' && result.progress >= 100) {
					getHackingStage(ip, nextHackingStage(stage), cb);
				} else if (cb != null) {
					cb(null, stage);
				}
			});
		} else if (cb != null) {
			cb(null, null);
		}
	};

	var startStopHacking = function(ip, startStopFunc, cb) {
		getHackingStage(ip, firstHackingStage, function(err, stage) {
			if (stage != null) {
				startStopFunc.call(s, 'progress:hacking:' + ip + ':' + stage);
			}
		});
	};

	s.startHacking = function(ip, cb) {
		startStopHacking(ip, s.startProgress, cb);
	};

	s.stopHacking = function(ip, cb) {
		startStopHacking(ip, s.stopProgress, cb);
	};

	s.getMainState = function(cb) {
		redisDao.hgetNum(key, 'account', function(err, account) {
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
		redisDao.hmset(key,
			progKey + ':id', 0,
			progKey + ':eta', 0,
			progKey + ':fullTime', fullTime,
			progKey + ':checkpoint:timestamp', 0,
			progKey + ':checkpoint:progress', 0,
			cb
		);
	};

	s.init = function() {
		redisDao.hmset(key,
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

}]);
