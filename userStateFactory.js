var pongular = require('pongular').pongular;
var EventEmitter = require('events').EventEmitter;

module.exports = pongular
.module('app')
.factory('userStateFactory', [
	'schedulingService', 'victimService', 'redisDao',
	function(schedulingService, victimService, redisDao) {

var initialAccount = 75;
var minIntervalBetweenItJobs = 1000;
var maxItJobsPerRequest = 5;
var itJobPrice = 10;
var scanResultsCount = 5;
var fullScanTime = 2000;
var firstHackingStage = 'firewall';

return function(uid) {
	var key = 'user:' + uid;
	var emitter = new EventEmitter();

	return Object.create({
		scan: function(callback) {
			var self = this;
			self.clearScanResults(function() {
				victimService.generate(scanResultsCount, 1, function(err, victims) {
					self.saveScannedIps(victims.map(function(v) { return v.ip; }), function() {
						callback(null, victims);
					});
				});
			});
		},

		moveToHacking: function(ip, cb) {
			this.subscribeForHackingEvents(ip, firstHackingStage);
			this.initHackingProgress(ip, firstHackingStage, function() {
				redisDao.lrem(key + ':scannedIps', 1, ip, function(err, removedCount) {
					if (removedCount > 0) {
						redisDao.multi()
							.rpush(key + ':hacking', ip)
							.exec(cb);
					}
				});
			});
		},

		removeFromHacking: function(ip, cb) {
			this.unsubscribeFromHackingEvents(ip);
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
		},

		on: function(event, listener) {
			emitter.on(event, listener);
			return this;
		},

		removeListener: function(event, listener) {
			emitter.removeListener(event, listener);
			return this;
		},

		payForItJob: function(amount) {
			var timestamp = Date.now();
			this.getLastItJobTimestamp(function(err, reply) {
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
		},

		setFullTime: function(progKey, fullTime, cb) {
			redisDao.hset(key, progKey + ':fullTime', fullTime, cb);
		},

		startProgress: function(progKey) {
			var self = this;
			self.getCheckpointProgressAndFullTime(progKey, function(err, result) {
				var eta = Math.round((100 - result.checkpointProgress) / 100 * result.fullTime);
				self.startProgressAt(progKey, result.checkpointProgress, eta);
			});
		},

		setProgress: function(progKey, progress, cb) {
			this.setProgressAt(progKey, progress, Date.now(), cb);
		},

		stopProgress: function(progKey, cb) {
			var self = this;
			var now = Date.now();
			self.unscheduleByProgKey(progKey, function() {
				self.getProgressAt(progKey, now, function(err, progress) {
					self.setStateToStopped(progKey, function() {
						self.setProgressAt(progKey, progress, now, function() {
							if (cb != null) {
								cb(null, progress);
							}
						});
					});
				});
			});
		},

		startHacking: function(ip, cb) {
			this.startStopHacking(ip, this.startProgress, cb);
		},

		stopHacking: function(ip, cb) {
			this.startStopHacking(ip, this.stopProgress, cb);
		},

		getMainState: function(cb) {
			var self = this;
			redisDao.hgetNum(key, 'account', function(err, account) {
				self.getProgressState('progress:scan', function(err, scanProgress) {
					self.getScanResults(function(err, scanResults) {
						self.getHacking(function(err, hacking) {
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
		},

		initProgress: function(progKey, fullTime, cb) {
			redisDao.hmset(key,
				progKey + ':id', 0,
				progKey + ':eta', 0,
				progKey + ':fullTime', fullTime,
				progKey + ':checkpoint:timestamp', 0,
				progKey + ':checkpoint:progress', 0,
				cb
			);
		},

		init: function() {
			var self = this;
			redisDao.hmset(key,
				'account', initialAccount,
				'lastItJobTimestamp', 0,
				'frozen', 0,
				function() {
					self.initProgress('progress:scan', fullScanTime, self.activate);
				}
			);
			return self;
		},

		destroy: function() {
			// TODO
		},

		// private

		activate: function() {
			// TODO
		},

		clearScanResults: function(callback) {
			var scannedIpsKey = key + ':scannedIps';
			redisDao.lrange(scannedIpsKey, 0, -1, function(err, ips) {
				victimService.remove(ips, function() {
					redisDao.del(scannedIpsKey, callback);
				});
			});
		},

		saveScannedIps: function(ips, callback) {
			// TODO refactor dao to make such calls as redisDao.rpush(key + ':scannedIps', ips, callback);
			redisDao.rpush.apply(redisDao, [key + ':scannedIps'].concat(ips, callback));
		},

		subscribeForHackingEvents: function(ip, stage) {
			var self = this;
			emitter.on('progress:hacking:' + ip + ':' + stage, function(evt) {
				var nextStage = self.nextHackingStage(stage);
				emitter.emit('hacking', {
					ip: ip,
					stage: stage,
					nextStage: nextStage,
					progress: evt.progress,
					state: evt.state,
					eta: evt.eta
				});
				if (evt.progress >= 100 && nextStage != null) {
					self.startProgress('progress:hacking:' + ip + ':' + nextStage);
					self.subscribeForHackingEvents(ip, nextStage);
				}
			});
		},

		nextHackingStage: function(stage) {
			if (stage == firstHackingStage) {
				return 'antivirus';
			} else if (stage == 'antivirus') {
				return 'password';
			} else if (stage == 'password') {
				return 'transfer';
			} else {
				return null;
			}
		},

		initHackingProgress: function(ip, stage, cb) {
			var self = this;
			if (stage != null) {
				self.stageFullTime(ip, stage, function(err, fullTime) {
					self.initHackingStage(ip, stage, fullTime, function() {
						self.initHackingProgress(ip, self.nextHackingStage(stage), cb);
					});
				});
			} else {
				cb();
			}
		},

		stageFullTime: function(ip, stage, cb) {
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
		},

		initHackingStage: function(ip, stage, fullTime, cb) {
			this.initProgress('progress:hacking:' + ip + ':' + stage, fullTime, cb);
		},

		unsubscribeFromHackingEvents: function(ip) {
			var stage = firstHackingStage;
			while (stage != null) {
				emitter.removeAllListeners('progress:hacking:' + ip + ':' + stage);
				stage = this.nextHackingStage(stage);
			}
		},

		getLastItJobTimestamp: function(callback) {
			redisDao.hgetNum(key, 'lastItJobTimestamp', callback);
		},

		getCheckpointProgressAndFullTime: function(progKey, cb) {
			var self = this;
			redisDao.hgetNum(key, progKey + ':id', function(err, progId) {
				if (!progId) {
					redisDao.hmget(key,
						progKey + ':checkpoint:progress',
						progKey + ':fullTime',
						function(err, results) {
							cb(null, {
								checkpointProgress: self.limitProgress(Number(results[0])),
								fullTime: Number(results[1])
							});
						}
					);
				}
			});
		},

		limitProgress: function(value) {
			if (value > 100) {
				value = 100;
			} else if (value < 0) {
				value = 0;
			}
			return value;
		},

		startProgressAt: function(progKey, progress, eta) {
			redisDao.hmset(key,
				progKey + ':id', this.scheduleFinish(progKey, eta),
				progKey + ':eta', eta,
				progKey + ':checkpoint:timestamp', Date.now(),
				function() {
					emitter.emit(progKey, {progress: progress, eta: eta, state: 'running'});
				}
			);
		},

		scheduleFinish: function(progKey, eta) {
			var self = this;
			return schedulingService.schedule(function() {
				self.setStateToStopped(progKey, function() {
					self.setProgress(progKey, 100);
				});
			}, eta);
		},

		setStateToStopped: function(progKey, cb) {
			redisDao.hmset(key,
				progKey + ':id', 0,
				progKey + ':eta', 0,
				cb
			);
		},

		setProgressAt: function(progKey, progress, timestamp, cb) {
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
		},

		unscheduleByProgKey: function(progKey, cb) {
			redisDao.hgetNum(key, progKey + ':id', function(err, progId) {
				if (progId) {
					schedulingService.unschedule(progId);
					cb(null, progId);
				}
			});
		},

		getProgressAt: function(progKey, timestamp, cb) {
			var self = this;
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
					cb(null, self.limitProgress(progress));
				});
		},

		startStopHacking: function(ip, startStopFunc, cb) {
			var self = this;
			self.getHackingStage(ip, firstHackingStage, function(err, stage) {
				if (stage != null) {
					startStopFunc.call(self, 'progress:hacking:' + ip + ':' + stage);
				}
			});
		},

		getHackingStage: function(ip, stage, cb) {
			var self = this;
			if (stage != null) {
				self.getProgressState('progress:hacking:' + ip + ':' + stage, function(err, result) {
					if (result.state == 'stopped' && result.progress >= 100) {
						self.getHackingStage(ip, self.nextHackingStage(stage), cb);
					} else if (cb != null) {
						cb(null, stage);
					}
				});
			} else if (cb != null) {
				cb(null, null);
			}
		},

		getProgressState: function(progKey, cb) {
			this.getProgressAt(progKey, Date.now(), function(err, progress) {
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
		},

		getScanResults: function(cb) {
			redisDao.lrange(key + ':scannedIps', 0, -1, function(err, ips) {
				victimService.getVictims(ips, cb);
			});
		},

		getHacking: function(cb) {
			var self = this;
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
						stage = self.nextHackingStage(stage);
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
								stage = self.nextHackingStage(stage);
								m++;
							}
							n++;
							return result;
						}));
					})
				});
			});
		}
	});
};

}]);
